/**
 * Patisco MCP Client — 標準 MCP Streamable HTTP Transport (JSON-RPC 2.0)。
 *
 * 端點：POST https://mcp.patisco.com
 * 每次呼叫前由 withFreshCreds() 自動 refresh JWT。
 *
 * 參考規格：https://spec.modelcontextprotocol.io/specification/basic/transports/
 */
import { ensureAuthProfileStore } from "../../src/agents/auth-profiles/store.js";
import { maybeRefreshJwt, JWT_PROFILE_ID, API_KEY_PROFILE_ID } from "./auth.js";
import type { PatiscoCredentials } from "./auth.js";

const MCP_URL = "https://mcp.patisco.com";

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
};

type JsonRpcResponse<T = unknown> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

async function rpc<T>(
  method: string,
  params: unknown,
  creds: PatiscoCredentials,
): Promise<T> {
  const body: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: requestId++,
    method,
    params,
  };

  const res = await fetch(MCP_URL, {
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
async function initialize(creds: PatiscoCredentials): Promise<void> {
  await rpc(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "openclaw-patisco", version: "1.0.0" },
    },
    creds,
  ).catch(() => {
    // 部分 HTTP server 不強制 initialize，忽略錯誤繼續
  });
}

/** 取得 MCP server 提供的所有工具清單。 */
export async function listMcpTools(agentDir?: string): Promise<McpTool[]> {
  const creds = await withFreshCreds(agentDir);
  await initialize(creds);
  const result = await rpc<ListToolsResult>("tools/list", {}, creds);
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
  );
}
