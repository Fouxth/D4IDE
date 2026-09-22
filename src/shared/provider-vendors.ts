import { ModelInfo, ProviderConfig } from './types';
import { isLoopbackBaseUrl } from './local-endpoints';

/**
 * One vendor is one entry, even when it speaks several protocols.
 *
 * OpenCode's gateway answers on three different protocols — chat completions,
 * Anthropic's messages, and OpenAI's responses — and each one needs its own
 * request shape, so the app stores three provider configs for it. The settings
 * screen listed all three, which read as "three OpenCode Gos you have to
 * configure", and it showed every vendor that ships a preset whether or not the
 * user has ever put a key in it. What the user means by a provider is the
 * *company*: one card, one key, every model that vendor serves inside it.
 *
 * The protocol split stays exactly where it belongs — underneath. Each model
 * still belongs to one config, so routing a request is unchanged; only the
 * presentation is grouped.
 */

/**
 * Id suffixes that mean "another protocol of the same vendor", not a different
 * product. Deliberately a closed list: `-cn`, `-coding-plan` and `-plan` are
 * genuinely separate offerings with their own keys and prices, and folding them
 * together would hide a real distinction.
 */
const PROTOCOL_SUFFIXES = ['-messages', '-responses', '-gemini', '-chat', '-anthropic', '-openai'];

/** The vendor id behind a provider config id. */
export function vendorIdOf(providerId: string): string {
  for (const suffix of PROTOCOL_SUFFIXES) {
    if (providerId.endsWith(suffix) && providerId.length > suffix.length) {
      return providerId.slice(0, -suffix.length);
    }
  }
  return providerId;
}

/**
 * The vendor's own name, without the protocol note the preset appends to it:
 * "OpenCode Zen · Claude & Qwen" is still just "OpenCode Zen".
 */
export function vendorLabel(name: string): string {
  const beforeNote = (name || '').split('·')[0].trim();
  return beforeNote || name;
}

/**
 * True when the user has actually brought this provider into use.
 *
 * A stored key, or a connection the app has successfully reached, is proof.
 * Nothing else is: the seeded `status: 'local'` on a runtime like Ollama means
 * "this one needs no key", not "this one is installed", so treating it as proof
 * would put a card for every local runtime in front of a user who uses none of
 * them — the exact clutter this is meant to remove. A provider currently in use
 * is always shown as well, so the model being talked to can never be hidden.
 */
export function isProviderInUse(provider: ProviderConfig, activeProviderIds: string[] = []): boolean {
  if (provider.hasApiKey) return true;
  // A key that is on file but will not decrypt is still a provider the user set
  // up; hiding its card would hide the very thing they have to fix.
  if (provider.keyUnreadable) return true;
  if (provider.status === 'connected') return true;
  return activeProviderIds.includes(provider.id) || activeProviderIds.includes(vendorIdOf(provider.id));
}

/**
 * A runtime on this machine that needs no API key — Ollama, LM Studio, or any
 * other shipped no-key endpoint at a loopback address.
 *
 * The user asked for these to stay out of the model picker: the picker is meant
 * to list the accounts they connected, and Ollama answering on localhost is not
 * a decision to have it on the menu. A provider the user added themselves is not
 * in this class however local its URL is — pointing one at localhost is itself
 * the decision.
 */
export function isLocalRuntime(
  provider: Pick<ProviderConfig, 'requiresApiKey' | 'type' | 'baseUrl' | 'isCustom' | 'isBuiltIn'>
): boolean {
  if (provider.isCustom) return false;
  if (provider.requiresApiKey !== false) return false;
  if (provider.type === 'ollama') return true;
  // Every keyless preset D4IDE ships is a local runtime, and that is a fact worth
  // asserting elsewhere (see the provider-catalog test): LM Studio is seeded as an
  // OpenAI-compatible server, so the type alone would let it through.
  if (provider.isBuiltIn) return true;
  return isLoopbackBaseUrl(provider.baseUrl);
}

/**
 * Whether a provider belongs in the model picker.
 *
 * The picker is a menu, so it lists what can actually be talked to: a provider
 * with a key, one we have seen answer, or the one currently selected. Listing
 * every shipped preset would put forty unusable rows in front of the two the
 * user has set up — and the picker has its own "connect a provider" entry for
 * the rest.
 *
 * Local runtimes are the one case that needs an explicit opt-in. They carry no
 * key, so "the runtime reported models" was being read as "the user set this
 * up", and a user who uses neither Ollama nor LM Studio still found both in the
 * menu. With `localProvidersEnabled` off they are left out entirely; the picker
 * offers the switch that brings them back.
 */
