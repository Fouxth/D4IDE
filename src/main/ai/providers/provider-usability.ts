import { ProviderConfig } from '../../../shared/types';

/**
 * Whether a provider can be routed to right now (spec §26).
 *
 * The rule that matters here is about *shipped guesses*. D4IDE pre-fills Ollama
 * at `localhost:11434` and LM Studio at `127.0.0.1:1234`, and on most machines
 * nothing is listening. Treating those as usable means every fallback chain
 * spends a request and a retry backoff discovering that, so a **built-in**
 * keyless endpoint on this machine has to answer once before it is used.
 *
 * A provider the user added themselves is trusted: they pointed it somewhere on
 * purpose, and re-probing it on every fallback would be both slower and rude.
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

/** A shipped keyless endpoint that must prove it is running before it is routed to. */
export function requiresRunningEndpoint(
  provider: Pick<ProviderConfig, 'requiresApiKey' | 'baseUrl' | 'isBuiltIn'>
): boolean {
  return provider.isBuiltIn === true && !provider.requiresApiKey && isLoopbackBaseUrl(provider.baseUrl);
}
