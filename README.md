<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  <a href="https://github.com/Easyhoov/deepseek-harness-desktop-windows"><img src="https://img.shields.io/github/stars/Easyhoov/deepseek-harness-desktop-windows?style=flat&label=★&color=08C" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/Platform-Windows-47848F?style=flat" alt="Windows">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <a href="https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases"><img src="https://img.shields.io/github/v/release/Easyhoov/deepseek-harness-desktop-windows?style=flat&label=release" alt="Release"></a>
</p>

<h3 align="center">把 DeepSeek Harness 装进 Windows 桌面的应用 —— 不用装 Node.js、不用敲命令，双击即用</h3>

<p align="center">中文 · <a href="README_en.md">English</a></p>

---

## 主要功能

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🖥️ Desktop 桌面封装</h3>
      <p>自带完整 DSH 运行时，无需安装 Node.js 或执行命令。宿主在应用内部启动（进程内集成）：零端口、零子进程、无本地 HTTP 服务；关闭窗口驻留托盘，会话不中断。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🛒 插件商店</h3>
      <p>内置社区插件商店（ZASENJC）：在 <b>设置 → 插件 → 插件商店</b>（或输入 <code>/store</code>）浏览、搜索、一键安装与卸载，安装后重启生效。也支持命令行 <code>dsh plugin add</code>（npm / GitHub / monorepo 子目录）。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>✨ 桌面增强</h3>
      <p>系统托盘常驻、原生通知（回复完成 / 审批 / 更新就绪）、会话余额实时显示、文件改动追踪与一键还原、崩溃自动恢复、首启数据目录向导（独立目录或复用 <code>~/.dsh</code>）。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔄 一键更新</h3>
      <p>启动自动检查更新，下载显示实时进度（任务栏同步），退出时以可见安装器完成安装并自动重启——下载、安装全程有反馈，不再静默。</p>
    </td>
  </tr>
</table>

![DeepSeek Harness Desktop](docs/screenshots/app.png)

## 插件生态

DeepSeek Harness 基于 [Cordis](https://github.com/cordiverse/cordis)，采用 **"一切皆插件"** 架构：模型适配器、工具、会话、Agent 循环等核心能力都以插件参与运行，外部插件通过 **profile 与 bundle** 接入现有运行时。

本项目的桌面功能本身就是标准 DSH 插件（bundle + 声明式补丁），与 profile 组合，`dsh web` 同样可以识别。安装插件：

```sh
dsh plugin --profile web add <包名>
dsh plugin --profile web add github:<仓库>
```

## 与官方项目的关系

本项目基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 构建。

DSH 的核心能力、插件系统和 Web UI 全部来自官方项目。本项目主要负责：

- 桌面应用封装（进程内宿主 + IPC 桥，零端口）
- 桌面窗口与系统托盘
- Windows 安装包构建与发布
- 桌面环境下的界面适配与插件集成

> ⚠️ **非官方**：这是社区桌面版本，与 DeepSeek 无任何隶属或背书关系。

## 安装

从 [GitHub Releases](https://github.com/Easyhoov/deepseek-harness-desktop-windows/releases/latest) 下载最新安装包（Windows 10/11，x64），双击安装即可。

## 快速开始

1. 安装并启动应用
2. 首次启动选择数据目录：独立目录（默认）或复用命令行 dsh 的 `~/.dsh`
3. 在 **设置 → 模型** 配置模型
4. 开始对话；需要扩展时去 **设置 → 插件 → 插件商店**

## 开发

从源码构建需要 Node.js ≥ 20：

```sh
npm ci
npm start       # 开发运行
npm run dist    # 构建安装包（输出到 release/）
```

## 更多

- [更新日志](CHANGELOG.md) · [English](README_en.md)
- 问题与建议：在 [Issues](https://github.com/Easyhoov/deepseek-harness-desktop-windows/issues) 反馈
