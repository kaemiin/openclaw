# Patisco MCP Tool Provider 整合（目前版本）

> 更新日期：2026-03-06
> 類型：資料工具型 MCP Server（PI / 訂單查詢）
> 實際採用傳輸：**Unary JSON-RPC（POST /）**

---

## 一、最終架構（已上線做法）

```text
openclaw models auth login --provider patisco --method patisco:login
  └─ POST /auth/login -> jwt + apiKey
       └─ 寫入 ~/.openclaw/credentials/

Plugin 啟動（extensions/patisco-auth/index.ts）
  └─ listMcpTools() -> POST /  method=tools/list
       └─ 動態註冊工具（patisco_*）

Agent 呼叫工具
  └─ callMcpTool() -> POST /  method=tools/call
       └─ Authorization: Bearer <jwt>
          X-Api-Key: <apiKey>
```

---

## 二、為何改用 POST /（不是 /mcp SSE）

在 `PatiscoG4MCPGateway/src/routes/mcp.ts` 中：

- `POST /mcp` 需要 `sessionId` query
- 該 `sessionId` 必須先由 `GET /mcp` 建立並保存在 server 端 SSE connection map
- 若未完整維持 SSE lifecycle，會出現：
  - `Missing or invalid sessionId query parameter`
  - `SSE session not found: ...`

由於同一服務已提供 `POST /` unary RPC（不需 sessionId），
所以 OpenClaw plugin 最終改走 `POST /`，避免 SSE session 管理複雜度。

---

## 三、mcp.ts 目前行為

- endpoint：`https://.../`（root）
- 每次請求送 JSON-RPC 2.0 body：
  - `initialize`
  - `tools/list`
  - `tools/call`
- headers：
  - `Authorization: Bearer <jwt>`
  - `X-Api-Key: <apiKey>`
  - `Content-Type: application/json`
  - `Accept: application/json`
- 不再使用 `sessionId` / SSE bootstrap

---

## 四、工具註冊流程

1. plugin 載入
2. `discoverAndRegisterTools()` 呼叫 `listMcpTools()`
3. 取得工具定義後包裝成 OpenClaw `AnyAgentTool`
4. 以 `patisco_` 前綴註冊（如 `patisco_getPIs`）

Schema 處理：
- 使用 `Type.Unsafe(inputSchema)` 包裝 MCP JSON Schema

---

## 五、目前正確操作流程

```bash
cd /Users/kaemiin/LABORATORIES/openclaw
pnpm openclaw plugins list
pnpm openclaw models auth login --provider patisco --method patisco:login
pnpm openclaw gateway restart
```

成功訊號：

- log 顯示：
  - `[patisco-auth] 已發現並註冊 N 個 Patisco MCP 工具：...`

---

## 六、JWT Refresh 策略

- JWT 有效期約 1 小時
- 距到期 < 5 分鐘自動 `GET /auth/refresh`
- 成功後回寫 credential store
- refresh 失敗時要求重新登入

---

## 七、已驗證狀態（本次整合）

- `patisco-auth` plugin 可 loaded
- provider auth 可成功寫入 credential
- tools/list 已成功註冊工具（實測 `patisco_getPIs`）

---

## 八、關鍵檔案

- OpenClaw plugin
  - `extensions/patisco-auth/index.ts`
  - `extensions/patisco-auth/auth.ts`
  - `extensions/patisco-auth/mcp.ts`
- Patisco Gateway
  - `/Users/kaemiin/WORK/PatiscoG4MCPGateway/src/routes/mcp.ts`
