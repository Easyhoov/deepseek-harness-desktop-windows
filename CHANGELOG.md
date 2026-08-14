# Changelog

All notable changes to DeepSeek Harness Desktop are documented here.
Versioning follows the `package.json` version; GitHub Actions builds and
publishes a Release (NSIS + portable + `latest.yml`) on every `v*` tag.

## [0.3.0] — 2026-08-14

### Added

- **Plugin marketplace** (`plugins/desktop-marketplace`): search the GitHub `dsh-plugin` topic and the npm registry from the sidebar; install with the bundled `npm` (no Node.js required on the target machine) and mount at runtime via `ctx.loader.create` — no restart for the host half, one UI reload for new client bundles.
- **Dual-channel updates**: besides the existing shell auto-update, the ⋯ menu can now install a newer official `@deepseek-ai/dsh` into `<userData>/agent` (staging → atomic swap) and boot the whole composition from it — healed fallback junctions are re-pointed in-process; one-click rollback to the bundled copy.
- Self-contained npm runner (`src/npm-runner.mjs`): bundled `npm@10` executed under Electron's own Node (`ELECTRON_RUN_AS_NODE=1` on the child env only).

### Fixed

- npm@12 is unsupported on Electron's Node 22.21 → pinned `npm@10`.
- `npm/bin/npm-cli.js` is hidden by npm's exports map → resolve via `npm/package.json`.

## [0.2.1] — 2026-08-14

### Added

- **File changes + one-click restore** (`plugins/desktop-file-changes`): a session-header "文件" button lists every write/edit the agent made (live event stream, +/− line stats via LCS) and restores them per-op or all at once. Reverts run behind a hard fence: absolute paths under session-cwd/workspace roots only, dangerous extensions refused, snippet swaps verify current content; writes restore a previously viewed content or delete only byte-identical files.
- `desktopUi.on` — sender-verified renderer RPC channels for desktop plugins.

### Fixed

- `ctx.slots.register` call shape (the component must be the second argument of `register`, not a third argument of `inject`) — previously caused React error #130 on `shell.overlay` entries.

## [0.2.0] — 2026-08-14

### Added

- **Frameless glass chrome**: custom 36px title bar (drag region, whale icon, version badge, ⋯ menu with app/dsh update + rollback + about + quit, min/max/close), Win11 rounded corners, startup splash. Themed by the DSH UI's CSS variables.
- **Balance widget** (`plugins/desktop-balance`): `余额 ¥X · 本轮 ¥Y` in the composer dock; balance polled from `/user/balance`, per-turn cost folded from live provider usage; click → top-up page.
- Desktop plugin infrastructure: `plugins/*` packages copied into the profile's node_modules and mounted through the desktop overlay; `desktopUi` service (send + on) injected into the host tree.
- GitHub Actions release automation: `v*` tag → build on `windows-latest` → Release with installers, blockmap and `latest.yml`; `publish.url` points at `/releases/latest/download` so installed builds self-update without a separate server. Space-free artifact names for updater-safe URLs.

### Changed

- App/tray/installer icon switched to the official black whale (DeepSeek Harness favicon) via `scripts/rasterize.mjs`.

## [0.1.0] — 2026-08-13

Initial release.

- In-process host composition (no child process, no port, no HTTP server) with the IPC transport (`dsh:fetch`/`dsh:ws-*`) replacing fetch/WebSocket in the renderer.
- `app://localhost` privileged scheme; dist materialized beside user data with the official boot-manifest pipeline.
- Tray residency, host-event native notifications, first-run home wizard with `dsh web` conflict guard, renderer crash recovery, chunked IPC responses, session export with taskbar progress, `electron-updater` wiring.
- Session log repair tool (`scripts/repair-log.mjs`) for the upstream interruption-flush seq-reorder bug.
