import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config } from "../config/config";
import { logger } from "../utils/logger";

type ToolResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  [key: string]: unknown;
};

const extractToolPayload = (result: ToolResult): unknown => {
  if (!result) {
    return result;
  }
  if (Array.isArray(result.content)) {
    const text = result.content.find((item) => item.type === "text")?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }
  return result;
};

export class ClickUpMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connecting: Promise<void> | null = null;

  private async ensureConnected(): Promise<void> {
    if (this.client) {
      return;
    }
    if (this.connecting) {
      await this.connecting;
      return;
    }

    const env = {
      ...process.env,
      CLICKUP_API_KEY: config.clickup.apiKey,
      CLICKUP_TEAM_ID: config.clickup.teamId,
      CLICKUP_MCP_LICENSE_KEY: config.clickup.licenseKey,
    } as Record<string, string>;

    if (config.mcp.path) {
      env.PATH = config.mcp.path;
    }

    this.transport = new StdioClientTransport({
      command: config.mcp.command,
      args: config.mcp.args,
      env,
    });

    this.client = new Client({ name: "clickup-agent", version: "0.1.0" }, { capabilities: {} });

    this.connecting = this.client.connect(this.transport).then(() => {
      this.connecting = null;
    });

    logger.info("mcp_connecting", { command: config.mcp.command, args: config.mcp.args });
    await this.connecting;
    logger.info("mcp_connected");
  }

  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureConnected();
    logger.info("mcp_call_tool", { name, args });
    const result = (await this.client?.callTool({ name, arguments: args })) as ToolResult;
    if (result?.isError) {
      logger.error("mcp_tool_error", { name, error: result, content: result?.content });
      throw new Error(`MCP tool error: ${name}: ${JSON.stringify(result?.content || result)}`);
    }
    logger.info("mcp_tool_success", { name });
    return extractToolPayload(result) as T;
  }

  async getWorkspaceTasks(params: Record<string, unknown>): Promise<unknown> {
    return this.callTool("get_workspace_tasks", params);
  }

  async getWorkspaceMembers(): Promise<unknown> {
    return this.callTool("get_workspace_members", {});
  }

  async listTools(): Promise<any[]> {
    await this.ensureConnected();
    const response = await this.client?.listTools();
    return response?.tools ?? [];
  }

  async close(): Promise<void> {
    await this.client?.close();
    await this.transport?.close();
    this.client = null;
    this.transport = null;
  }
}
