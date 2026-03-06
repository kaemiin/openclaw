# Patisco MCP 接口設計說明

本專案設計的 **MCP (Model Context Protocol)** 接口主要用於整合 Patisco 的後端資料服務（如訂單查詢、PI 管理等），讓 AI Agent 能直接調用這些工具。

以下是該接口設計的核心架構與技術細節：

### 1. 接口類型與傳輸協議

- **類型**：資料工具型 MCP Server (Tool Provider)。
- **協議**：標準 **MCP Streamable HTTP Transport**。
- **格式**：基於 **JSON-RPC 2.0** 進行溝通。
- **端點 (Endpoint)**：`POST https://mcp.patisco.com/mcp`

### 2. 身分驗證與安全設計 (Auth & Security)

專案採用了雙重憑證機制，並整合於 `openclaw auth` 指令中：

- **憑證組合**：
  - **JWT (TokenCredential)**：有效期 1 小時，作為主要存取憑證。
  - **API Key (ApiKeyCredential)**：永久有效，作為後端識別專案與租戶的關鍵。
- **自動刷新 (Auto-Refresh)**：
  - 客戶端（Extension）會檢查 JWT 效期，若剩餘時間 **< 5 分鐘**，會自動觸發 `GET /auth/refresh` 取得新 Token。
  - 這確保了 AI 在長對話中執行工具時，不會因為 Token 到期而失敗，對使用者完全透明。
- **儲存位置**：憑證安全地存放在 `~/.openclaw/credentials/` 下。

### 3. 工具動態發現與註冊 (Discovery & Registration)

- **動態註冊**：當 Plugin (`extensions/patisco-auth`) 啟動時，會向伺服器發送 `tools/list` 請求。
- **工具包裝**：從 MCP Server 取得的工具清單會動態轉換為 OpenClaw 的 `AnyAgentTool` 並使用 `api.registerTool()` 註冊。
- **Schema 處理**：
  - 由於 MCP 採用的 JSON Schema 可能包含 `Type.Union` 或 `format` 等 OpenClaw 預設限制的屬性，實作上使用了 TypeBox 的 `Type.Unsafe()` 進行包裝，以確保各種複雜的參數結構都能正確傳遞。

### 4. 請求與回應規範 (JSON-RPC)

所有的工具呼叫都遵循以下格式：

- **Request 內容**：
  - 包含 `method: "tools/call"`。
  - **`sessionId`**：使用 `agentDir` 的 MD5 Hash 推導出穩定的 Session ID，確保伺服器端能進行正確的 Session Routing。
- **Header 參數**：
  ```http
  Authorization: Bearer <jwt>
  X-Api-Key: <apiKey>
  Content-Type: application/json
  ```
- **Response 格式**：
  - 標準 MCP `CallToolResult`，包含 `content` 陣列（類型多為 `text`）以及 `isError` 旗標。

### 5. 目錄結構參考

- **`extensions/patisco-auth/`**：客戶端實作，負責 Auth 流程、JWT 刷新與 MCP JSON-RPC 調用。
- **`patisco/docs/`**：存放詳細的整合規格文件，包含 `mcp-tool-provider-integration.md` 與 `mcp-auth-integration.md`。
