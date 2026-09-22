import { ProviderConfig } from '../../../shared/types';
import { isLoopbackBaseUrl } from '../../../shared/local-endpoints';

// Re-exported for the callers that already import it from here.
export { isLoopbackBaseUrl };

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

/** A shipped keyless endpoint that must prove it is running before it is routed to. */
export function requiresRunningEndpoint(
  provider: Pick<ProviderConfig, 'requiresApiKey' | 'baseUrl' | 'isBuiltIn'>
): boolean {
  return provider.isBuiltIn === true && !provider.requiresApiKey && isLoopbackBaseUrl(provider.baseUrl);
}
