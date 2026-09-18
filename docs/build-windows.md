# Windows Build & Packaging Instructions

Follow these steps to compile and package D4IDE into a standalone Windows installer (`D4IDE-Setup.exe`).

## Prerequisites

- **OS**: Windows 10 or Windows 11 (64-bit)
- **Node.js 24.x LTS** — this project is built and tested on 24.21.0. Node 20.x can still run and build the app, but it bundles Corepack 0.29.3, which is the version that needs the Corepack upgrade below.
- **pnpm 12.4.2** — pinned through the `packageManager` field in `package.json`, so Corepack provisions that exact version for this project automatically.
- **Corepack 0.31.0 or newer.** The version bundled with Node 20.18 (0.29.3) carries stale npm registry signing keys and makes every `pnpm` command fail with `Cannot find matching keyid`. Fix it once per machine:

  ```bash
  npm install -g corepack@latest
  ```

No C++ toolchain is required: `better-sqlite3` is fetched as a prebuilt binary and `node-pty` ships a Node-API prebuild, so Visual Studio is not needed to build, run or package the app.

## Build Commands

```bash
# 1. Install dependencies
pnpm install

# 2. Build the native modules for the Electron runtime (see below)
pnpm rebuild:native
pnpm native:check        # optional but recommended — loads them inside Electron

# 3. Type-check and compile frontend and Electron bundles
pnpm build

# 4. Package the Windows NSIS installer
pnpm dist

# 5. Verify the packaged app really ships those modules
pnpm native:check:packaged
```

`native:check:packaged` loads bare Electron against `release/win-unpacked/resources/app.asar` — JavaScript from inside the archive, native binaries redirected to `app.asar.unpacked`, exactly as the shipped app resolves them. It is the only check that would catch a dependency missing from `build.files` or a missing `asarUnpack` entry. It then goes one step further and launches Microsoft Edge headless **through the packaged copy of `playwright-core`**, sets a page and reads it back, because a browser library that loads but cannot start a browser would only fail in front of the user. A machine without Edge or Chrome fails that probe — the app itself still runs, only the `browser_*` tools are unavailable.

`pnpm dist` runs the native rebuild itself, so step 2 is only needed when you want to verify the modules before packaging (or when running `pnpm dev`, which also uses the Electron ABI).

## Native Modules

| Module | Unlocks | Without it |
|---|---|---|
| `better-sqlite3` | SQLite storage for usage, sessions, audit and checkpoints | the same data is stored as JSON |
| `node-pty` | Real PTYs: interactive programs, terminal resize, correct colours | terminals run over pipes |
| `chokidar` | Filesystem watcher for the editor and agent context | file changes are picked up on demand |

All three are `optionalDependencies`: a skipped native build never blocks an install, the app just uses the fallback column above.

`scripts/rebuild-native.cjs` targets only the modules that need an Electron-specific binary. `node-pty` is deliberately skipped because it is built with Node-API — one binary loads in every supported runtime — while `better-sqlite3` uses the raw V8 ABI and needs a binary per runtime, which `prebuild-install` downloads for the Electron version in `devDependencies`.

Two consequences worth knowing:

- Once `better-sqlite3` targets Electron it can no longer be loaded by plain Node, so `pnpm test` runs against the JSON storage fallback. The one-line warning it prints is expected.
- `build.npmRebuild` is set to `false`. electron-builder's own dependency rebuild drives the node-gyp it bundles, which only recognises Visual Studio up to 2022 and aborts packaging outright on newer toolchains (or on machines with no toolchain at all). Rebuilding is done by `pnpm rebuild:native` instead, which is why `dist` calls it first.

## Output Artifacts

```text
release/
  ├── D4IDE-Setup.exe            # NSIS installer
  ├── D4IDE-Setup.exe.blockmap   # delta-update metadata
  └── win-unpacked/              # portable build, runnable without installing
```

The installer:

- Allows selecting the installation directory.
- Creates Desktop and Start Menu shortcuts.
- Configures default uninstallation entries cleanly in Windows Settings / Add or Remove Programs.

### Before shipping

- The build is **unsigned** (`no signing info identified, signing is skipped`), so Windows SmartScreen warns about an unknown publisher until a code-signing certificate is configured. SmartScreen reputation also has to accumulate per certificate.
- No application icon is set yet; electron-builder falls back to the default Electron icon (`application icon is not set`). Add an `.ico` and point `build.win.icon` at it.
- Native modules land in `resources/app.asar.unpacked/node_modules/` as configured by `build.asarUnpack`; keep that list in sync if another native dependency is ever added.