export function isProviderChoosable(
  provider: ProviderConfig,
  activeProviderIds: string[] = [],
  options: { localProvidersEnabled?: boolean } = {}
): boolean {
  if (!provider.enabled) return false;
  // The local check comes before every other reason to show a provider: a runtime
  // that answered on this machine reports `connected`, which is precisely the
  // state the user did not want to see it in.
  if (isLocalRuntime(provider)) {
    // Still never hidden while it is the thing being talked to.
    if (activeProviderIds.includes(provider.id) || activeProviderIds.includes(vendorIdOf(provider.id))) return true;
    return options.localProvidersEnabled === true && (provider.models.length > 0 || provider.status === 'connected');
  }
  if (provider.hasApiKey) return provider.models.length > 0;
  if (provider.status === 'connected') return true;
  if (activeProviderIds.includes(provider.id) || activeProviderIds.includes(vendorIdOf(provider.id))) return true;
  if (provider.requiresApiKey !== false) return false;
  // Anything else keyless (a user's own endpoint) still needs a model to offer.
  return provider.models.length > 0;
}

/** A model and the config that owns it — needed to write an edit back. */
export interface VendorModel {
  model: ModelInfo;
  /** The provider config this model is served by. */
  providerId: string;
}

export interface VendorGroup {
  id: string;
  name: string;
  /** Every protocol config of this vendor, the base one first. */
  providers: ProviderConfig[];
  models: VendorModel[];
  inUse: boolean;
  /** The best status any of the vendor's connections reported. */
  status: ProviderConfig['status'];
  hasApiKey: boolean;
  /** True when a saved key is on file but can no longer be decrypted. */
  keyUnreadable: boolean;
  requiresApiKey: boolean;
  docsUrl?: string;
  latencyMs?: number;
  /** Protocol labels in play, e.g. ["openai", "anthropic"]. */
  protocols: string[];
}

/** Best-to-worst, so one working connection makes the card look alive. */
const STATUS_RANK: Record<string, number> = { connected: 0, local: 1, unknown: 2, not_configured: 3, error: 4 };

/** The base config first: the shortest id is the vendor's main protocol. */
const byBaseFirst = (a: ProviderConfig, b: ProviderConfig) =>
  a.id.length - b.id.length || a.id.localeCompare(b.id);

/** Groups provider configs into one entry per vendor, base connection first. */
export function groupProviders(
  providers: ProviderConfig[],
  options: { activeProviderIds?: string[] } = {}
): VendorGroup[] {
  const activeProviderIds = options.activeProviderIds ?? [];
  const groups = new Map<string, VendorGroup>();

  for (const provider of providers) {
    const id = vendorIdOf(provider.id);
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name: vendorLabel(provider.name),
        providers: [],
        models: [],
        inUse: false,
        status: provider.status,
        hasApiKey: false,
        keyUnreadable: false,
        requiresApiKey: false,
        protocols: []
      };
      groups.set(id, group);
    }
    group.providers.push(provider);
  }

  for (const group of groups.values()) {
    group.providers.sort(byBaseFirst);

    // The base connection names the vendor and carries its docs link; the
    // variants only add models.
    group.name = vendorLabel(group.providers[0].name);
    group.docsUrl = group.providers.find((p) => p.docsUrl)?.docsUrl;
    group.requiresApiKey = group.providers.some((p) => p.requiresApiKey !== false);
    group.hasApiKey = group.providers.some((p) => p.hasApiKey);
    group.keyUnreadable = group.providers.some((p) => p.keyUnreadable);
    group.inUse = group.providers.some((provider) => isProviderInUse(provider, activeProviderIds));
    group.protocols = Array.from(new Set(group.providers.map((p) => p.type)));

    group.status = group.providers.reduce<ProviderConfig['status']>((best, p) => {
      const rank = STATUS_RANK[p.status || 'unknown'] ?? STATUS_RANK.unknown;
      return rank < (STATUS_RANK[best || 'unknown'] ?? STATUS_RANK.unknown) ? p.status : best;
    }, group.providers[0].status);

    // One connection still being reachable does not fix an unreadable key, and it
    // must not make the card read "connected" while its key field can no longer
    // be filled in from storage.
    if (group.keyUnreadable && group.status !== 'connected') group.status = 'error';

    // One model per id: two protocols never serve the same model, but a user may
    // have added it by hand to both, and a duplicate row would be a lie.
    const seen = new Set<string>();
    for (const provider of group.providers) {
      for (const model of provider.models) {
        if (seen.has(model.id)) continue;
        seen.add(model.id);
        group.models.push({ model, providerId: provider.id });
      }
    }

    group.latencyMs = group.providers.find((p) => p.status === 'connected' && p.latencyMs !== undefined)?.latencyMs;
  }

  return Array.from(groups.values());
}
