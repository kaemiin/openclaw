/**
 * Patisco MCP Client — 標準 MCP Streamable HTTP Transport (JSON-RPC 2.0)。
 * 正式環境:https://mcp.patisco.com/mcp
 * 測試環境:https://patisco-g4-mcp-gateway.dz920507desm2.us-east-1.cs.amazonlightsail.com/mcp
 * 端點：POST https://mcp.patisco.com/mcp
 * 每次呼叫前由 withFreshCreds() 自動 refresh JWT。
 *
 * 參考規格：https://spec.modelcontextprotocol.io/specification/basic/transports/
 */
import { ensureAuthProfileStore } from "../../src/agents/auth-profiles/store.js";
import { maybeRefreshJwt, JWT_PROFILE_ID, API_KEY_PROFILE_ID } from "./auth.js";
import type { PatiscoCredentials } from "./auth.js";
import { createHash } from "node:crypto";

const MCP_URL = "https://patisco-g4-mcp-gateway.dz920507desm2.us-east-1.cs.amazonlightsail.com/mcp";

let requestId = 1;

// ── 憑證讀取 ──────────────────────────────────────────────────────────────────

/** 從 credential store 讀取 JWT + API Key。未登入時回傳 null。 */
export function loadCredentials(agentDir?: string): PatiscoCredentials | null {
  const store = ensureAuthProfileStore(agentDir);
  const tokenCred = store.profiles[JWT_PROFILE_ID];
  const apiKeyCred = store.profiles[API_KEY_PROFILE_ID];

  if (
    !tokenCred ||
    tokenCred.type !== "token" ||
    !apiKeyCred ||
    apiKeyCred.type !== "api_key" ||
    !apiKeyCred.key
  ) {
    return null;
  }

  return {
    jwt: tokenCred.token,
    apiKey: apiKeyCred.key,
    jwtExpires: tokenCred.expires ?? 0,
  };
}

/**
 * 確保 JWT 有效後回傳最新憑證。
 * 若 JWT 即將到期（< 5 分鐘）自動 refresh。
 */
async function withFreshCreds(agentDir?: string): Promise<PatiscoCredentials> {
  const creds = loadCredentials(agentDir);
  if (!creds) {
    throw new Error("尚未登入 Patisco，請先執行：openclaw auth patisco");
  }
  return maybeRefreshJwt(creds, agentDir);
}

// ── JSON-RPC 底層 ─────────────────────────────────────────────────────────────

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
  sessionId?: string;
};

type JsonRpcResponse<T = unknown> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

/** 根據 agentDir 產生穩定的 sessionId (用於後端 Server 路由)。 */
function getSessionId(agentDir?: string): string {
  if (!agentDir) return "global";
  return createHash("md5").update(agentDir).digest("hex");
}

async function rpc<T>(
  method: string,
  params: unknown,
  creds: PatiscoCredentials,
  agentDir?: string,
): Promise<T> {
  const sessionId = getSessionId(agentDir);
  const body: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: requestId++,
    method,
    params,
    sessionId,
  };

  // 伺服器目前要求 sessionId 必須放在 query parameter；
  // body 仍保留 sessionId 以相容標準 JSON-RPC 封包。
  const url = new URL(MCP_URL);
  url.searchParams.set("sessionId", sessionId);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${creds.jwt}`,
      "X-Api-Key": creds.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`MCP Server 錯誤 (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as JsonRpcResponse<T>;

  if (data.error) {
    throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
  }

  return data.result as T;
}

// ── MCP Protocol Methods ──────────────────────────────────────────────────────

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

type ListToolsResult = {
  tools: McpTool[];
};

type CallToolResult = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
};

/** 初始化 MCP session（部分 server 必要）。 */
async function initialize(
  creds: PatiscoCredentials,
  agentDir?: string,
): Promise<void> {
  await rpc(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "openclaw-patisco", version: "1.0.0" },
    },
    creds,
    agentDir,
  ).catch(() => {
    // 部分 HTTP server 不強制 initialize，忽略錯誤繼續
  });
}

/** 取得 MCP server 提供的所有工具清單。 */
export async function listMcpTools(agentDir?: string): Promise<McpTool[]> {
  const creds = await withFreshCreds(agentDir);
  await initialize(creds, agentDir);
  const result = await rpc<ListToolsResult>("tools/list", {}, creds, agentDir);
  return result.tools ?? [];
}

/** 呼叫 MCP server 上的工具。 */
export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  agentDir?: string,
): Promise<CallToolResult> {
  const creds = await withFreshCreds(agentDir);
  return rpc<CallToolResult>(
    "tools/call",
    { name: toolName, arguments: args },
    creds,
    agentDir,
  );
}
