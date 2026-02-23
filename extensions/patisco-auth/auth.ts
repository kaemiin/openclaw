/**
 * Patisco Auth — 處理 POST /auth/login 與 GET /auth/refresh。
 *
 * JWT 有效期 1 小時（後端 1-hour window）。
 * 每次呼叫 MCP 前由 mcp.ts 的 withFreshCreds() 自動 refresh。
 */
import type { ProviderAuthContext, ProviderAuthResult } from "openclaw/plugin-sdk";
import { upsertAuthProfileWithLock } from "../../src/agents/auth-profiles/profiles.js";

const BASE_URL = "https://mcp.patisco.com";

export const JWT_PROFILE_ID = "patisco:token";
export const API_KEY_PROFILE_ID = "patisco:api-key";

/** 一小時扣掉 5 分鐘緩衝，確保 refresh 在 JWT 過期前完成。 */
const JWT_TTL_MS = 60 * 60 * 1000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ── 登入 ─────────────────────────────────────────────────────────────────────

export async function loginPatisco(
  ctx: ProviderAuthContext,
): Promise<ProviderAuthResult> {
  const loginId = await ctx.prompter.text("帳號 (loginId):");
  const password = await ctx.prompter.password("密碼:");

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
      "JWT refresh 失敗，請重新登入：openclaw auth patisco",
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
