# DeepSeek Harness Desktop (Windows)

[![GitHub stars](https://img.shields.io/github/stars/Easyhoov/deepseek-harness-desktop-windows?style=flat&label=★&color=08C)](https://github.com/Easyhoov/deepseek-harness-desktop-windows)
[![GitHub release](https://img.shields.io/github/v/release/Easyhoov/deepseek-harness-desktop-windows?label=release)](https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-47848F?style=flat)](https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases)
[![Topics](https://img.shields.io/badge/topics-deepseek--harness%20%7C%20dsh--plugin-4D6BFE)](https://github.com/topics/dsh-plugin)

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) for the Windows desktop: **no Node.js install, no commands** — double-click to run, with the official DSH web UI and plugin ecosystem fully preserved.
>
> ⚠️ **Unofficial.** This project is **not affiliated with, endorsed by, or published by DeepSeek**. It packages the open-source `@deepseek-ai/dsh` distribution as-is. The whale mark is the official DeepSeek Harness favicon used for visual consistency only, and remains a DeepSeek trademark.

[中文](README_zh.md) · English

---

## Why another desktop wrapper?

Most community wrappers **spawn the `dsh web` CLI** and point a browser window at `127.0.0.1:3080`. This one is different: the whole shipped composition runs **inside the Electron main process** (in-process integration), the frontend loads locally, and every `/api` request plus event downlink crosses an **IPC bridge** — **zero ports, zero child processes, no local HTTP server**. Sessions, goals, background jobs, and plugins are first-class local state: closing the window (to the tray) keeps them running.

![DeepSeek Harness Desktop](docs/screenshots/image.png)

## Features

| | |
|---|---|
| 🧬 **In-process host** | Boots the official `web` profile with `dsh-app-boot` inside Electron's main process; no child process, no port, no HTTP server |
| 🔌 **IPC transport** | `fetch` / `WebSocket` shims in preload carry all RPC over Electron IPC; official client plugins run **unmodified** |
| 🪟 **Frameless glass chrome** | Custom 36px glass title bar (whale icon, version badge, ⋯ menu, min/max/close), Win11 rounded corners, startup splash — themed by the DSH UI's own CSS variables |
| 🛍️ **Plugin store** | The community store (ZASENJC) is built in: `/store` or Settings → Plugins → Plugin Store to browse, search, install and uninstall with one click; installs run the official `dsh plugin add` (npm / GitHub / monorepo subdirectories / tarballs) with the bundled pnpm — no console window, live progress, restart to apply |
| 💰 **Session balance** | Live balance and per-turn cost under the composer, click to top up |
| 📝 **File changes + one-click restore** | The "文件" button in the session header lists every write/edit the agent made (with +/− line stats) and restores them one-by-one or all at once — guarded by a hard fence (session-cwd/workspace roots only, dangerous extensions refused, snippet verification) |
| 🗂️ **Sidebar workbench** | Built-in better-sidebar: file explorer / editor & preview / real terminal / Git panel / sandboxed browser / subagent topology, isolated per session; **title-bar compat mode is on by default** — the sidebar buttons and tab bar are pushed down clear of the top chrome (strip height tunable in Settings → Side card) |
| ⬆️ **Dual-channel updates** | Channel 1: `electron-updater` self-updates from GitHub Releases (live download progress + visible installer); Channel 2: ⋯ menu "更新 dsh" installs a newer official `@deepseek-ai/dsh` and boots from it, with one-click rollback to the bundled copy |
| 🪟 **Tray residency** | Closing the window keeps sessions running; tray menu shows/hides, checks updates, quits |
| 🔔 **Native notifications** | Driven by the host's own event streams: approvals, questions, agent errors, dynamic-plugin run requests; reply-completion only while the window is in the background |
| 🏠 **First-run home wizard** | Pick a private data directory or reuse `~/.dsh`; a live `dsh web` instance on the shared home triggers a conflict warning |
| 🛡️ **Crash recovery** | Renderer crash rebuilds the window and reloads the site; the host state survives (3 strikes per minute → give up) |
| 📦 **Session export** | In-process with taskbar progress, native save dialog, completion notification |
| 🐋 **Official whale icon** | The DeepSeek Harness favicon (black whale) rasterized to PNG, shipped with the app |
| 🧰 **Log repair tool** | `scripts/repair-log.mjs` fixes the upstream interruption-flush seq-reorder corruption |

## Plugin ecosystem

DeepSeek Harness is built on [Cordis](https://github.com/cordiverse/cordis) with an **"everything is a plugin"** architecture: model adapters, tools, sessions, and the agent loop all run as plugins; external plugins plug in through **profiles and bundles**.

This app's own desktop features are standard DSH plugins (bundles + declarative patches), composed with the profile and recognized by `dsh web` too. CLI installs (shared profile):

```sh
dsh plugin --profile web add <package>
dsh plugin --profile web add github:<repo>
```

## Download

| Artifact | Notes |
|---|---|
| `DeepSeek-Harness-Desktop-Setup-<version>.exe` | NSIS installer (choose install dir); used by the auto-updater |
| `DeepSeek-Harness-Desktop-Portable-<version>.exe` | Portable |
| `latest.yml` | Auto-update metadata, published beside the installers on every Release |

Get the latest builds from [GitHub Releases](https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases) (Windows 10/11, x64; built by GitHub Actions on every `v*` tag). **Not code-signed** — SmartScreen will ask; signing is wired via `CSC_LINK` / `CSC_KEY_PASSWORD`.

## Quick start

1. Launch the app; on first run pick a data directory (private by default, or share `~/.dsh`)
2. Open **Settings → Models** and enter a DeepSeek API key (or a custom OpenAI-compatible endpoint); applies live, no restart
3. Pick a workspace directory (native OS dialog) and start a session

This mirrors the official [Quickstart](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart) — the desktop app boots the same `web` profile composition the CLI does, so models, workspaces, approvals, and plugin development behave identically.

**One deliberate deviation:** the CLI uses the invoking directory as the default workspace; the desktop app boots from the user home (override with `DSH_DESKTOP_CWD`), with workspace selection in the UI.

## Build from source

Requires Node.js ≥ 20:

```sh
npm ci
npm start       # run in development
npm run dist    # build installers (output in release/)
```

## More

- [Changelog](CHANGELOG.md) · [中文](README_zh.md)
- Feedback: file an [Issue](https://github.com/Easyhoov/deepseek-harness-desktop-windows/issues)
