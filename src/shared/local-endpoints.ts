/**
 * Whether an address points at the machine the app is running on.
 *
 * Both processes need this: main decides whether a shipped, keyless endpoint has
 * to prove it is running before a request is routed to it, and the renderer
 * decides whether a provider is one of the "local runtime" entries that stay out
 * of the model picker until the user asks for them. One implementation, because
 * two spellings of "is this local?" is how the picker and the router drift.
 */

/** True only for a real IPv4 literal in 127.0.0.0/8 — not for a name that starts with "127.". */
const isLoopbackIpv4 = (host: string): boolean => {
  const octets = host.split('.');
  if (octets.length !== 4) return false;
  if (!octets.every((octet) => /^\d{1,3}$/.test(octet))) return false;
  return octets.every((octet) => Number(octet) <= 255) && octets[0] === '127';
};

export function isLoopbackBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
    if (isLoopbackIpv4(host)) return true;
    // mDNS names resolve to the local machine, which is what "local server" means.
    return host.endsWith('.local') || host.endsWith('.localhost');
  } catch {
    return false;
  }
}
