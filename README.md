# Life Atlas

English | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md)

Life Atlas is a local-first Windows desktop personal workspace. Organize notes and multi-view databases locally with SQLite, protect accounts and attachments inside an encrypted Key Vault, extract English/Japanese/Chinese text offline with OCR, and connect the built-in AI assistant to any OpenAI-compatible model endpoint you choose.

## Highlights in `1.7.0`

- **5-Locale Internationalization (`EN-US` / `EN-SG` / `JA-JP` / `ZH-CN` / `ZH-SG`)** — Complete UI localization across all four Electron windows (Workspace, Key Vault, First-Run Setup, Markdown Preview), native menus/dialogs, locale-aware number/date/weekday formatting, CJK/Latin font stacks, and a multilingual Windows NSIS installer.
- **Local-First Pages & 11 Database Views** — Block-based Notion-style editor with multi-column layout, formula ternary conditions, relational rollups, recurring tasks, database action buttons, currency conversions, offline Leaflet/tile maps, and virtualized 10k-row tables.
- **Encrypted Key Vault (`Argon2id` + `AES-256-GCM`)** — Context-isolated vault window with full-width workspace layout, encrypted rich-text notes with `/` slash blocks, encrypted file attachments, TOTP secrets, and `.lifeatlas` backup key continuity.
- **Official Marketplace & Sandbox** — Browse, inspect, download, and manage signed `.atlaspack` widgets and templates offline (Focus Study Page, Pomodoro, Interactive Footprint Map covering 47 Japanese prefectures / 477 Chinese divisions / 176 countries & regions, Habit Heatmap, Travel Timeline & Boarding Pass, Smart Packing List, World Clock, Life Countdown, Ambient Focus Mixer, Flashcards, Freehand Whiteboard, Carbon Code Card, Decision Review, and Personal Ledger).
- **Encrypted Cloud-Folder Backups** — Write deterministic or whole-package encrypted `.lifeatlas` backups to any local folder synced by OneDrive or Google Drive.

[Windows Releases](https://github.com/jamesmendax/life-atlas-public/releases/latest) · [Online Marketplace](https://jamesmendax.github.io/life-atlas-public/market/)

## Download & Upgrade (Windows x64)

Download the installer from the [latest release page](https://github.com/jamesmendax/life-atlas-public/releases/latest), alongside `SHA256SUMS.txt`, the `.blockmap` differential update metadata, and `THIRD_PARTY_NOTICES.md`.

### Upgrading from an earlier version

1. Close the running Life Atlas process and run the new installer. Under the same Windows user account, Life Atlas reuses your existing data root automatically.
2. Before upgrading, export and verify a full `.lifeatlas` archive via **Backup & Restore → Full Backup** (check **Include Key Vault** if needed). Keep the matching master password or recovery key (plus the archive password if whole-package encryption is enabled).
3. If the first-run wizard appears, select your existing data root and choose **Open this workspace**.

## Official Marketplace

Open **Templates → Official Marketplace** in the desktop sidebar (or visit the [Online Marketplace](https://jamesmendax.github.io/life-atlas-public/market/)) to inspect previews, versions, and package sizes before downloading individual signed `.atlaspack` packages. Previously downloaded packages remain usable completely offline, and locally signed `.atlaspack` archives can also be imported directly.

- [Browse Online Marketplace](https://jamesmendax.github.io/life-atlas-public/market/) · [Submit a Package](https://github.com/jamesmendax/life-atlas-public/issues/new?template=market-submission.yml) · [Send Feedback](https://github.com/jamesmendax/life-atlas-public/issues/new?template=feedback.yml) · [Submission & Review Guide](./market/CONTRIBUTING.md)

## Data Compatibility

Every release runs automated compatibility verification (`npm run test:compatibility`) across frozen SQLite workspace fixtures, Key Vault master passwords/recovery keys, and plain or encrypted `.lifeatlas` backups on both Windows and Linux. If an archive or workspace is corrupted or unrecognized, existing files on disk are preserved untouched. See [`tests/fixtures/compatibility/README.md`](./tests/fixtures/compatibility/README.md) and [`docs/云盘备份.md`](./docs/云盘备份.md).

## Local Development

Requires **Node.js 24** and `npm` on Windows:

```powershell
npm ci
node node_modules/electron/install.js
npm run test:compatibility
npm run desktop:dev
```

### Building the Windows Installer

Initialize the offline Electron, NSIS, and 7-Zip caches inside `.harness/runtime` before packaging:

```powershell
$runtime = Join-Path (Get-Location).Path '.harness/runtime'
$env:electron_config_cache = Join-Path $runtime 'electron-cache'
node -e 'const {version}=require("electron/package.json"); require("@electron/get").downloadArtifact({version, artifactName:"electron", platform:"win32", arch:"x64", cacheRoot:process.env.electron_config_cache, checksums:require("electron/checksums.json")}).catch(error => { console.error(error); process.exitCode = 1; });'
$env:ELECTRON_BUILDER_CACHE = Join-Path $runtime 'builder-cache'
node -e 'const tools = require("app-builder-lib/out/toolsets/windows.js"); const {getPath7za}=require("app-builder-lib/out/toolsets/7zip.js"); Promise.all([tools.getMakeNsisPath(), tools.getNsisPluginsPath(), getPath7za()]).catch(error => { console.error(error); process.exitCode = 1; });'
npm run desktop:build
```

Signed artifacts are emitted under `release/release/`. Set `LIFE_ATLAS_BUILD_RUNTIME` to point to an alternate cache directory, `LIFE_ATLAS_GUARD_PYTHON` for a custom Windows guard Python executable, or `LIFE_ATLAS_RELEASE_PYTHON` for release installer verification.

## Third-Party Notices

Third-party packages and bundled data files follow their respective licenses; see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
