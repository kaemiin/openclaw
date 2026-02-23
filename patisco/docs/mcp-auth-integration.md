# MCP Server 自訂驗證整合指南

> 調查日期：2026-02-23
> 目標：在 OpenClaw 中整合自家 MCP Server，透過帳號密碼驗證取得 JWT 與 API Key

---

## 一、Auth API 規格

### POST /auth/login

```http
POST /auth/login
Content-Type: application/json

{ "loginId": "string", "password": "string" }
```

**回應：**
```json
{ "jwt": "<JWT Token>", "apiKey": "<API Key>" }
```

### GET /auth/refresh

```http
GET /auth/refresh
Authorization: Bearer <jwt>
X-Api-Key: <apiKey>
```

**行為：**
- 1 小時內：直接回傳快取 JWT（不呼叫 AuthServer）
- 逾期：向 AuthServer 取得新 JWT 並更新 session
- 失敗：刪除本地 session，回傳 401

---

## 二、OpenClaw 現況分析

### MCP Server 支援狀態（已驗證）

目前 OpenClaw 的 ACP 翻譯器**明確忽略** MCP servers：

```typescript
// src/acp/translator.ts:146-147
if (params.mcpServers.length > 0) {
  this.log(`ignoring ${params.mcpServers.length} MCP servers`);
}
```

ACP capabilities 也明確宣告不支援：
```typescript
mcpCapabilities: { http: false, sse: false }
```

### 憑證儲存系統（src/agents/auth-profiles/types.ts）

OpenClaw 提供三種 credential type：

```typescript
// JWT → TokenCredential（有過期時間，對應 1-hour window）
type TokenCredential = {
  type: "token";
  provider: string;
  token: string;      // 存 JWT
  expires?: number;   // expiresAt (ms since epoch)
};

// API Key → ApiKeyCredential（永久有效）
type ApiKeyCredential = {
  type: "api_key";
  provider: string;
  key?: string;
  metadata?: Record<string, string>;
};

// OAuth（可自動 refresh，需搭配 refreshOAuth hook）
type OAuthCredential = OAuthCredentials & {
  type: "oauth";
  provider: string;
};
```

憑證存放路徑：`~/.openclaw/credentials/`

### 參考實作

`extensions/minimax-portal-auth/` 是最接近此需求的參考：
- 實作自訂 OAuth 登入流程
- 透過 `ProviderPlugin` + `ProviderAuthMethod` 整合至 `openclaw auth` 指令

---

## 三、建議實作路徑

### Phase 1：Auth Extension（憑證登入與儲存）

#### 目錄結構

```
extensions/patisco-auth/
├── index.ts              # 註冊 ProviderPlugin
├── auth.ts               # 呼叫 POST /auth/login + refresh 邏輯
├── package.json
└── openclaw.plugin.json
```

#### auth.ts — 核心登入邏輯

```typescript
import type { ProviderAuthContext, ProviderAuthResult } from "openclaw/plugin-sdk";

export async function loginPatisco(
  ctx: ProviderAuthContext,
): Promise<ProviderAuthResult> {
  const loginId = await ctx.prompter.text("帳號 (loginId):");
  const password = await ctx.prompter.password("密碼:");

  const progress = ctx.prompter.progress("連線驗證中…");

  const res = await fetch("https://your-auth-api.example.com/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId, password }),
  });

  if (!res.ok) {
    progress.stop("驗證失敗");
    throw new Error("Unauthorized");
  }

  const { jwt, apiKey } = await res.json() as { jwt: string; apiKey: string };
  progress.stop("驗證成功");

  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour，對應後端 1-hour window

  return {
    profiles: [
      {
        profileId: "patisco:token",
        credential: {
          type: "token",
          provider: "patisco",
          token: jwt,
          expires: expiresAt,
        },
      },
      {
        profileId: "patisco:api-key",
        credential: {
          type: "api_key",
          provider: "patisco",
          key: apiKey,
        },
      },
    ],
  };
}
```

#### index.ts — Plugin 入口

```typescript
import { type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { loginPatisco } from "./auth.js";

export default function plugin(api: OpenClawPluginApi) {
  api.registerProvider({
    id: "patisco",
    label: "Patisco",
    auth: [
      {
        id: "patisco:login",
        label: "帳號密碼登入",
        kind: "custom",
        run: loginPatisco,
      },
    ],
  });
}
```

