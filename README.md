# DeepSeek Harness Desktop

[![GitHub release](https://img.shields.io/github/v/release/Easyhoov/deepseek-harness-desktop?label=release)](https://github.com/Easyhoov/deepseek-harness-desktop/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Topics](https://img.shields.io/badge/topics-deepseek--harness%20%7C%20dsh--plugin-4D6BFE)](https://github.com/topics/dsh-plugin)

> An unofficial desktop application for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): the host composition boots **in-process** inside Electron, the built Web frontend loads from the local filesystem, and every `/api` request plus event downlink crosses an Electron **IPC bridge** — no browser, no listening port, no local HTTP server.
>
> ⚠️ **Unofficial.** This project is **not affiliated with, endorsed by, or published by DeepSeek**. It packages the open-source `@deepseek-ai/dsh` distribution as-is. The whale mark is the official DeepSeek Harness favicon used for visual consistency only, and remains a DeepSeek trademark.
>
> ⚠️ **非官方声明：** 本项目与 DeepSeek **无任何隶属或背书关系**，仅对开源发行版 `@deepseek-ai/dsh` 做原样封装。鲸鱼标识取自官方 DeepSeek Harness favicon，仅用于视觉一致性，商标归 DeepSeek 所有。

---

## Why another desktop wrapper?

Most community wrappers spawn the `dsh web` CLI and point a browser window at `127.0.0.1:3080`. This one follows the integration seam the upstream design documents explicitly: *"Electron loads dist over `file://` and carries fetch over an IPC bridge"* (`dsh-host-webserver`). The whole shipped composition runs **inside the Electron main process**, so sessions, goals, background jobs, and plugins are first-class local state — closing the window (to the tray) keeps them running.

![DeepSeek Harness Desktop](<img width="1800" height="1150" alt="image" src="https://github.com/user-attachments/assets/42050622-7e3c-4b86-967e-043ca3b314ca" />)

## Features

| | |
|---|---|
| 🧬 **In-process host** | Boots the shipped `web` profile with `dsh-app-boot`; no child process, no port, no HTTP server |
| 🔌 **IPC transport** | `window.fetch` / `WebSocket` shims in preload carry all RPC over Electron IPC; the 37 shipped client plugins run **unmodified** |
| 🪟 **Frameless glass chrome** | Custom-drawn 36px glass title bar (drag region, whale icon, version badge, ⋯ menu, min/max/close), Win11 rounded corners, startup splash — themed by the DSH UI's own CSS variables |
| 💰 **Balance widget** | DeepSeek account balance in the composer dock (`余额 ¥X · 本轮 ¥Y`), per-turn cost folded from live provider usage; click → top-up page. A real dual-face dsh plugin (`plugins/desktop-balance`), mounted through the overlay like any shipped row |
| 📝 **File changes + one-click restore** | Session-header "文件" button lists every write/edit the agent made (from the live event stream, with +/− line stats) and restores them one-by-one or all at once — guarded by a hard fence (session-cwd/workspace roots only, dangerous extensions refused, snippet swaps verify current content). Dual-face plugin `plugins/desktop-file-changes` |
| 🛍️ **Plugin marketplace** | Sidebar "插件市场": search the GitHub `dsh-plugin` topic + npm registry, install with the **bundled npm** (no Node on the target machine), mount at runtime via `ctx.loader.create` — no restart for the host half, one UI reload for new client bundles. Dual-face plugin `plugins/desktop-marketplace` |
| ⬆️ **Dual-channel updates** | Channel 1: `electron-updater` self-updates the shell from GitHub Releases. Channel 2 (⋯ menu → 更新 dsh): installs a newer official `@deepseek-ai/dsh` into `<userData>/agent` and boots the whole composition from it (healed fallback re-pointed in-process) — one-click rollback to the bundled copy |
| 🪟 **Tray residency** | Close-to-tray keeps sessions running; tray menu shows/hides the window, checks updates, quits |
| 🔔 **Native notifications** | Driven by the host's own event streams: approvals, questions, agent errors, dynamic-plugin run requests — always; reply-completion — only while the window is in the background (subagent sessions excluded) |
| 🏠 **First-run home wizard** | Choose a private data directory or reuse `~/.dsh`; a live `dsh web` instance on the shared home triggers a conflict warning |
| 🛡️ **Crash recovery** | Renderer crash rebuilds the window and reloads the site; the host state survives (3 strikes per minute → give up) |
| 📡 **Chunked IPC responses** | Headers first, body as chunk frames with a ready handshake (no frame loss); unary responses stay on the fast inline path |
| 📦 **Session export** | Runs in-process with taskbar progress, native save dialog, and a completion notification |
| ⬆️ **Auto-update** | `electron-updater` against GitHub Releases (`publish.url` → `/releases/latest/download`): background check 15 s after boot + tray gesture; `latest.yml` ships with every Release so installed builds update themselves |
| 🐋 **Official whale icon** | The DeepSeek Harness favicon (black whale) rasterized to PNG via `scripts/rasterize.mjs` |
| 🧰 **Log repair tool** | `scripts/repair-log.mjs` fixes the upstream interruption-flush seq-reorder corruption (see below) |

## Download

| Artifact | Notes |
|---|---|
| `DeepSeek-Harness-Desktop-Setup-<version>.exe` | NSIS installer (choose install dir); used by the auto-updater |
| `DeepSeek-Harness-Desktop-Portable-<version>.exe` | Portable |
| `latest.yml` | Auto-update metadata, published beside the installers on every Release |

Get the latest builds from [Releases](https://github.com/Easyhoov/deepseek-harness-desktop/releases) — built by GitHub Actions on every `v*` tag push. **Not code-signed** — SmartScreen will ask; signing is wired via `CSC_LINK` / `CSC_KEY_PASSWORD`.

## Quick start

1. Launch the app. On first run, pick a data directory (private by default, or share the CLI's `~/.dsh`).
2. Open **Settings → Models**, enter your DeepSeek API key (or a custom OpenAI-compatible endpoint). Applies live, no restart.
3. Click **Select workspace** (native OS dialog) and start a session.

This mirrors the official [Quickstart](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart) flow; the desktop app boots the same `web` profile composition the CLI does, so model configuration, workspace handling, approval flows, and plugin development behave identically.

**One deliberate deviation:** the CLI uses the invoking directory as the default workspace; the desktop app boots from the user home (override with `DSH_DESKTOP_CWD`). Workspace selection happens in the UI.

## Environment

| Variable | Effect |
|---|---|
| `DSH_DESKTOP_HOME` | Harness home (highest precedence; falls back to an inherited `DSH_HOME`, then `<userData>/dsh-home`). Kept separate from `~/.dsh` by default so the two installs never fight over `profiles/node_modules` fallback links. |
| `DSH_DESKTOP_CWD` | Boot working directory (default: user home). |
| `DSH_DESKTOP_SCHEME=file` | Debug-only `file://` loading. The default `app://localhost` privileged scheme keeps `connection.isLoopback` true (host-scoped settings, open-file affordances); `file://` reports a null origin and degrades those. |

> **Sharing the CLI home** (`~/.dsh`): pick it in the wizard, or set `DSH_DESKTOP_HOME=<home>/.dsh`. Never run the desktop app and `dsh web` against the same home **at the same time** — concurrent writers corrupt session logs. The app detects a live web instance and warns before boot.

## Development

```sh
npm install
npm start          # dev run (unpackaged)
npm run dist:dir   # unpacked build into release/win-unpacked
npm run dist       # portable + NSIS installers (also writes latest.yml)
```

Node ≥ 22 and a Windows box for the packaged targets.

### Releasing

```sh
npm version patch    # or minor / major — bumps package.json, commits, tags
git push --follow-tags origin main
```

The `release` workflow (`.github/workflows/release.yml`) runs on every `v*` tag: it verifies the tag matches `package.json`'s version, builds on `windows-latest`, and attaches the NSIS installer, portable build, blockmap, and `latest.yml` to a GitHub Release. Installed copies then auto-update from `/releases/latest/download` — no separate update server. Unreleased local builds stay quiet (the updater is inert unless packaged).

### Packaging notes (real bugs fixed here)

- `npmRebuild: false` — Electron ABI rebuilds try to compile `node-pty` from source (VS Spectre libs); the web profile never uses terminal rows. koffi / sharp / `node-addon-require-builtin` ship N-API prebuilds and load fine.
- `asarUnpack: node_modules/**` — the healed `profiles/node_modules` junctions must point at real directories; ESM resolution cannot cross a junction into an asar archive. `boot.mjs` / `site.mjs` rewrite `app.asar\` paths to `app.asar.unpacked\`.
- Never set `ELECTRON_RUN_AS_NODE` globally — Chromium utility children inherit it and crash-loop. The native directory picker is replaced by Electron's `dialog.showOpenDialog` (the shipped koffi child-process backend cannot run under Electron), provided in the boot prepare hook because the API gateway injects `directoryPicker`.
- `net.fetch(file://)` inside a protocol handler crashes the network service; the `app://` handler reads files directly and returns `Response`s.

## Session log repair (upstream bug workaround)

Upstream `0.1.0-rc.6` can write `step/end` + `turn/end` out of order relative to a buffered chunk run when a turn is **interrupted**, double-claiming seqs. Strict readers then refuse the session with `corrupt session log: seq gap in committed region`. `scripts/repair-log.mjs` simulates the reader's committed-chain walk and renumbers the disordered tail (seq / seq0 / `sourceEventSeqs`; timestamps untouched).

```sh
# Run ONLY against a cold log (the owning host must have exited).
node scripts/repair-log.mjs "<home>/sessions/<workspace>/<session-id>/session.jsonl.zstd" --in-place
```

`scripts/inspect-log.mjs <file> [line]` audits seq continuity. The bug should also be reported upstream — this repo ships the workaround, not the fix.

## Architecture

```
Electron main process
  └─ dsh web profile composition (booted in-process via dsh-app-boot;
     install anchor = bundled copy or the <userData>/agent overlay)
       ├─ webserver row disabled → in-process webServer stub with identical
       │   route/fallback/index-tap semantics, zero sockets
       ├─ every shipped host row (connection, modules, api-gateway, …) mounts
       │   unchanged against the stub; their routes are captured and dispatched
       ├─ desktopUi service (send / on / npm / profileDir) for desktop plugins
       ├─ @dsh-desktop/{balance,file-changes,marketplace} mounted via overlay
       └─ apiProxy event streams (mux/host) pumped by the main process

Renderer (app://localhost serving a materialized dist copy)
  ├─ preload replaces window.fetch / window.WebSocket with IPC shims
  ├─ preload injects the 36px glass chrome bar + window.dshDesktop bridge
  └─ shipped client code (37 plugin bundles) runs unmodified, plus the
     desktop plugin client halves

IPC channels
  dsh:fetch / dsh:fetch-abort / dsh:fetch-stream-ready / dsh:fetch-chunk /
  dsh:fetch-end          upstream RPC (unary + chunked bodies)
  dsh:ws-open / dsh:ws-frame / dsh:ws-close     downstream event streams
  dsh:chrome-*           frameless window controls / menu
  dsh:balance, dsh:file-changes-*, dsh:marketplace-*   desktop plugin RPC
```

The transport seam is upstream's own design: `toFetchHandler(apiProxy)` wraps the API gateway into a transport-agnostic `Request → Response` function, and the trust fence treats the renderer as the loopback caller it logically is (`Host: 127.0.0.1` on every mock request, sender-verified IPC).

### Desktop plugins

The three bundled widgets (`desktop-balance`, `desktop-file-changes`, `desktop-marketplace`) are ordinary **dual-face dsh plugins** — the same shape as any shipped row. `boot.mjs` copies `plugins/*` into the profile's `node_modules` (keyed by each package's `name`) and mounts them through the desktop overlay; the client halves enter the boot graph through the standard `dsh.client` scan. The pattern:

1. `plugins/<name>/package.json` — `main: lib/index.js`, `exports["./client"]`, `dsh.client {platform: "web", inject: [...]}`, **and `"./package.json"` in `exports`** (the module scan resolves it; omitting it silently drops the plugin).
2. `lib/index.js` — host half (`export function apply(ctx)`): `const ui = ctx.get('desktopUi')` — `ui.send(channel, payload)` pushes to the renderer, `ui.on(channel, handler)` registers a sender-verified RPC, `ui.npm(args)` runs the bundled npm, `ui.profileDir` is the profile directory.
3. `lib/client.js` — `window.__ModuleLoader__.load({id, factory})` bundle; `exports.inject = ["slots"]` and `ctx.slots.register({...}, Component)` — the component is the **second argument of `register`** (inside the `inject` factory), and session-scoped slots receive `sessionId` through `inject: (sessionId) => ({sessionId})`.
4. One overlay row: `{ id: 'ui-desktop-<name>', name: '@dsh-desktop/<name>' }` in `boot.mjs`.

Live session events (`ctx.on('session/event')`), settings/credentials services, and the loader (`ctx.loader.create` for runtime mounts) are all reachable from the host half — that is the in-process advantage over shell wrappers.

### The dsh overlay channel

"⋯ → 更新 dsh" installs an official `@deepseek-ai/dsh` release into `<userData>/agent` (staging → atomic swap, bundled npm, no compilation) and relaunches. On boot, `boot.mjs` prefers that package.json as the **install anchor**: the healed `profiles/node_modules` fallback junctions and the bundle resolution both follow it, so the whole composition boots from the overlay in-process. Rollback removes the directory. Native deps (koffi/sharp/node-addon-require-builtin) are N-API prebuilds, so the overlay loads under Electron's Node without rebuilds.

## Known limitations / roadmap

- Response streaming is chunked but unbuffered for long-lived bodies only; unary responses buffer whole (fine for the current API).
- No code-signing certificate (SmartScreen warns; `CSC_LINK` / `CSC_KEY_PASSWORD` in CI enable signing).
- Windows-only packaging for now (main-process code is cross-platform; macOS/Linux configs are the next step).
- **Planned:** launch-directory workspace preselection (`dsh-desktop.exe <dir>` / context-menu open), dependency slimming (drop TUI/terminal packages → ~60 MB installers), multi-window sessions, CSP injection.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. The packaged `@deepseek-ai/dsh` distribution and the whale favicon are © DeepSeek and used under their own terms (dsh itself is MIT); the trademark remains DeepSeek's. See `LICENSE`.

---

# DeepSeek Harness Desktop（中文）

> DeepSeek Harness 的非官方桌面应用：host 组合在 Electron 主进程内**进程内启动**，构建好的 Web 前端从本地文件加载，所有 `/api` 请求与事件下行都走 Electron **IPC 桥**——无浏览器、无监听端口、无本地 HTTP 服务器。**本项目与 DeepSeek 无隶属/背书关系**，鲸鱼图标取自官方 favicon，商标归 DeepSeek。

## 与官方 Quickstart 的符合性

启动 → 设置模型（免重启热生效）→ 选择工作区 → 运行任务/审批流，与官方 [Quickstart](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart) 完全一致（同一份 `web` profile 组合）。唯一刻意差异：CLI 以启动目录为默认工作区，桌面版默认从用户主目录启动（可用 `DSH_DESKTOP_CWD` 覆盖），工作区在 UI 中选择。

## 功能速览

进程内 host（零端口）· IPC 传输（37 个出厂客户端插件零改动）· 无边框玻璃标题栏（自绘 36px 玻璃条 + Win11 圆角 + 启动页）· 托盘常驻（关窗继续跑）· 宿主事件流驱动的原生通知（审批/提问/错误/插件审批始终通知，回复完成仅窗口在后台时通知）· 首次启动 home 向导 + `dsh web` 冲突检测 · 渲染进程崩溃自动恢复 · 分块流式 IPC + 导出进度 · **余额小部件**（`余额 ¥X · 本轮 ¥Y`，点击充值）· **文件改动一键还原**（路径围栏 + 危险扩展黑名单）· **插件市场**（GitHub `dsh-plugin` 主题 + npm 搜索，内置 npm 安装、运行时挂载免重启）· **双通道更新**（应用自更新 + dsh 官方版 overlay，一键回退）· electron-updater 自动更新 · 黑鲸鱼官方图标 · 会话日志修复工具。

## 快速开始

1. 首次启动选择数据目录（默认独立，可复用 `~/.dsh`）。
2. 设置 → 模型，填入 DeepSeek API 密钥（立即生效）。
3. 选择工作区，开聊。

安装包：`DeepSeek-Harness-Desktop-Setup-<版本>.exe`（NSIS）/ 便携版，从 [Releases](https://github.com/Easyhoov/deepseek-harness-desktop/releases) 获取（`v*` tag 推送后由 GitHub Actions 自动构建并附带 `latest.yml`，已装版本自动更新）。**未做代码签名**（SmartScreen 会提示）；签名通过 CI 的 `CSC_LINK`/`CSC_KEY_PASSWORD` 接入。

## 环境变量

| 变量 | 作用 |
|---|---|
| `DSH_DESKTOP_HOME` | Harness home（优先级最高；退而取 `DSH_HOME`，再退到 `<userData>/dsh-home`） |
| `DSH_DESKTOP_CWD` | boot 工作目录（默认用户主目录） |
| `DSH_DESKTOP_SCHEME=file` | 调试用 `file://` 加载（会丢失 `isLoopback`，默认 `app://localhost`） |

> **不要**让桌面版与 `dsh web` 同时写同一个 home（会话日志会并发撕裂）；应用会在启动时检测并存 web 实例并警告。

## 开发与打包

`npm install && npm start`（开发）；`npm run dist`（便携 + NSIS）。四个踩坑记录（均为本仓库实测修复）：禁用 `npmRebuild`（node-pty 无法在无 Spectre 库时编译且 web 组合不用它）；`node_modules` 全量 `asarUnpack`（junction 不能指向 asar 内部）；严禁全局 `ELECTRON_RUN_AS_NODE`（utility 子进程崩溃循环）；`app://` 协议处理器用 fs 直读而非 `net.fetch(file://)`。目录选择器用 Electron 原生对话框替代 koffi 子进程后端。

**桌面插件开发**：余额/文件还原/插件市场都是普通双面 dsh 插件（`plugins/*`，启动时拷入 profile 的 node_modules 并经 overlay 挂载）。host 半注入 `desktopUi`（`send`/`on`/`npm`/`profileDir`），可直接读会话事件流与宿主服务；client 半注册 slot 时组件必须是 `register` 的第二参数。三个内置插件就是模板，详见英文版 "Desktop plugins" 一节。

**dsh overlay 双通道更新**：⋯菜单 → 更新 dsh，把官方 `@deepseek-ai/dsh` 装进 `<userData>/agent`，下次启动组合整体从 overlay 引导（回退链接重指向、进程内重启），一键回退内置版。

## 会话日志修复

上游 rc.6 在**中断回合**时可能把 `step/end`/`turn/end` 与缓冲分块写乱序（seq 双重占用），严格读器报 `corrupt session log`。`scripts/repair-log.mjs` 仿真读器提交链并精确重编号（时间戳不动），**仅在会话转冷（宿主已退出）后**执行：`node scripts/repair-log.mjs <session.jsonl.zstd> --in-place`。`scripts/inspect-log.mjs` 用于审计。

## 许可

MIT（本项目）；上游 `@deepseek-ai/dsh` 为 MIT © DeepSeek；鲸鱼商标归 DeepSeek。详见 `LICENSE` 与 README 顶部声明。
