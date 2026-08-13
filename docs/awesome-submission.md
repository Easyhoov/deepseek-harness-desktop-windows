# Awesome-list submission texts

Paste-ready blurbs for submitting this project to DSH ecosystem directories.
Both directories take GitHub issues or PRs; adapt the category header to their
current section layout.

---

## 1. `0xsline/awesome-deepseek-harness` — Infrastructure section

> Title / 标题：**DeepSeek Harness Desktop — unofficial in-process desktop app**

**English:**

**DeepSeek Harness Desktop** is an unofficial Windows desktop application for DeepSeek Harness that follows the upstream integration seam instead of wrapping `dsh web` in a browser window. The full host composition boots **in-process inside the Electron main process** (via `dsh-app-boot`), the built Web frontend is served from a materialized dist copy over a privileged `app://localhost` scheme, and every `/api` request plus the mux/host event downlinks cross an **Electron IPC bridge** (`toFetchHandler(apiProxy)` → mock req/res → captured webServer routes). No child process, no listening port, no local HTTP server — the shipped 37 client plugin bundles run unmodified.

Highlights:

- Tray residency (close-to-tray keeps sessions, goals, and jobs running) and host-event-driven native notifications (approvals, questions, agent errors, background reply completion)
- First-run home wizard (private data dir or shared `~/.dsh`) with a live-`dsh web` conflict guard
- Renderer crash recovery with the host state intact; chunked IPC responses; session export with taskbar progress
- Ships the official black-whale favicon as the app icon; `electron-updater` wired; NSIS + portable builds
- Includes a repair tool for the upstream interruption-flush seq-reorder bug (`corrupt session log: seq gap in committed region`)

- Repository: `<your repo URL>`
- Status: working on Windows (macOS/Linux packaging planned) · MIT · unofficial (not affiliated with DeepSeek)

**中文：**

**DeepSeek Harness Desktop** 是 DeepSeek Harness 的非官方 Windows 桌面应用。不走"spawn `dsh web` + 浏览器窗口"的薄封装路线，而是按官方预留的集成接缝实现：host 组合**在 Electron 主进程内进程内启动**，构建好的 Web 前端以 `app://localhost` 特权 scheme 加载，全部 `/api` 请求与 mux/host 事件下行走 **Electron IPC 桥**（`toFetchHandler(apiProxy)` + 捕获的 webServer 路由）。无子进程、无端口、无本地 HTTP 服务器，出厂 37 个客户端插件零改动运行。

亮点：托盘常驻（关窗继续跑）+ 宿主事件流原生通知；首次启动 home 向导 + `dsh web` 并发冲突检测；渲染进程崩溃自动恢复；分块 IPC 响应；导出任务栏进度；官方黑鲸鱼图标；electron-updater 自动更新；附带上游"中断回合刷盘乱序"日志修复工具。MIT，非官方（与 DeepSeek 无隶属关系）。

---

## 2. `AdamPlatin123/awesome-dsh-plugins` — Tools / infrastructure entry

> Note: this directory tracks DSH **plugins**; a desktop app is an adjacent
> deliverable. Only submit if their scope accepts tooling/infrastructure —
> otherwise the `0xsline` list above is the right home.

**English:**

**DeepSeek Harness Desktop** — unofficial in-process desktop packaging of DeepSeek Harness: host composition inside the Electron main process, `app://` dist loading, all API traffic over an IPC bridge, zero ports. Complements any plugin set with tray residency, native notifications driven by host events, crash recovery, and a session-log repair tool for the upstream interruption-flush seq bug. MIT, Windows builds (NSIS/portable), not affiliated with DeepSeek. Repository: `<your repo URL>`

**中文：**

**DeepSeek Harness Desktop** —— DeepSeek Harness 非官方进程内桌面封装：host 组合跑在 Electron 主进程、`app://` 加载前端、全部 API 走 IPC 桥、零端口。提供托盘常驻、宿主事件原生通知、崩溃恢复，以及上游"中断回合刷盘乱序"的会话日志修复工具。MIT，Windows（NSIS/便携版），与 DeepSeek 无隶属关系。仓库：`<your repo URL>`

---

## Checklist before submitting

- [ ] Repository public, with `README.md` (English + 中文), `LICENSE`, and the unofficial disclaimer at the top
- [ ] Replace `<your repo URL>` above with the real URL
- [ ] Optional but helpful: tag the repo `dsh` + `deepseek-harness` (+ `dsh-plugin` only if the directory expects it)
- [ ] Pick the right section (Infrastructure vs Plugins) and follow the target list's contribution format (issue vs PR)
