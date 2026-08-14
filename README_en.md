# DeepSeek Harness Desktop (Windows)

A desktop app that wraps [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) for Windows. **No Node.js install, no commands** — double-click to launch, with the official DSH web UI and plugin ecosystem fully preserved.

[![GitHub release](https://img.shields.io/github/v/release/Easyhoov/deepseek-harness-desktop-windows?label=release)](https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> ⚠️ **Unofficial.** This project is not affiliated with or endorsed by DeepSeek. It packages the open-source `@deepseek-ai/dsh` distribution as-is.

---

## Highlights

- **Zero-config launch** — ships its own DSH runtime; no Node.js or pnpm required
- **In-process integration** — the host boots inside the app: no listening port, no child process, no local HTTP server; closing the window (to the tray) keeps sessions alive
- **Full web UI** — the official DSH interface loads unchanged: sessions, tools, approvals, trajectory, task board, and more
- **Plugin ecosystem** — official `dsh plugin add` mechanism (npm packages / GitHub repos / monorepo subdirectories / local tarballs), with the community plugin store (ZASENJC) built in
- **One-click updates** — automatic checks, live download progress, visible installer, install on quit
- **Desktop conveniences** —
  - system tray + native notifications (replies, approvals, updates ready)
  - live session balance (¥ + per-turn cost)
  - file-change tracking with one-click restore
  - automatic crash recovery
- **Everything is a plugin** — the desktop features themselves are standard DSH plugins (bundles + declarative patches), composed with the profile and visible to `dsh web`

![DeepSeek Harness Desktop](docs/screenshots/app.png)

## Install

Download the latest installer from [GitHub Releases](https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases/latest) (Windows 10/11, x64) and run it.

## Quick start

1. Install and launch the app
2. On first run, pick a data directory: a private one (default) or the CLI's `~/.dsh`
3. Configure a model under **Settings → Models**
4. Start chatting; add capabilities from **Settings → Plugins → Plugin Store**

## Plugins

Open **Settings → Plugins → Plugin Store** in the app (or type `/store`) to browse community plugins and install with one click; restart the app afterwards.

The same mechanism works from the CLI (shared profile with `dsh web`):

```sh
dsh plugin --profile web add <package>
dsh plugin --profile web add github:<repo>
```

## Updates

The app checks for updates on startup and via **⋯ → Check for app updates**. Downloads show live progress and install on quit.

## Build from source

Requires Node.js ≥ 20:

```sh
npm ci
npm start       # run in development
npm run dist    # build installers (output in release/)
```

## Project layout

- `src/` — Electron main process: in-process host, IPC bridge, desktop patches, tray, updater
- `plugins/` — desktop plugins (balance, file changes)
- `scripts/` — build and tooling scripts
- `docs/` — documentation and DSH docs archive

## More

- [Changelog](CHANGELOG.md)
- [中文文档](README_zh.md)
