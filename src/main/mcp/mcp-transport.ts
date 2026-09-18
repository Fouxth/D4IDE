import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { McpServerConfig } from '../../shared/types';

/**
 * MCP transports (spec §42).
 *
 * The protocol is JSON-RPC either way, but the framing is not: a stdio server
 * writes one JSON object per line, while a hosted server answers an HTTP POST
 * with either a JSON body or an SSE stream. Keeping that difference behind one
 * interface means the client — handshake, tool discovery, call routing, health —
 * is written once and the parsing rules can be tested on their own.
 */

export interface McpTransportHandlers {
  onMessage: (message: any) => void;
  /** The transport is gone; the client marks the server disconnected. */
  onClose: (reason?: string) => void;
  onError: (error: Error) => void;
}

export interface McpTransport {
  send: (payload: unknown) => void;
  close: () => void;
}

const REQUEST_HEADER_TIMEOUT_MS = 120000;

/** True when this server should be reached over HTTP rather than spawned. */
export function isHttpConfig(config: Pick<McpServerConfig, 'transport' | 'url' | 'command'>): boolean {
  if (config.transport === 'http') return true;
  if (config.transport === 'stdio') return false;
  // No explicit transport: a URL without a command can only be HTTP.
  return !!config.url && !config.command;
}

/**
 * Splits an SSE buffer into complete JSON-RPC messages, keeping the trailing
 * partial block so the next chunk can finish it. Comment-only blocks and
 * keep-alives are ignored rather than treated as errors.
 */
export function parseSseMessages(buffer: string): { messages: any[]; rest: string } {
  const messages: any[] = [];
  let rest = buffer;

  for (;;) {
    const boundary = rest.search(/\r?\n\r?\n/);
    if (boundary < 0) break;

    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary).replace(/^\r?\n\r?\n/, '');

    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
      .trim();

    if (!data) continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // A partial or non-JSON event is not fatal: the server may send progress
      // notifications we do not care about.
    }
  }

  return { messages, rest };
}

/**
 * Turns one HTTP response body into messages. A server may answer with a plain
 * JSON body, an SSE stream, or (rarely) SSE without advertising the content type,
 * so the content type is a hint rather than a contract.
 */
export function readHttpPayload(contentType: string, body: string): any[] {
  if (contentType.includes('text/event-stream')) return parseSseMessages(`${body}\n\n`).messages;

  const trimmed = body.trim();
  if (!trimmed) return [];

  try {
    return [JSON.parse(trimmed)];
  } catch {
    return parseSseMessages(`${body}\n\n`).messages;
  }
}

/** Request headers for an HTTP call, including any MCP session the server issued. */
export function buildHttpHeaders(
  config: Pick<McpServerConfig, 'headers'>,
  sessionId?: string
): Record<string, string> {
  return {
    'content-type': 'application/json',
    // Both are advertised: servers may answer with either, per the spec.
    accept: 'application/json, text/event-stream',
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    ...(config.headers ?? {})
  };
}

/**
 * Normalises one entry of `.d4ide/mcp.json` into a server config. Returns null
 * for entries that name neither a command nor a URL, because such a server can
 * never be reached — better to skip it than to show a broken row in Settings.
 */
export function normalizeMcpConfig(raw: any): McpServerConfig | null {
  if (!raw || (!raw.id && !raw.name)) return null;

  const url: string | undefined = typeof raw.url === 'string' ? raw.url : undefined;
  const command: string = typeof raw.command === 'string' ? raw.command : '';
  const transport: McpServerConfig['transport'] =
    raw.transport === 'http' || raw.transport === 'stdio'
      ? raw.transport
      : isHttpConfig({ transport: undefined, url, command })
        ? 'http'
        : 'stdio';

  if (transport === 'http' && !url) return null;
  if (transport === 'stdio' && !command) return null;

  return {
    id: String(raw.id || raw.name),
    name: String(raw.name || raw.id),
    transport,
    command,
    args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
    env: raw.env && typeof raw.env === 'object' ? raw.env : undefined,
    url,
    headers: raw.headers && typeof raw.headers === 'object' ? raw.headers : undefined,
    enabled: raw.enabled !== false,
    status: 'disconnected'
  };
}

/** Spawns a local MCP server and frames newline-delimited JSON. */
export function createStdioTransport(
  config: McpServerConfig,
  cwd: string | undefined,
  handlers: McpTransportHandlers
): McpTransport {
  let buffer = '';
  let proc: ChildProcessWithoutNullStreams | null = null;

  try {
    proc = spawn(config.command, config.args || [], {
      cwd,
      env: { ...process.env, ...(config.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32'
    });
  } catch (error) {
    handlers.onError(error as Error);
    return { send: () => undefined, close: () => undefined };
  }

  const child = proc;

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        handlers.onMessage(JSON.parse(line));
      } catch {
        // Non-JSON output from the server is ignored.
      }
    }
  });

  child.stderr.on('data', () => {
    // MCP servers log to stderr; keep it out of the protocol stream.
  });
  child.on('error', (error) => handlers.onError(error as Error));
  child.on('close', () => handlers.onClose('MCP server closed'));

  return {
    send: (payload) => {
      try {
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        handlers.onError(error as Error);
      }
    },
    close: () => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }
  };
}

/**
 * Talks to a hosted MCP server over HTTP. Each request is one POST; the answer
 * may be a JSON body or an SSE stream. Servers that hand out a session id get it
 * echoed back on every later request, which is how the Streamable HTTP transport
 * keeps state without cookies.
 */
export function createHttpTransport(
  config: McpServerConfig,
  handlers: McpTransportHandlers
): McpTransport {
  let sessionId: string | undefined;
  let closed = false;

  return {
    send: (payload) => {
      if (closed || !config.url) return;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_HEADER_TIMEOUT_MS);

      void (async () => {
        try {
          const response = await fetch(config.url as string, {
            method: 'POST',
            headers: buildHttpHeaders(config, sessionId),
            body: JSON.stringify(payload),
            signal: controller.signal
          });

          const issuedSession = response.headers.get('mcp-session-id');
          if (issuedSession) sessionId = issuedSession;

          const body = await response.text();

          if (!response.ok) {
            handlers.onError(new Error(`MCP server responded ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`));
            return;
          }

          for (const message of readHttpPayload(response.headers.get('content-type') ?? '', body)) {
            handlers.onMessage(message);
          }
        } catch (error) {
          const aborted = (error as Error)?.name === 'AbortError';
          handlers.onError(new Error(aborted ? 'MCP HTTP request timed out' : (error as Error).message));
        } finally {
          clearTimeout(timer);
        }
      })();
    },
    close: () => {
      closed = true;
    }
  };
}

/** Picks the transport the config asks for. */
export function createMcpTransport(
  config: McpServerConfig,
  cwd: string | undefined,
  handlers: McpTransportHandlers
): McpTransport {
  return isHttpConfig(config) ? createHttpTransport(config, handlers) : createStdioTransport(config, cwd, handlers);
}
