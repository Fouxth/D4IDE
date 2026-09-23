/**
 * The inventory behind the "my local models" card.
 *
 * The card answers "what do I have, how big, and who uses it" — so the service
 * asks each runtime for its list and, for Ollama, keeps the byte size only
 * Ollama reports. LM Studio's `/v1/models` has no sizes; its models arrive with
 * `sizeBytes` unset and the card renders them without one. A runtime that does
 * not answer simply contributes nothing to the snapshot.
 */
import { isLocalRuntime } from '../../shared/provider-vendors';
import type { ProviderConfig } from '../../shared/types';

export interface LocalModelAnswer {
  providerId: string;
  models: Array<{ id?: string; name?: string; sizeBytes?: number; detail?: string }>;
}

export interface LocalModelsInventory {
  answers: LocalModelAnswer[];
  fetchedAt: number;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

export const LOCAL_MODELS_TIMEOUT_MS = 2500;

/** Ollama's native answer: `{ models: [{ name, size, details }] }`. */
async function fetchOllama(baseUrl: string, providerId: string, fetchImpl: FetchLike): Promise<LocalModelAnswer | null> {
  const nativeBase = baseUrl.replace(/\/v1\/?$/, '');
  try {
    const res = await fetchImpl(`${nativeBase}/api/tags`, { signal: AbortSignal.timeout(LOCAL_MODELS_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string; size?: number; details?: { family?: string; parameter?: string; quantization_level?: string } }> } | null;
    const models = Array.isArray(data?.models) ? data.models : [];
    return {
      providerId,
      models: models.map((m) => ({
        id: m.name || m.model,
        name: m.name || m.model,
        ...(typeof m.size === 'number' ? { sizeBytes: m.size } : {}),
        ...(m.details?.family || m.details?.quantization_level
          ? { detail: [m.details.family, m.details.quantization_level].filter(Boolean).join(' · ') }
          : {})
      }))
    };
  } catch {
    return null;
  }
}

/** LM Studio's OpenAI-shaped answer: `{ data: [{ id }] }` — no sizes. */
async function fetchOpenAiShaped(baseUrl: string, providerId: string, fetchImpl: FetchLike): Promise<LocalModelAnswer | null> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/models`, {
      signal: AbortSignal.timeout(LOCAL_MODELS_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id?: string }> } | null;
    const list = Array.isArray(data?.data) ? data.data : [];
    return {
      providerId,
      models: list.map((m) => ({ id: m.id, name: m.id }))
    };
  } catch {
    return null;
  }
}

/**
 * One snapshot across every local provider the user has. The renderer triggers
 * this through the card's refresh button; nothing polls, a server that is off
 * just shows as not answering.
 */
export async function collectLocalModelsInventory(
  providers: ProviderConfig[],
  fetchImpl: FetchLike = fetch
): Promise<LocalModelsInventory> {
  const locals = providers.filter((provider) => provider.enabled && isLocalRuntime(provider));
  const answers = await Promise.all(
    locals.map((provider) =>
      provider.type === 'ollama' ? fetchOllama(provider.baseUrl || 'http://127.0.0.1:11434/v1', provider.id, fetchImpl) : fetchOpenAiShaped(provider.baseUrl || 'http://127.0.0.1:1234/v1', provider.id, fetchImpl)
    )
  );
  const kept = answers.filter((a): a is LocalModelAnswer => a !== null);
  return { answers: kept, fetchedAt: Date.now() };
}
