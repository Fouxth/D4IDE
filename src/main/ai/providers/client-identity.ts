import { USER_AGENT } from '../../../shared/version';

/**
 * Request identity.
 *
 * Two headers that are not optional in practice:
 *
 * - `User-Agent`: the OpenCode Go subscription is documented to expect a client
 *   that identifies itself ("such as my-coding-agent/1.0") instead of a generic
 *   HTTP library, and traffic that degrades the shared pool can be throttled.
 * - `x-opencode-session`: Go asks for a stable session id per conversation so it
 *   can route consistently and reuse prompt caching. Without it every request
 *   looks like a brand new conversation, which costs more and caches nothing.
 *
 * The session header is only sent to OpenCode's own gateway: it means nothing to
 * other providers, and pretending otherwise would put a vendor-specific header
 * on every request in the app.
 */

/** Hosts that understand `x-opencode-session`. */
const SESSION_HEADER_HOSTS = ['opencode.ai'];

/**
 * Session id for requests that are not part of a conversation: a connection
 * test, a key probe, a model listing.
 *
 * Go refuses a request that carries no session id at all — it answers
 * `400 Request is missing x-opencode-session and cannot be routed efficiently` —
 * so "this request belongs to no conversation" is not something the gateway
 * accepts. A probe that sent nothing therefore failed the connection test of a
 * provider that works, which then made the agent warn about a failure the user
 * had already fixed. One shared value keeps probe traffic out of every
 * conversation's routing and prompt cache.
 */
export const PROBE_SESSION_ID = 'd4ide-connectivity-probe';

export function supportsSessionHeader(targetUrl: string): boolean {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    return SESSION_HEADER_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

/**
 * Headers every provider request carries. `sessionId` is the agent session, not
 * a socket session — it stays the same for the whole conversation.
 */
export function buildIdentityHeaders(targetUrl: string, sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = { 'user-agent': USER_AGENT };
  if (supportsSessionHeader(targetUrl)) headers['x-opencode-session'] = sessionId || PROBE_SESSION_ID;
  return headers;
}
