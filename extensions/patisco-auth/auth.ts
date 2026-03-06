/**
 * Patisco Auth — 處理 POST /auth/login 與 GET /auth/refresh。
 * 正式環境: https://mcp.patisco.com
 * 測試環境: https://patisco-g4-mcp-gateway.dz920507desm2.us-east-1.cs.amazonlightsail.com
 * JWT 有效期 1 小時（後端 1-hour window）。
 * 每次呼叫 MCP 前由 mcp.ts 的 withFreshCreds() 自動 refresh。
 */
import type { ProviderAuthContext, ProviderAuthResult } from "openclaw/plugin-sdk";
import { upsertAuthProfileWithLock } from "../../src/agents/auth-profiles/profiles.js";

const BASE_URL = "https://patisco-g4-mcp-gateway.dz920507desm2.us-east-1.cs.amazonlightsail.com";

export const JWT_PROFILE_ID = "patisco:token";
export const API_KEY_PROFILE_ID = "patisco:api-key";

/** 一小時扣掉 5 分鐘緩衝，確保 refresh 在 JWT 過期前完成。 */
const JWT_TTL_MS = 60 * 60 * 1000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ── 登入 ─────────────────────────────────────────────────────────────────────

export async function loginPatisco(
  ctx: ProviderAuthContext,
): Promise<ProviderAuthResult> {
  await ctx.prompter.note(
    "登入 Patisco MCP（目前 CLI 不支援密碼遮罩，請在安全環境輸入）",
    "Patisco 登入",
  );

  const loginId = await ctx.prompter.text({
    message: "請輸入 loginId（帳號）",
    placeholder: "name@example.com",
    validate: (value) => (value.trim().length > 0 ? undefined : "loginId 不能空白"),
  });
  const password = await ctx.prompter.text({
    message: "請輸入密碼（明文顯示）",
    validate: (value) => (value.length > 0 ? undefined : "密碼不能空白"),
  });

  const progress = ctx.prompter.progress("連線驗證中…");

  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId, password }),
  });

  if (!res.ok) {
    progress.stop("驗證失敗");
    throw new Error("帳號或密碼錯誤");
  }

  const { jwt, apiKey } = (await res.json()) as { jwt: string; apiKey: string };
  progress.stop("驗證成功");

  return {
    profiles: [
      {
        profileId: JWT_PROFILE_ID,
        credential: {
          type: "token",
          provider: "patisco",
          token: jwt,
          expires: Date.now() + JWT_TTL_MS,
        },
      },
      {
        profileId: API_KEY_PROFILE_ID,
        credential: {
          type: "api_key",
          provider: "patisco",
          key: apiKey,
        },
      },
    ],
  };
}

// ── Token Refresh ─────────────────────────────────────────────────────────────

export type PatiscoCredentials = {
  jwt: string;
  apiKey: string;
  jwtExpires: number;
};

/**
 * JWT 在 REFRESH_BUFFER_MS 內到期時，呼叫 GET /auth/refresh 取得新 JWT，
 * 並更新 credential store。
 */
export async function maybeRefreshJwt(
  creds: PatiscoCredentials,
  agentDir?: string,
): Promise<PatiscoCredentials> {
  if (creds.jwtExpires - Date.now() >= REFRESH_BUFFER_MS) {
    return creds; // 尚未接近過期，直接回傳
  }

  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    headers: {
      Authorization: `Bearer ${creds.jwt}`,
      "X-Api-Key": creds.apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(
      "JWT refresh 失敗，請重新登入：openclaw models auth login --provider patisco --method patisco:login",
    );
  }

  const { jwt: newJwt } = (await res.json()) as { jwt: string };
  const newExpires = Date.now() + JWT_TTL_MS;

  // 更新 credential store（有 file lock，多 agent 安全）
  await upsertAuthProfileWithLock({
    profileId: JWT_PROFILE_ID,
    credential: {
      type: "token",
      provider: "patisco",
      token: newJwt,
      expires: newExpires,
    },
    agentDir,
  });

  return { ...creds, jwt: newJwt, jwtExpires: newExpires };
}
