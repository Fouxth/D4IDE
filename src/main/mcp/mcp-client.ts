import { McpServerConfig } from '../../shared/types';
import { McpTransport, createMcpTransport, isHttpConfig } from './mcp-transport';

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
  serverId: string;
  /** Fully-qualified name exposed to the agent tool registry. */
  qualifiedName: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface McpConnection {
  config: McpServerConfig;
  transport?: McpTransport;
  nextId: number;
  pending: Map<number, PendingRequest>;
  tools: McpToolInfo[];
  status: McpServerConfig['status'];
  error?: string;
  initialized: boolean;
  /** In-flight sends, so a health check can tell "busy" from "hung". */
  lastActivityAt: number;
}

const PROTOCOL_VERSION = '2024-11-05';
const REQUEST_TIMEOUT_MS = 20000;

/**
 * MCP client (spec §42): connect a server over stdio or HTTP, perform the
 * initialize handshake, discover tools, and route tool calls through it.
 *
 * The transport is the only part that differs between a local process and a
 * hosted endpoint, so everything protocol-shaped lives here.
 */
export class McpClient {
  private connections = new Map<string, McpConnection>();

  list(): McpServerConfig[] {
    return Array.from(this.connections.values()).map((c) => ({
      ...c.config,
      status: c.status,
      error: c.error
    }));
  }

  /** Connection health for Settings → MCP. */
  health(serverId: string): { status: McpServerConfig['status']; tools: number; lastActivityAt: number; error?: string } | null {
    const connection = this.connections.get(serverId);
    if (!connection) return null;
    return {
      status: connection.status,
      tools: connection.tools.length,
      lastActivityAt: connection.lastActivityAt,
      error: connection.error
    };
  }

  getTools(serverId?: string): McpToolInfo[] {
    const connections = Array.from(this.connections.values()).filter(
      (c) => c.status === 'connected' && (!serverId || c.config.id === serverId)
    );
    return connections.flatMap((c) => c.tools);
  }

  /** All registered tools across servers, for the Settings → MCP tool list. */
  toolsByServer(): { serverId: string; serverName: string; tools: { name: string; description?: string }[] }[] {
    return Array.from(this.connections.values()).map((c) => ({
      serverId: c.config.id,
      serverName: c.config.name,
      tools: c.tools.map((t) => ({ name: t.name, description: t.description }))
    }));
  }

  async start(config: McpServerConfig, cwd?: string): Promise<{ success: boolean; tools?: McpToolInfo[]; error?: string }> {
    await this.stop(config.id);

    const connection: McpConnection = {
      config,
      nextId: 1,
      pending: new Map(),
      tools: [],
      status: 'connecting',
      initialized: false,
      lastActivityAt: Date.now()
    };
    this.connections.set(config.id, connection);

    try {
      connection.transport = createMcpTransport(config, cwd, {
        onMessage: (message) => this.onMessage(connection, message),
        onError: (error) => {
          connection.error = error.message;
          connection.status = 'error';
          this.rejectAll(connection, error.message);
        },
        onClose: (reason) => {
          connection.status = 'disconnected';
          this.rejectAll(connection, reason || 'MCP server closed');
        }
      });

      await this.request(connection, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        clientInfo: { name: 'D4IDE', version: '1.0.0' }
      });
      this.notify(connection, 'notifications/initialized', {});

      connection.initialized = true;
      connection.status = 'connected';

      // Discovery failing is not the same as connecting failing: a server with no
      // tools is still usable for resources, so report the connection as good.
      const tools = await this.refreshTools(config.id);
      return { success: true, tools };
    } catch (e: any) {
      connection.error = e?.message || 'Failed to start MCP server';
      connection.status = 'error';
      this.stop(config.id).catch(() => undefined);
      // Keep the failed row visible in Settings so the user can read the reason.
      const failed = { ...connection, transport: undefined };
      this.connections.set(config.id, failed);
      return { success: false, error: connection.error };
    }
  }

  /** Re-runs tools/list on a live server (spec §42 tool discovery). */
  async refreshTools(serverId: string): Promise<McpToolInfo[]> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.initialized) return [];

    try {
      const listed = await this.request(connection, 'tools/list', {});
      const tools: any[] = Array.isArray(listed?.tools) ? listed.tools : [];
      connection.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        serverId: connection.config.id,
        qualifiedName: `mcp__${connection.config.id}__${t.name}`
      }));
      if (connection.status !== 'connected') connection.status = 'connected';
      connection.error = undefined;
      return connection.tools;
    } catch (e: any) {
      connection.error = e?.message || 'Tool discovery failed';
      return connection.tools;
    }
  }

  async stop(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) return;
    this.rejectAll(connection, 'MCP server stopped');
    try {
      connection.transport?.close();
    } catch {
      // Already gone.
    }
    this.connections.delete(serverId);
  }

  async stopAll(): Promise<void> {
    for (const id of Array.from(this.connections.keys())) await this.stop(id);
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    const connection = this.connections.get(serverId);
    if (!connection || connection.status !== 'connected') {
      return { success: false, error: `MCP server "${serverId}" is not connected` };
    }
    try {
      const result = await this.request(connection, 'tools/call', { name: toolName, arguments: args });
      const text = Array.isArray(result?.content)
        ? result.content.map((part: any) => part.text ?? JSON.stringify(part)).join('\n')
        : JSON.stringify(result);
      return { success: !result?.isError, output: text, error: result?.isError ? text : undefined };
    } catch (e: any) {
      return { success: false, error: e?.message || 'MCP tool call failed' };
    }
  }

  private onMessage(connection: McpConnection, message: any): void {
    connection.lastActivityAt = Date.now();
    if (message?.id === undefined) return; // A notification, not an answer.

    const pending = connection.pending.get(message.id);
    if (!pending) return;

    connection.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || 'MCP error'));
    else pending.resolve(message.result);
  }

  private notify(connection: McpConnection, method: string, params: unknown): void {
    connection.transport?.send({ jsonrpc: '2.0', method, params });
  }

  private request(connection: McpConnection, method: string, params: unknown): Promise<any> {
    const id = connection.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out`));
      }, REQUEST_TIMEOUT_MS);
      // Node keeps the process alive for a pending timer otherwise; a hung server
      // must not stop the app from quitting.
      timer.unref?.();

      connection.pending.set(id, { resolve, reject, timer });
      connection.lastActivityAt = Date.now();
      connection.transport?.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private rejectAll(connection: McpConnection, reason: string): void {
    for (const [, pending] of connection.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    connection.pending.clear();
  }
}

export const mcpClient = new McpClient();

export { isHttpConfig };
