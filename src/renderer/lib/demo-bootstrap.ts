/**
 * A stand-in bridge, installed *before the first render*.
 *
 * Panels ask for their data in a mount effect, and child effects run before the
 * parent's — so a bridge installed from an effect would be one tick too late and
 * screens such as the skill list would come up empty. This module is imported by
 * the entry point (behind a dev-only guard) and, when the page is served with
 * `?demo=1`, puts a deferred proxy on `window.electronAPI` synchronously: every
 * call is queued until the real mock — a dynamic import, so nothing here is ever
 * downloaded in a real run — resolves.
 *
 * A packaged build is loaded from `file://` with no query string and without
 * `import.meta.env.DEV`, so nothing here can install itself in a shipped app.
 */
export function maybeInstallDemoBridge(): boolean {
  // `import.meta.env.DEV` is replaced with `false` when the renderer is built
  // for production, which makes the imports below statically dead code — the
  // mock is not merely unused in a shipped app, it is absent from the bundle.
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined' || (window as any).electronAPI) return false;
  if (!location.protocol.startsWith('http') || !/[?&]demo=1/.test(location.search)) return false;

  const ready = import.meta.env.DEV ? import('./demo-bridge') : (null as never);

  (window as any).electronAPI = new Proxy(
    {},
    {
      get: (_target, property: string) => {
        // Event subscriptions are registered synchronously and hand back their
        // own unsubscribe function — a promise would crash every cleanup.
        if (property.startsWith('on')) return () => () => {};
        return (...args: unknown[]) =>
          ready.then((module) => {
            const api: any = module.demoApi();
            return typeof api[property] === 'function' ? api[property](...args) : null;
          });
      }
    }
  );

  // Swap in the mock itself once it has loaded, so later calls run directly.
  void ready.then((module) => {
    (window as any).electronAPI = module.demoApi();
  });

  // The transcript is seeded before React renders, so the agent view is already
  // full on the first paint instead of filling in afterwards.
  void (import.meta.env.DEV ? import('./demo-session') : null)?.then(({ seedDemoTranscript }) =>
    seedDemoTranscript()
  );

  return true;
}
