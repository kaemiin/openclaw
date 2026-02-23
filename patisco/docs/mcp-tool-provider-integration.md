# Patisco MCP Tool Provider 整合

> 類型：資料工具型 MCP Server（訂單等資料查詢）
> 協議：標準 MCP Streamable HTTP Transport (JSON-RPC 2.0)
> 服務：https://mcp.patisco.com
> 日期：2026-02-23

---

## 一、架構總覽

```
openclaw auth patisco
  └─ POST /auth/login  →  { jwt (1h TTL), apiKey (永久) }
       └─ 存入 ~/.openclaw/credentials/
            ├── patisco:token    (TokenCredential, expires = now + 1h)
            └── patisco:api-key  (ApiKeyCredential)

Plugin 啟動
  └─ discoverAndRegisterTools()
       └─ listMcpTools()
            └─ POST /  { method: "tools/list" }  →  動態註冊所有工具

AI Agent 呼叫工具（例如 patisco_get_orders）
  └─ withFreshCreds()
       ├─ JWT 距到期 < 5 分鐘  →  GET /auth/refresh  →  更新 credential store
       └─ JWT 仍有效           →  直接使用
  └─ POST /  { method: "tools/call", params: { name, arguments } }
       └─ Authorization: Bearer <jwt>
          X-Api-Key: <apiKey>
```

---

## 二、JWT Refresh 策略

JWT 有效期 **1 小時**（後端 1-hour window）。

| 時機 | 行為 |
|------|------|
| 距過期 ≥ 5 分鐘 | 直接使用現有 JWT |
| 距過期 < 5 分鐘 | 自動呼叫 `GET /auth/refresh`，更新 credential store |
| 後端 window 內 | 後端回傳快取 JWT（不呼叫 AuthServer） |
| 後端 window 外 | 後端向 AuthServer 取新 JWT 並更新 session |
| refresh 失敗（401）| 拋出明確錯誤：「請重新登入：openclaw auth patisco」 |

`upsertAuthProfileWithLock` 使用 file lock，多 agent 並行時安全。

---

## 三、目錄結構

```
extensions/patisco-auth/
├── index.ts        # Plugin 入口（auth provider + 動態工具發現）
├── auth.ts         # loginPatisco() + maybeRefreshJwt()
├── mcp.ts          # MCP JSON-RPC client（loadCredentials/listMcpTools/callMcpTool）
└── package.json
```

---

## 四、檔案說明

### `auth.ts`
- `loginPatisco(ctx)` — 互動式帳密登入，存 JWT（TokenCredential）+ API Key（ApiKeyCredential）
- `maybeRefreshJwt(creds, agentDir?)` — 距 JWT 到期 < 5 分鐘時自動 refresh 並寫回 store

### `mcp.ts`
- `loadCredentials(agentDir?)` — 從 credential store 讀取 JWT + API Key
- `withFreshCreds(agentDir?)` — 確保 JWT 有效後回傳（含 auto-refresh）
- `listMcpTools(agentDir?)` — 呼叫 `tools/list`，取得 server 提供的工具清單
- `callMcpTool(name, args, agentDir?)` — 呼叫 `tools/call`

### `index.ts`
- 註冊 `ProviderPlugin`（觸發 `openclaw auth patisco`）
- 非同步執行 `discoverAndRegisterTools()`：抓 `tools/list`，每個工具包裝成 `AnyAgentTool` 並呼叫 `api.registerTool()`
- MCP tool 的 `inputSchema`（JSON Schema）以 `Type.Unsafe()` 包裝為 TypeBox schema

---

## 五、使用流程

```bash
# 1. 首次登入（互動式）
openclaw auth patisco

# 2. 重啟 gateway 觸發工具發現
# （重啟後 discoverAndRegisterTools 自動執行 tools/list）

# 3. 確認工具已註冊（console 會印出）
# [patisco-auth] 已發現並註冊 N 個工具：patisco_get_orders, ...

# 4. AI Agent 現在可以呼叫工具
# JWT 到期前 5 分鐘會自動 refresh，使用者無感知
```

---

## 六、MCP Protocol 格式（Streamable HTTP）

**Request（POST https://mcp.patisco.com）：**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_orders",
    "arguments": { "status": "pending", "limit": 10 }
  }
}
```

**Headers：**
```
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer <jwt>
X-Api-Key: <apiKey>
```

**Response：**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "..." }],
    "isError": false
  }
}
```

---

## 七、關鍵規範（CLAUDE.md）

| 規範 | 實作方式 |
|------|---------|
| 禁止 `Type.Union` | 用 `Type.Unsafe(inputSchema)` 包裝 MCP JSON Schema |
| 禁止 `format` 屬性 | MCP inputSchema 直接透傳，不加 `format` |
| 敏感欄位 | `apiKey` 在 `ApiKeyCredential` 中自動被 `normalizeSecretInput` 處理 |
| file lock | JWT 更新用 `upsertAuthProfileWithLock`（而非同步版） |

---

## 八、參考檔案

| 檔案 | 用途 |
|------|------|
| `extensions/minimax-portal-auth/index.ts` | ProviderPlugin auth 參考 |
| `extensions/memory-lancedb/index.ts` | `api.registerTool` + tool result 格式參考 |
| `src/agents/auth-profiles/profiles.ts:67` | `upsertAuthProfileWithLock` 實作 |
| `src/agents/auth-profiles/store.ts` | `ensureAuthProfileStore` 實作 |
| `src/agents/auth-profiles/types.ts` | `TokenCredential`、`ApiKeyCredential` 型別 |
