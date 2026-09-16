# Windows Build & Packaging Instructions

Follow these steps to compile and package D4IDE into a standalone Windows installer (`D4IDE-Setup.exe`).

## Prerequisites

- **OS**: Windows 10 or Windows 11 (64-bit)
- **Node.js**: v20.x or higher
- **Package Manager**: pnpm (recommended) or npm

## Build Commands

```bash
# 1. Install dependencies
pnpm install

# 2. Type-check and compile frontend and Electron bundles
pnpm build

# 3. Package Windows NSIS installer
pnpm dist
```

## Output Artifacts

The final setup executable is generated at:
```text
release/
  └── D4IDE-Setup.exe
```

The installer:
- Allows selecting the installation directory.
- Creates Desktop and Start Menu shortcuts.
- Configures default uninstallation entries cleanly in Windows Settings / Add or Remove Programs.