#### package.json

```json
{
  "name": "@openclaw/patisco-auth",
  "version": "2026.2.23",
  "private": true,
  "description": "OpenClaw Patisco Auth provider plugin",
  "type": "module",
  "devDependencies": {
    "openclaw": "workspace:*"
  },
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

#### 使用方式

```bash
# 觸發登入流程
openclaw auth patisco

# 登入後憑證存入 ~/.openclaw/credentials/
# 讀取方式：
const profiles = loadAuthProfiles(agentDir);
const tokenCred = profiles["patisco:token"];   // TokenCredential (JWT)
const apiKeyCred = profiles["patisco:api-key"]; // ApiKeyCredential
```

---

### Phase 2：MCP Server 整合（視 Server 類型而定）

| MCP Server 類型 | 建議方案 | 難度 |
|----------------|---------|------|
| **LLM API（Anthropic-compatible）** | 在 `ProviderAuthResult.configPatch` 設定 `baseUrl` + headers；於 `registerProvider.models` 定義模型 | 低 |
| **Tool provider（提供工具給 AI 呼叫）** | Plugin 內用 `registerPluginHttpRoute` 包裝成 OpenClaw tools，攜帶 JWT + API key headers | 中 |
| **核心 MCP 協議支援** | 修改 `src/acp/translator.ts`，移除 ignore 邏輯，實作 MCP stdio/HTTP-SSE client | 高 |

#### 若為 LLM API Provider（方案 A）

在 `loginPatisco` 回傳值加入 `configPatch`：

```typescript
return {
  profiles: [...],
  configPatch: {
    agents: {
      model: "patisco/default-model",
    },
  },
  defaultModel: "patisco/default-model",
};
```

並在 `registerProvider` 加上 `models` 定義：

```typescript
api.registerProvider({
  id: "patisco",
  label: "Patisco",
  models: {
    baseUrl: "https://your-mcp-server.example.com",
    // 每次 API 呼叫時帶上憑證 headers
  },
  auth: [...],
});
```

#### 若為 Tool Provider（方案 B）

```typescript
import { registerPluginHttpRoute } from "openclaw/plugin-sdk";

// 在 plugin 內包裝 MCP 工具為 OpenClaw HTTP route
registerPluginHttpRoute("/patisco/tool/invoke", async (req, res) => {
  const { jwt, apiKey } = loadPatiscoCredentials();
  const result = await fetch("https://your-mcp-server.example.com/tools/invoke", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${jwt}`,
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: req.body,
  });
  res.json(await result.json());
});
```

---

## 四、安全注意事項

| 項目 | 說明 |
|------|------|
| **憑證存放** | 存入 `~/.openclaw/credentials/`（OpenClaw 標準路徑），勿存入 config 明文 |
| **JWT 過期處理** | `TokenCredential.expires` 設為 `Date.now() + 3600000`；到期前呼叫 `GET /auth/refresh` |
| **API Key 保護** | `zod-schema.ts` 中 `apiKey` 欄位標記為 `.register(sensitive)`，會自動 redact log |
| **HTTPS** | 生產環境 Auth API 與 MCP Server 均需 TLS |
| **錯誤回應** | 401 一律回傳「Unauthorized」，不透露是帳號或密碼錯誤 |

---

## 五、關鍵檔案參考

| 檔案 | 用途 |
|------|------|
| `extensions/minimax-portal-auth/index.ts` | 自訂 OAuth 登入 plugin 參考實作 |
| `src/agents/auth-profiles/types.ts` | `TokenCredential`、`ApiKeyCredential` 型別定義 |
| `src/commands/onboard-auth.credentials.ts` | 寫入 credential 到磁碟的標準方式 |
| `src/config/paths.ts:247` | `~/.openclaw/credentials/` 路徑解析 |
| `src/plugins/types.ts` | `ProviderPlugin`、`ProviderAuthMethod`、`ProviderAuthResult` 型別 |
| `src/acp/translator.ts:146` | MCP servers 被 ignore 的位置（需修改才能啟用 MCP tool support） |
| `src/gateway/tools-invoke-http.ts` | HTTP tool invocation 與 Bearer token 驗證流程 |
