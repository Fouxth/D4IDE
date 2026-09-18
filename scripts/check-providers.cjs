/**
 * Probes every shipped provider preset (spec §26).
 *
 *   pnpm providers:check
 *
 * What this can and cannot prove, stated plainly:
 *
 * - It proves the endpoint the app will call actually exists: DNS resolves, TLS
 *   terminates, and the path answers with something other than 404. That is the
 *   failure mode a wrong base URL produces, and it is invisible until a user
 *   pastes a real key and gets a confusing error.
 * - It cannot prove a key works or that a model id is served at that moment —
 *   that needs credentials, which this script deliberately does not have.
 *
 * A 401/403 is therefore a *pass*: the endpoint is there and wants a key. A 404
 * is a failure: the base URL is wrong. Unauthenticated 200s are reported too,
 * because a few gateways (OpenCode's own) publish their catalogue openly.
 */
const PROVIDERS_FILE = 'src/shared/provider-presets.generated.ts';

const TIMEOUT_MS = 15000;

const loadPresets = () => {
  // The generated file is valid JSON inside a small TS wrapper; read it rather
  // than importing, so this script never needs a TS toolchain.
  const fs = require('fs');
  const source = fs.readFileSync(PROVIDERS_FILE, 'utf8');
  const start = source.indexOf('= [');
  const end = source.lastIndexOf('];');
  const json = source.slice(source.indexOf('[', start), end + 1);
  return JSON.parse(json);
};

/**
 * Where a provider lists models. Almost everyone uses `/models`; Gemini takes a
 * page-size query and Perplexity publishes its list under `/v1` (the preset
 * carries the exception explicitly, so the app and this check agree).
 */
const modelPathFor = (preset) =>
  preset.modelsPath || (preset.type === 'gemini' ? '/models?pageSize=1' : '/models');

const probe = async (preset) => {
  const url = `${preset.baseUrl}${modelPathFor(preset)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'D4IDE/1.0 (+provider-check)' },
      signal: controller.signal
    });
    const body = await response.text().catch(() => '');
    const status = response.status;

    // A 404 means the path or the host is wrong; anything else means the
    // endpoint exists and is deciding about credentials.
    const reachable = status !== 404 && status < 500;
    return {
      url,
      status,
      reachable,
      note: status === 200 ? 'public catalogue' : status === 404 ? 'path not found' : 'needs the API key',
      sample: body.slice(0, 80).replace(/\s+/g, ' ')
    };
  } catch (error) {
    const message = error?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : error?.message || String(error);
    // Local runtimes are allowed to be absent — the app runs without them.
    return { url, status: 0, reachable: !!preset.isLocal, note: preset.isLocal ? 'not running (optional)' : message, sample: '' };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Where a provider publishes its catalogue openly, the preset's model ids can be
 * checked against it — which is how a model the vendor retired stops being
 * offered by D4IDE.
 */
const verifyModelIds = async (preset) => {
  const url = `${preset.baseUrl}${modelPathFor(preset)}`;
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'D4IDE/1.0 (+provider-check)' } });
    if (response.status !== 200) return null;
    const body = await response.json().catch(() => null);
    const live = new Set(
      (body?.data || body?.models || [])
        .map((entry) => (typeof entry === 'string' ? entry : entry?.id || entry?.name))
        .filter(Boolean)
    );
    if (live.size === 0) return null;

    const missing = preset.models.map((m) => m.id).filter((id) => !live.has(id));
    // A gateway that namespaces its ids (kilo/requesty style) lists nothing our
    // preset can match on, so a total mismatch means "not comparable", not
    // "all retired" — reporting it as drift would train the reader to ignore it.
    const incomparable = missing.length === preset.models.length && live.size > preset.models.length;
    return { missing, live: live.size, incomparable };
  } catch {
    return null;
  }
};

const main = async () => {
  const presets = loadPresets();
  const results = [];
  const drift = [];

  for (const preset of presets) {
    const result = await probe(preset);
    results.push({ id: preset.id, type: preset.type, baseUrl: preset.baseUrl, ...result });
    const mark = result.reachable ? 'OK  ' : 'FAIL';
    console.log(`${mark} ${preset.id.padEnd(24)} ${String(result.status).padStart(3)}  ${result.note}`);
    if (!result.reachable) console.log(`     ${result.url}\n     ${result.sample}`);

    if (result.status === 200) {
      const models = await verifyModelIds(preset);
      if (models?.missing.length && models.incomparable) {
        console.log(`     ids not comparable with this gateway (it publishes ${models.live} namespaced ids)`);
      } else if (models?.missing.length) {
        drift.push({ id: preset.id, missing: models.missing, live: models.live });
        console.log(`     model drift: ${models.missing.join(', ')} (upstream lists ${models.live})`);
      }
    }
  }

  if (drift.length) {
    console.log(`\nMODEL_DRIFT ${drift.length} provider(s) list a model the vendor no longer serves:`);
    for (const entry of drift) console.log(`  ${entry.id}: ${entry.missing.join(', ')}`);
    console.log('Run `pnpm providers:sync` to refresh, or exclude the id in scripts/sync-providers.cjs.');
  }

  const failed = results.filter((r) => !r.reachable);
  const remote = results.filter((r) => !presets.find((p) => p.id === r.id)?.isLocal);
  console.log(
    `\nPROVIDER_CHECK ${remote.length - failed.filter((f) => !presets.find((p) => p.id === f.id)?.isLocal).length}/${remote.length} remote endpoints reachable` +
      (failed.length ? ` · ${failed.length} failing: ${failed.map((f) => f.id).join(', ')}` : ' · no failures')
  );
  process.exit(failed.length > 0 && process.argv.includes('--strict') ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
