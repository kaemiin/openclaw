# MCP Server 自訂驗證整合指南（目前版本）

> 更新日期：2026-03-06
> 目標：在 OpenClaw 中整合 Patisco Provider Auth（帳密登入取得 JWT + API Key）

---

## 一、Auth API 規格

### POST /auth/login

```http
POST /auth/login
Content-Type: application/json

{ "loginId": "string", "password": "string" }
```

回應：

```json
{ "jwt": "<JWT Token>", "apiKey": "<API Key>" }
```

### GET /auth/refresh

```http
GET /auth/refresh
Authorization: Bearer <jwt>
X-Api-Key: <apiKey>
```

行為：
- JWT 距到期 < 5 分鐘時由 client 自動呼叫
- 成功回傳新 JWT
- 失敗回 401，需重新登入

---

## 二、OpenClaw 端實作（已落地）

### Plugin 位置

```text
extensions/patisco-auth/
├── index.ts
├── auth.ts
├── mcp.ts
├── package.json
└── openclaw.plugin.json
```

### auth.ts（重點）

- 使用 `ProviderPlugin` custom auth method：`patisco:login`
- 互動登入採用 `ctx.prompter.text({ ... })`（不是 `password()`）
- 成功後寫入兩組 profile：
  - `patisco:token`（`TokenCredential`，含 expires）
  - `patisco:api-key`（`ApiKeyCredential`）
- JWT 自動刷新後使用 `upsertAuthProfileWithLock` 寫回 credential store

憑證路徑：
- `~/.openclaw/credentials/`

---

## 三、目前正確 CLI 使用方式

> 舊指令 `openclaw auth patisco` 已不適用。

```bash
pnpm openclaw models auth login --provider patisco --method patisco:login
```

若 plugin 尚未安裝（建議 link 安裝）：

```bash
pnpm openclaw plugins install -l ./extensions/patisco-auth
pnpm openclaw plugins enable patisco-auth
pnpm openclaw gateway restart
```

---

## 四、驗證設計摘要

- JWT + API Key 雙憑證
- JWT 快到期（<5 分鐘）自動 refresh
- 憑證檔案化儲存（OpenClaw 標準 auth profile）
- refresh 失敗時拋出明確錯誤，要求重新登入

---

## 五、常見錯誤（已知）

- `ctx.prompter.password is not a function`
  - 原因：WizardPrompter 無 `password()` API
  - 解法：改用 `prompter.text({ message, validate })`

- `unknown command 'auth'`
  - 原因：CLI 路徑已更新
  - 解法：改用 `models auth login --provider ...`

---

## 六、參考檔案

- `extensions/patisco-auth/auth.ts`
- `extensions/patisco-auth/index.ts`
- `src/agents/auth-profiles/types.ts`
- `src/agents/auth-profiles/profiles.ts`
