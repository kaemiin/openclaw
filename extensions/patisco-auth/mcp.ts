/**
 * Patisco MCP Client — 走 Unary JSON-RPC（POST /）。
 * 正式環境: https://mcp.patisco.com
 * 測試環境: https://patisco-g4-mcp-gateway.dz920507desm2.us-east-1.cs.amazonlightsail.com
 */
import { ensureAuthProfileStore } from "../../src/agents/auth-profiles/store.js";
import { maybeRefreshJwt, JWT_PROFILE_ID, API_KEY_PROFILE_ID } from "./auth.js";
import type { PatiscoCredentials } from "./auth.js";

// 此 gateway 已提供 POST / unary 模式（不需 SSE sessionId）
const MCP_URL = "https://patisco-g4-mcp-gateway.dz920507desm2.us-east-1.cs.amazonlightsail.com/";

let requestId = 1;

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

async function withFreshCreds(agentDir?: string): Promise<PatiscoCredentials> {
  const creds = loadCredentials(agentDir);
  if (!creds) {
    throw new Error(
      "尚未登入 Patisco，請先執行：openclaw models auth login --provider patisco --method patisco:login",
    );
  }
  return maybeRefreshJwt(creds, agentDir);
}

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse<T = unknown> = {
  jsonrpc: "2.0";
  id: number | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

async function rpc<T>(method: string, params: unknown, creds: PatiscoCredentials): Promise<T> {
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
      Accept: "application/json",
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

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

type ListToolsResult = { tools: McpTool[] };

type CallToolResult = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
};

async function initialize(creds: PatiscoCredentials): Promise<void> {
  await rpc(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "openclaw-patisco", version: "1.0.0" },
    },
    creds,
  );

  await rpc("notifications/initialized", {}, creds).catch(() => {
    // 部分 server 不要求 initialized 通知
  });
}

export async function listMcpTools(agentDir?: string): Promise<McpTool[]> {
  const creds = await withFreshCreds(agentDir);
  await initialize(creds);
  const result = await rpc<ListToolsResult>("tools/list", {}, creds);
  return result.tools ?? [];
}

export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  agentDir?: string,
): Promise<CallToolResult> {
  const creds = await withFreshCreds(agentDir);
  return rpc<CallToolResult>("tools/call", { name: toolName, arguments: args }, creds);
}
