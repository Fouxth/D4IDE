/**
 * Does a green "Test" actually mean the key works?
 *
 * For most providers yes: `/models` is authenticated, so a 200 means the key was
 * accepted. But the OpenCode gateways publish their model list to anyone —
 * `GET https://opencode.ai/zen/v1/models` answers 200 with no key at all (checked
 * live) — and there a 200 proves only that the internet works. Reporting
 * "connected" for a typo'd key is worse than reporting nothing: the user finds
 * out in the middle of a task.
 *
 * So: find out whether the models list is public, and when it is, spend one
 * minimal generation request to actually authenticate. The answer is cached per
 * URL, because it never changes within a session and Test is a button people
 * press more than once.
 */

const PUBLIC_TTL_MS = 5 * 60_000;

const publicModelsCache = new Map<string, { isPublic: boolean; checkedAt: number }>();

const AUTH_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key', 'api-key'];

export function hasCredential(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((name) => AUTH_HEADERS.includes(name.toLowerCase()) && !!headers[name]);
}

/** Headers with every credential stripped — the anonymous view of an endpoint. */
export function withoutCredential(headers: Record<string, string>): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (AUTH_HEADERS.includes(name.toLowerCase())) continue;
    copy[name] = value;
  }
  // Some gateways answer differently without a user agent, and this probe must
  // look exactly like the real request minus the credential.
  if (!copy['user-agent'] && !copy['User-Agent']) copy['user-agent'] = 'D4IDE/1.0';
  return copy;
}

export function isModelsListPublic(modelsUrl: string): Promise<boolean> {
  const cached = publicModelsCache.get(modelsUrl);
  if (cached && Date.now() - cached.checkedAt < PUBLIC_TTL_MS) return Promise.resolve(cached.isPublic);

  return fetch(modelsUrl, { headers: { 'user-agent': 'D4IDE/1.0' } })
    .then(async (res) => {
      // A 200 with a model list, handed to a caller with no key.
      const isPublic = res.ok && res.status === 200;
      publicModelsCache.set(modelsUrl, { isPublic, checkedAt: Date.now() });
      return isPublic;
    })
    .catch(() => false);
}

export interface KeyVerification {
  modelsArePublic: boolean;
  keyProvided: boolean;
}

/**
 * Tells an adapter whether its `/models` result can be trusted as proof of the
 * key. When `modelsArePublic && keyProvided`, the caller must verify separately.
 */
export async function verifyKeyIfModelsArePublic(options: {
  modelsUrl: string;
  headers: Record<string, string>;
}): Promise<KeyVerification> {
  const keyProvided = hasCredential(options.headers);
  if (!keyProvided) return { modelsArePublic: false, keyProvided: false };
  return { modelsArePublic: await isModelsListPublic(options.modelsUrl), keyProvided };
}

/** Test helper: forget what was learned about public model lists. */
export function resetPublicModelsCache(): void {
  publicModelsCache.clear();
}
