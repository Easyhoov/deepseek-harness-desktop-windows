<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  <a href="https://github.com/Easyhoov/deepseek-harness-desktop-windows"><img src="https://img.shields.io/github/stars/Easyhoov/deepseek-harness-desktop-windows?style=flat&label=★&color=08C" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/Platform-Windows-47848F?style=flat" alt="Windows">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <a href="https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases"><img src="https://img.shields.io/github/v/release/Easyhoov/deepseek-harness-desktop-windows?style=flat&label=release" alt="Release"></a>
</p>

<h3 align="center">DeepSeek Harness for the Windows desktop — no Node.js, no commands, double-click to run</h3>

<p align="center"><a href="README_zh.md">中文</a> · English</p>

---

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🖥️ Desktop packaging</h3>
      <p>Ships a full DSH runtime — no Node.js or commands required. The host boots <b>inside the app</b> (in-process integration): zero ports, zero child processes, no local HTTP server; closing the window keeps sessions running in the tray.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🛒 Plugin store</h3>
      <p>The community plugin store (ZASENJC) is built in: browse, search, install and uninstall from <b>Settings → Plugins → Plugin Store</b> (or type <code>/store</code>); restart to apply. The official <code>dsh plugin add</code> mechanism (npm / GitHub / monorepo subdirectories) works too.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>✨ Desktop conveniences</h3>
      <p>System tray residency, native notifications (replies / approvals / updates), live session balance, file-change tracking with one-click restore, automatic crash recovery, and a first-run data-directory wizard (private or the CLI's <code>~/.dsh</code>).</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔄 One-click updates</h3>
      <p>Automatic checks on startup, live download progress (mirrored on the taskbar), and a visible installer on quit — download and install are never silent.</p>
    </td>
  </tr>
</table>

![DeepSeek Harness Desktop](docs/screenshots/app.png)

## Plugin ecosystem

DeepSeek Harness is built on [Cordis](https://github.com/cordiverse/cordis) with an **"everything is a plugin"** architecture: model adapters, tools, sessions, and the agent loop all run as plugins, and external plugins plug in through **profiles and bundles**.

This app's own desktop features are standard DSH plugins (bundles + declarative patches), composed with the profile and recognized by `dsh web` too. Install plugins:

```sh
dsh plugin --profile web add <package>
dsh plugin --profile web add github:<repo>
```

## Relationship to the official project

Built on [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).

DSH's core capabilities, plugin system, and Web UI come entirely from the official project. This project adds:

- Desktop packaging (in-process host + IPC bridge, zero ports)
- Desktop window and system tray
- Windows installer builds and releases
- Desktop UI adaptation and plugin integration

> ⚠️ **Unofficial.** A community desktop build, not affiliated with or endorsed by DeepSeek.

## Install

Download the latest installer from [GitHub Releases](https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases/latest) (Windows 10/11, x64) and run it.

## Quick start

1. Install and launch
2. On first run, pick a data directory: private (default) or the CLI's `~/.dsh`
3. Configure a model under **Settings → Models**
4. Start chatting; add capabilities from **Settings → Plugins → Plugin Store**

## Development

Requires Node.js ≥ 20:

```sh
npm ci
npm start       # run in development
npm run dist    # build installers (output in release/)
```

## More

- [Changelog](CHANGELOG.md) · [中文](README_zh.md)
- Feedback: file an [Issue](https://github.com/Easyhoov/deepseek-harness-desktop-windows/issues)
