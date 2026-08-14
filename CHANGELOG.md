# Changelog

All notable changes to DeepSeek Harness Desktop are documented here.
Versioning follows the `package.json` version; GitHub Actions builds and
publishes a Release (NSIS + portable + `latest.yml`) on every `v*` tag.

## [0.4.5] — 2026-08-14

### Changed

- **"检查更新" now always answers visibly**: the menu entry previously ran the check silently — when it found a new version there was nothing on screen until the download finished, so it felt dead. It now shows a dialog for every outcome (check failed with the reason / already up to date / new version found and downloading in the background).
- **Automatic update check on startup**: the app checks once, 25 seconds after boot, so users get the "更新已就绪" notification without opening the menu. Concurrent checks are deduplicated.

## [0.4.4] — 2026-08-14

### Added

- **In-app repository details**: every GitHub entry in the marketplace now has a "详情" action that opens a detail view inside the panel — full description, npm publish status (package name / version count / latest / last update, or the precise reason it cannot be installed), a cleaned plain-text README, one-click install, and open-repo links. No need to leave the app to judge a plugin.

### Fixed

- **Unstable `raw.githubusercontent.com` fallback**: repo file fetches (package.json + README) now retry via the GitHub contents API when raw is unreachable — the common CN-network case that previously surfaced as "解析失败（网络不可达）" for everything.

## [0.4.3] — 2026-08-14

### Fixed

- **Marketplace repo links now open in the browser**: the desktop shell denies new-window requests (`setWindowOpenHandler` deny), so the repo-name links and "打开仓库页" buttons were silently dead. They now route through the `openExternal` bridge (same path as the chrome-bar links) and open the GitHub page in the default browser.

## [0.4.2] — 2026-08-14

### Changed

- **Marketplace install guards against unpublished/placeholder packages**: after resolving a GitHub repo's npm package name, the host now verifies the name against the npm registry and refuses install when there is nothing real to install. Resolve failures are distinguished (invalid / network / not-npm / private / unpublished) and the UI shows the matching reason instead of a blanket "not an npm package".
- **Application entries open the repo page instead of installing**: repos classified as `application` (or tagged `desktop-app`) render a "打开仓库页" action rather than a doomed one-click npm install.

## [0.4.1] — 2026-08-14

### Changed

- **Marketplace now lives inside the built-in 设置 panel**: it registers as a real `settings.section` page, so it shares the exact settings chrome (left nav rail, content column, close/Escape/mask). The sidebar entry is styled like the 设置 trigger row. The old overlay remains only as an automatic fallback when the settings shell route is unavailable.
- **File-changes button moved next to the view tabs**: it now sits in the 对话/轨迹 tab row instead of the far-right header corner.

### Fixed

- **White "paper" desktop/taskbar icons**: the 296-character app description overflowed NSIS's shortcut writer and corrupted the `.lnk` icon-location string, so Windows fell back to the generic white icon. The description is shortened, and a custom NSIS `customInstall` step rewrites both shortcuts with valid icon data on every install and update (heals already-affected installs on upgrade).

## [0.4.0] — 2026-08-14

### Added

- **Catalog-first plugin marketplace**: a GitHub Action collects the `dsh-plugin` / `deepseek-harness` / `dsh` topic repos, classifies them into 插件/技能/应用/基础设施/渠道/合集/目录 and scores them (stars × recency); the app fetches `catalog/catalog.json` from the repo with a 24h disk cache — instant search, no GitHub rate limits, offline-capable. The panel gains category chips with counts, 推荐/stars/updated sorting, type badges, topics and update times on cards.
- GitHub-repo install now resolves the npm package name from the repo's `package.json` before installing.

### Fixed

- **RPC channel prefix mismatch**: plugin handlers registered as `ui.on('marketplace-search')` while the renderer called `dsh:marketplace-search` — search/install/restore RPCs never reached the host (marketplace and file-changes alike). Channels are now consistently `dsh:`-prefixed.

## [0.3.2] — 2026-08-14

### Fixed

- **Marketplace and file-changes panels were click-through**: the `shell.overlay` layer is pointer-transparent by design and entries must opt back in with `pointer-events: auto`; without it the panels rendered but every control inside them was dead ("no reaction" to clicks).
- Marketplace now has a second entry point (⋯ menu → 插件市场, dispatched as a window event) and surfaces search failures (e.g. GitHub rate limits) instead of silently showing an empty list.

## [0.3.1] — 2026-08-14

### Fixed

- **Installed builds crashed at startup** (`ERR_MODULE_NOT_FOUND: @deepseek-ai/cordis-plugin-group` from `dsh-app-boot`): electron-builder's node-modules collector pruned the 19 packages npm auto-installed to satisfy peerDependencies. They are now pinned as explicit root dependencies; the packaged tree matches dev 195/195.

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
