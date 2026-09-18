/**
 * Rebuilds the ABI-sensitive native modules against the Electron version that
 * this project actually ships (the one in devDependencies).
 *
 *   node scripts/rebuild-native.cjs
 *
 * Why not `electron-builder install-app-deps`? It rebuilds *every* native
 * dependency through the node-gyp bundled in @electron/rebuild, and that
 * node-gyp (9.x) only recognises Visual Studio up to 2022. On machines with a
 * newer toolchain — or none at all — the whole rebuild aborts, even for
 * packages that never needed compiling. This script only touches the packages
 * that genuinely need an Electron-specific binary and pulls prebuilt binaries
 * instead of compiling, so it works without Visual Studio.
 *
 * A module needs an Electron-specific build only when it uses the raw V8 ABI.
 * Modules built with Node-API (node-pty ≥ 1.0) ship one binary that every
 * supported runtime can load, so they are skipped on purpose.
 *
 * Run with `--tolerant` (as the postinstall hook does) to warn instead of
 * failing: these modules are optional and the app falls back gracefully, so a
 * package install should not be blocked by an unreachable prebuild.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const MODULES = [
  {
    name: 'better-sqlite3',
    // Raw V8 ABI: the Node build will not load inside Electron.
    needsElectronBuild: true
  },
  {
    name: 'node-pty',
    // Node-API prebuild (prebuilds/<platform>-<arch>/pty.node) — ABI-stable.
    needsElectronBuild: false
  }
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function log(message) {
  console.log(`[native] ${message}`);
}

function electronVersion() {
  const candidates = [
    path.join(root, 'node_modules', 'electron', 'package.json'),
    path.join(root, 'node_modules', '.pnpm')
  ];
  const pkg = candidates[0];
  if (!fs.existsSync(pkg)) {
    throw new Error('electron is not installed — run your package manager install first');
  }
  return readJson(pkg).version;
}

/** Locates the directory of an installed package (works with pnpm's symlinks). */
function packageDir(name) {
  let entry;
  try {
    entry = require.resolve(name, { paths: [root] });
  } catch {
    return null;
  }
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    const pkgFile = path.join(dir, 'package.json');
    if (fs.existsSync(pkgFile)) {
      const pkg = readJson(pkgFile);
      if (pkg.name === name) return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Finds prebuild-install next to the module. npm nests it in the module's own
 * node_modules, while pnpm keeps it as a sibling inside the virtual store, so
 * both layouts have to be probed.
 */
function prebuildInstallPath(dir) {
  const candidates = [
    path.join(dir, 'node_modules', 'prebuild-install', 'bin.js'),
    path.join(dir, '..', 'prebuild-install', 'bin.js')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    return require.resolve('prebuild-install/bin.js', { paths: [dir] });
  } catch {
    return null;
  }
}

function rebuildWithPrebuild(dir, name, target, arch) {
  const prebuildInstall = prebuildInstallPath(dir);
  if (!prebuildInstall) {
    log(`${name}: prebuild-install is unavailable, needs a local C++ toolchain to compile`);
    return false;
  }
  log(`${name}: fetching the Electron ${target} (${arch}) prebuild…`);
  const result = spawnSync(
    process.execPath,
    [
      prebuildInstall,
      '--runtime=electron',
      `--target=${target}`,
      `--arch=${arch}`,
      '--verbose',
      '--force'
    ],
    { cwd: dir, stdio: 'inherit' }
  );
  return result.status === 0;
}

function main() {
  const tolerant = process.argv.includes('--tolerant');
  const target = electronVersion();
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  log(`Electron ${target} (${arch}) — rebuilding native modules`);

  let failed = 0;
  for (const mod of MODULES) {
    const dir = packageDir(mod.name);
    if (!dir) {
      log(`${mod.name}: not installed — skipping (the app falls back to its non-native path)`);
      continue;
    }
    if (!mod.needsElectronBuild) {
      log(`${mod.name}: Node-API module, the shipped prebuild already works in Electron — skipping`);
      continue;
    }
    if (!rebuildWithPrebuild(dir, mod.name, target, arch)) {
      failed += 1;
      log(`${mod.name}: FAILED to obtain an Electron build`);
    } else {
      log(`${mod.name}: ready for Electron`);
    }
  }

  if (failed > 0) {
    const message = `[native] ${failed} module(s) could not be prepared for Electron.`;
    if (tolerant) {
      console.warn(`${message} D4IDE will fall back to its non-native path — run "pnpm native:check" for details.`);
      return;
    }
    console.error(message);
    process.exit(1);
  }
  log(`verify with: npm run native:check`);
}

try {
  main();
} catch (error) {
  console.error(`[native] ${error.message}`);
  process.exit(1);
}
