# DeepSeek Harness Desktop（Windows）

[![GitHub stars](https://img.shields.io/github/stars/Easyhoov/deepseek-harness-desktop-windows?style=flat&label=★&color=08C)](https://github.com/Easyhoov/deepseek-harness-desktop-windows)
[![GitHub release](https://img.shields.io/github/v/release/Easyhoov/deepseek-harness-desktop-windows?label=release)](https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-47848F?style=flat)](https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases)
[![Topics](https://img.shields.io/badge/topics-deepseek--harness%20%7C%20dsh--plugin-4D6BFE)](https://github.com/topics/dsh-plugin)

> 把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 装进 Windows 桌面的应用：**不用安装 Node.js、不用敲命令**，双击启动即用，官方 DSH 的 Web 界面与插件生态完整保留。
>
> ⚠️ **非官方**：本项目与 DeepSeek **无任何隶属或背书关系**，仅对开源发行版 `@deepseek-ai/dsh` 做原样封装。鲸鱼标识取自官方 DeepSeek Harness favicon，仅用于视觉一致性，商标归 DeepSeek 所有。

中文 · [English](README_en.md)

---

## 为什么又一个桌面封装？

多数社区桌面版是**拉起 `dsh web` 子进程**、再把浏览器窗口指到 `127.0.0.1:3080`。本项目的做法不同：整份官方组合**跑在 Electron 主进程内部**（进程内集成），前端从本地加载，全部 `/api` 请求与事件走 **IPC 桥**——**零端口、零子进程、无本地 HTTP 服务**。会话、目标、后台任务、插件都是应用内的一等状态：关掉窗口（驻留托盘）它们照常运行。

![DeepSeek Harness Desktop](docs/screenshots/app.png)

## 核心特性

| | |
|---|---|
| 🧬 **进程内集成** | 用 `dsh-app-boot` 在 Electron 主进程内启动官方 `web` profile；无子进程、无端口、无 HTTP 服务器 |
| 🔌 **IPC 传输** | preload 的 `fetch` / `WebSocket` shim 把所有 RPC 走 Electron IPC，官方客户端插件**原样运行** |
| 🪟 **无边框玻璃界面** | 自绘 36px 玻璃标题栏（鲸鱼图标、版本徽章、⋯ 菜单、最小化/最大化/关闭）、Win11 圆角、启动画面，主题跟随 DSH 自身 CSS 变量 |
| 🛍️ **插件商店** | 内置社区插件商店（ZASENJC）：`/store` 或 设置 → 插件 → 插件商店 浏览、搜索、一键安装/卸载；安装走官方 `dsh plugin add`（npm / GitHub / monorepo 子目录 / tarball），自带 pnpm，无黑框、有实时进度，装完重启生效 |
| 💰 **会话余额** | 输入框下方实时显示余额与本轮成本（随用量滚动），点击直达充值页 |
| 📝 **文件改动 + 一键还原** | 会话标题栏"文件"按钮列出 Agent 的每次写入/编辑（带 +/− 行数），可逐个或全部还原——硬围栏保护（仅会话工作目录、拒绝危险扩展名、片段校验） |
| ⬆️ **双通道更新** | 通道一：`electron-updater` 从 GitHub Releases 自更新（实时下载进度 + 可见安装器）；通道二：⋯ 菜单"更新 dsh"可安装更新的官方 `@deepseek-ai/dsh` 并整体切换，一键回退内置版 |
| 🪟 **托盘常驻** | 关闭窗口不退出，会话继续；托盘菜单显示/隐藏窗口、检查更新、退出 |
| 🔔 **原生通知** | 由宿主事件流驱动：审批、提问、Agent 报错、动态插件运行请求；窗口在后台时才通知回复完成 |
| 🏠 **首启数据目录向导** | 选择独立数据目录或复用命令行 dsh 的 `~/.dsh`；共享目录被 `dsh web` 占用时给出冲突警告 |
| 🛡️ **崩溃恢复** | 渲染进程崩溃自动重建窗口并重载界面，宿主状态不丢（每分钟 3 次则放弃） |
| 📦 **会话导出** | 进程内执行、任务栏进度、原生保存对话框、完成通知 |
| 🐋 **官方鲸鱼图标** | DeepSeek Harness favicon（黑鲸）栅格化为 PNG，随应用分发 |
| 🧰 **日志修复工具** | `scripts/repair-log.mjs` 修复上游"中断刷盘乱序"导致的会话日志损坏 |

## 插件生态

DeepSeek Harness 基于 [Cordis](https://github.com/cordiverse/cordis)，采用 **"一切皆插件"** 架构：模型适配器、工具、会话、Agent 循环等核心能力都以插件参与运行，外部插件通过 **profile 与 bundle** 接入。

本项目的桌面功能本身就是标准 DSH 插件（bundle + 声明式补丁），与 profile 组合，`dsh web` 同样可以识别。命令行安装（与 `dsh web` 共用同一个 profile）：

```sh
dsh plugin --profile web add <包名>
dsh plugin --profile web add github:<仓库>
```

## 下载

| 产物 | 说明 |
|---|---|
| `DeepSeek-Harness-Desktop-Setup-<版本>.exe` | NSIS 安装包（可选安装目录），自动更新使用 |
| `DeepSeek-Harness-Desktop-Portable-<版本>.exe` | 便携版 |
| `latest.yml` | 自动更新元数据，随每个 Release 发布 |

最新构建：[GitHub Releases](https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases)（Windows 10/11，x64，GitHub Actions 在每个 `v*` 标签构建）。**未做代码签名**，SmartScreen 会提示；签名已通过 `CSC_LINK` / `CSC_KEY_PASSWORD` 预留。

## 快速开始

1. 启动应用，首次运行选择数据目录（默认独立，或复用 `~/.dsh`）
2. 打开 **设置 → 模型**，填入 DeepSeek API Key（或自定义 OpenAI 兼容端点），即时生效无需重启
3. 选择工作目录（原生系统对话框）并开始会话

与官方 [Quickstart](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart) 流程一致——桌面版启动的就是 CLI 用的同一套 `web` profile 组合，模型配置、工作区、审批、插件开发行为完全一致。

**一处刻意差异**：CLI 默认用调用目录作为工作目录；桌面版从用户主目录启动（可用 `DSH_DESKTOP_CWD` 覆盖），工作区在界面中选择。

## 从源码构建

需要 Node.js ≥ 20：

```sh
npm ci
npm start       # 开发运行
npm run dist    # 构建安装包（输出到 release/）
```

## 更多

- [更新日志](CHANGELOG.md) · [English](README_en.md)
- 问题与建议：在 [Issues](https://github.com/Easyhoov/deepseek-harness-desktop-windows/issues) 反馈
