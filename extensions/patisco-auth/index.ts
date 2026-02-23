/**
 * Patisco Auth + MCP Tool Provider Plugin
 *
 * 功能：
 *  1. 登入驗證（openclaw auth patisco）→ 存 JWT + API Key
 *  2. 啟動時動態從 MCP server 的 tools/list 發現工具清單
 *  3. 將每個 MCP tool 包裝成 OpenClaw AgentTool，帶上自動 JWT refresh
 */
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginApi } from "../../src/plugins/types.js";
import { loginPatisco } from "./auth.js";
import { callMcpTool, listMcpTools, type McpTool } from "./mcp.js";

// ── MCP Tool → OpenClaw AgentTool 轉換 ───────────────────────────────────────

/**
 * 將 MCP server 回傳的 tool 定義轉成 OpenClaw AgentTool。
 * inputSchema 是標準 JSON Schema object，以 Type.Unsafe() 直接包裝。
 *
 * 規範提醒：不使用 Type.Union / anyOf / oneOf（見 CLAUDE.md）。
 */
function mcpToolToAgentTool(mcpTool: McpTool, agentDir?: string): AnyAgentTool {
  return {
    // 加 patisco_ 前綴避免與其他工具衝突
    name: `patisco_${mcpTool.name}`,
    label: mcpTool.name.replaceAll("_", " "),
    description: mcpTool.description ?? `Patisco MCP tool: ${mcpTool.name}`,
    // 直接包裝 MCP 的 JSON Schema（Type.Unsafe 支援任意合法 JSON Schema）
    parameters: Type.Unsafe(mcpTool.inputSchema),

    async execute(_toolCallId, params) {
      // 移除 _agentDir 注入鍵（若有），其餘全數傳給 MCP server
      const { _agentDir: _dir, ...mcpArgs } = params as Record<string, unknown>;
      const result = await callMcpTool(mcpTool.name, mcpArgs, agentDir);

      // 若 MCP server 回報工具執行錯誤，顯示明確訊息
      if (result.isError) {
        const errText = result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
        return {
          content: [{ type: "text", text: `工具執行失敗：${errText}` }],
        };
      }

      // 直接回傳 MCP content（格式與 OpenClaw AgentToolResult 相容）
      return { content: result.content };
    },
  };
}

// ── 動態工具發現（非同步初始化）────────────────────────────────────────────────

/**
 * Plugin 啟動時非同步抓取 tools/list，逐一向 api 註冊。
 * 若 MCP server 暫時不可用，靜默跳過（不影響其他功能）。
 */
async function discoverAndRegisterTools(
  api: OpenClawPluginApi,
  agentDir?: string,
): Promise<void> {
  let tools: McpTool[];

  try {
    tools = await listMcpTools(agentDir);
  } catch (err) {
    // 尚未登入或 server 不可用 — 等使用者登入後下次再試
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("尚未登入")) {
      console.warn(`[patisco-auth] tools/list 失敗：${msg}`);
    }
    return;
  }

  for (const mcpTool of tools) {
    api.registerTool(mcpToolToAgentTool(mcpTool, agentDir), {
      name: `patisco_${mcpTool.name}`,
    });
  }

  console.info(
    `[patisco-auth] 已發現並註冊 ${tools.length} 個 Patisco MCP 工具：` +
      tools.map((t) => `patisco_${t.name}`).join(", "),
  );
}

// ── Plugin 入口 ───────────────────────────────────────────────────────────────

export default function plugin(api: OpenClawPluginApi): void {
  // 1. 認證 Provider（觸發 openclaw auth patisco）
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

  // 2. 動態工具發現 — 非同步啟動，不阻塞 plugin 載入
  //    登入後重啟 gateway 可重新發現工具
  discoverAndRegisterTools(api).catch(() => {
    // 已在 discoverAndRegisterTools 內部 warn，這裡靜默
  });
}
