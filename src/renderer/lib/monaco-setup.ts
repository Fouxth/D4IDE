/**
 * Point the editor at the copy of Monaco that ships inside the app.
 *
 * `@monaco-editor/react` does not bundle Monaco: by default its loader injects
 * `<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs/loader.js">`
 * and waits for it. This window is a packaged desktop app whose CSP is
 * `script-src 'self' 'unsafe-inline' 'unsafe-eval'`, so that script is blocked
 * before a single byte is fetched — the loader's promise never settles and every
 * file opened in the code view sat on "Loading…" for ever. The file was fine,
 * the bridge was fine; the editor was waiting on a CDN the app is not allowed to
 * reach, and cannot reach offline in any case.
 *
 * So the local `monaco-editor` dependency — which was in `package.json` but never
 * imported anywhere — is loaded directly and handed to the loader through
 * `loader.config({ monaco })`, which makes the loader resolve immediately without
 * injecting any script at all. Both the editor and its workers come from the app
 * bundle, so this works offline, under CSP, in `file://` and in dev alike.
 *
 * The import is dynamic on purpose: Monaco is a few megabytes and most sessions
 * never open the code view, so it is fetched the first time an editor mounts
 * rather than on every launch.
 */
import { loader } from '@monaco-editor/react';

/** In-flight or finished setup, shared by every editor instance. */
let setup: Promise<void> | null = null;

type WorkerFactory = new () => Worker;

/**
 * Monaco asks for a worker per language family; without one it falls back to
 * running on the main thread (slow, and TypeScript diagnostics stop working).
 * These all came from the bundle, so no request leaves the machine.
 */
async function installWorkers(): Promise<void> {
  const [editorWorker, jsonWorker, cssWorker, htmlWorker, tsWorker] = await Promise.all([
    import('monaco-editor/esm/vs/editor/editor.worker?worker'),
    import('monaco-editor/esm/vs/language/json/json.worker?worker'),
    import('monaco-editor/esm/vs/language/css/css.worker?worker'),
    import('monaco-editor/esm/vs/language/html/html.worker?worker'),
    import('monaco-editor/esm/vs/language/typescript/ts.worker?worker')
  ]);

  const of = (module: { default: WorkerFactory }): WorkerFactory => module.default;

  self.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
      switch (label) {
        case 'json':
          return new (of(jsonWorker))();
        case 'css':
        case 'scss':
        case 'less':
          return new (of(cssWorker))();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new (of(htmlWorker))();
        case 'typescript':
        case 'javascript':
          return new (of(tsWorker))();
        default:
          return new (of(editorWorker))();
      }
    }
  };
}

/**
 * Loads Monaco once and configures the loader. Safe to call from every mount:
 * concurrent callers share one promise, and a failure clears it so a later
 * attempt (after a reload) can try again instead of being poisoned for ever.
 */
export function setupLocalMonaco(): Promise<void> {
  if (setup) return setup;
  setup = (async () => {
    const [monaco] = await Promise.all([import('monaco-editor'), installWorkers()]);
    loader.config({ monaco });
  })().catch((error) => {
    setup = null;
    throw error;
  });
  return setup;
}
