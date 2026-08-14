# v0.2 规划：对齐 dsh_desktop 的五项功能

> 目标仓库：`myYangyunfan/dsh_desktop`（**无 LICENSE，保留所有权利**）。本方案只学机制、
> 独立实现，不复制任何代码或资源。

## 0. 架构差异对每项功能的影响

| 他们（spawn `dsh web` + 浏览器窗口） | 我们（进程内 host + IPC 桥） | 结论 |
|---|---|---|
| 有 `127.0.0.1:端口`、有子进程、可 `taskkill` 收尾 | 零端口零子进程，宿主状态在 main 进程内 | 更干净，但 overlay 更新/重启语义要重设计 |
| preload 用 `contextBridge`（sandbox-safe） | preload 用 `contextIsolation:false`（主世界直改 window） | 无边框栏注入方式不同，功能等价 |
| 插件安装需重启整个 `dsh web`（restartService） | Cordis Loader 支持运行时 `ctx.loader.create` | **插件市场可免重启**，这是我们的优势 |
| overlay 更新=换 `dshBin()` 路径，子进程重启即生效 | 组合靠 `INSTALL_ANCHOR` + healed 回退链接解析 | overlay 可重指向，但要在同进程内 dispose 旧 ctx 再 boot |

## 1. 无边框窗口 + 玻璃标题栏 + 启动/更新动画

**目标**：自绘 36px 玻璃标题栏（拖拽区、圆角图标、标题/版本、⋯菜单、最小化/最大化/关闭）、Win11 圆角、启动 splash、更新动画页。

**他们的做法**：`BrowserWindow` `frame:false`；preload 注入 `<div id=__dsh_desktop_chrome__>`，用 CSS `backdrop-filter: blur + saturate` + `color-mix()` 读页面主题变量 `--dsw-alias-*`（因此自动跟随 DSH 明暗主题）；`body{padding-top:36px}` 下移内容；`-webkit-app-region` 区分拖拽/按钮；⋯菜单 = 自绘下拉（含"关于/检查更新/重启服务/退出"）。启动/更新各用独立 `loading.html` / `updating.html` 小窗口。

**我们落地**：

- 窗口改 `frame:false`（`roundedCorners` 默认开，Win11 自动圆角）；`transparent` 可选。
- preload（我们已是主世界注入，直接建 DOM）注入同样的 chrome 条；样式里 `var(--dsw-alias-*)` 主题变量在 app:// 下照常可用（同一份 dist）。
- 菜单动作接我们已有的能力：显示/隐藏窗口、检查更新（`updater.check()`）、退出、以及**新增"重启桌面版"**。
- 拖拽用 `-webkit-app-region:drag`，按钮 `no-drag`；最大化状态监听 `win.on('maximize'/'unmaximize')`。
- **启动 splash**：可选。我们 boot+load ~1-2s，比他们（要等 dsh web 起服务）快得多；先做一个极简 `loading.html`（黑鲸鱼 + 淡入）兜底首帧空白，低优先级。
- **更新动画页**：我们的更新模型是 electron-updater（后台下载+退出安装），没有他们的"原地替换"阶段，故 `updating.html` **不需要**——跳过，避免照搬不适用的东西。

**依赖**：无新增依赖。**工作量**：1–2 天。**风险**：低（窗口层改动，不碰 transport）。

## 2. 文件更改追踪 / 一键还原插件

**目标**：会话详情页"文件"标签展示本轮全部文件改动（行级 diff），可单文件/全部还原。

**他们的做法**：`dsh-file-changes`（host）+ `dsh-client-file-changes`（client）双面插件。host 读 `session.jsonl.zstd` 日志抽取文件写入事件并算 diff；client 渲染列表；还原经 preload `revertFiles(changes)` → 主进程 IPC，带**路径围栏**（只允许会话 cwd 之下的项目文件 + 危险扩展黑名单 `.bat/.cmd/.exe/.ps1/...`）。

**我们落地（更优）**：

- 同样做成双面 dsh 插件，但 host half 直接注入宿主服务（`ctx.get('sessions')` / 会话查询 / persistence `readRaw`）拿日志，**无需自己解 zstd**（我们用 in-process 的 ctx，比他们读文件干净）。
- 行级 diff：复用我们自己写的 zstd 解码（`inspect-log.mjs` 的思路）或直接调 persistence；diff 用最小编辑距离（可引入轻量 `diff` 或自写 LCS）。
- 还原：走我们已有 IPC 通道（`dsh:fetch` 的 `/api` 网关 + 一个 desktop 专用端点，或新开一条 `ipcMain.handle('dsh:revert')`）；**必须照抄那个路径围栏思路**（会话 cwd 之外、危险扩展一律拒绝）——这是安全底线，不是可选。
- 挂载：overlay 里加两行（host 行 + `dsh.client` 客户端行），复用我们已验证的 modules 扫描。

**依赖**：自写 diff（或引入 `diff`）。**工作量**：2–3 天。**风险**：中（还原是写盘操作，围栏与 diff 逆应用要测透）。

## 3. 双通道更新（dsh 官方版本 overlay）

**目标**：除"桌面壳自更新"外，新增"内置 dsh agent 本体可独立升级到官方新版本"，两条通道并存。

**他们的做法**：`updater.js` 用内置 node+npm 跑 `npm view @deepseek-ai/dsh version` → 用户同意后 `npm install` 到 `<userData>/agent-staging` → 原子切换为 `<userData>/agent` → `dshBin()` 优先用 overlay、失败可一键回滚内置版。**能跑是因为他们 spawn `node dshBin()`**，换路径即换版本。

**我们的难点**：组合靠静态 ESM + healed 回退链接解析，不是 spawn。落地方案（推荐 **B**）：

- **A（架构退化，不推荐）**：检测到 overlay 时改为 spawn 子进程跑 overlay dsh（退回薄封装），更新后用户失去 in-process 特性。
- **B（保持 in-process，推荐）**：把 `INSTALL_ANCHOR` 与 `healProfilesModuleFallback` 指向 overlay 目录。具体：overlay 安装到 `<userData>/agent/node_modules/@deepseek-ai/dsh@新版`（连同依赖树）；下次启动 `boot.mjs` 发现 overlay 存在且版本更新 → `INSTALL_ANCHOR=overlay 的 package.json` → heal 回退链接重指向 overlay node_modules → `loadProfile`/`boot` 全部走 overlay。随后 `dispose 旧 ctx → 重新 boot`（同进程内完成，窗口 reload 一次）。薄胶水层（`dsh-app-boot` 等）留在内置版，组合本体（真正的 dsh 版本）来自 overlay。
- **风险点**：overlay 的 native 依赖是 npm 用系统 Node ABI 装的——koffi/sharp/`node-addon-require-builtin` 都是 N-API（ABI 稳定），Electron 下可加载（我们已验证 koffi）；需实测。
- **npm 从哪来（自包含，无需 PATH / 无需独立 node.exe）**：把 `npm`（纯 JS，含依赖树约 20MB 级）作为**运行时依赖**打进包；安装时 `spawn(process.execPath, [npm-cli.js, 'install', …], { env: { …process.env, ELECTRON_RUN_AS_NODE: '1' } })`——用 Electron 自带的 Node 跑 npm（已验证可行）。子进程的 lifecycle 脚本继承该变量，同样跑在 electron-as-node 下。**注意**：插件若需要 node-gyp 编译，仍需本机编译工具链（任何方案都绕不开）；纯 JS / N-API 预编译插件无此问题。

**依赖**：npm 运行时（或内置 node+npm）。**工作量**：3–5 天。**风险**：高（同进程重 boot 的模块缓存/资源释放、overlay 依赖树、ABI），需专项验证。

## 4. 插件市场

**目标**：应用内浏览/搜索/安装/卸载 dsh 插件（skill、皮肤、UI、工具）。

**他们的做法**：`dsh-plugin-marketplace` 双面插件；安装后 `restartService` 重启 `dsh web` 生效。

**我们落地（免重启，这是关键差异）**：

- 同样做成 dsh 插件（host 半负责：数据源聚合 + 安装/卸载；client 半负责：设置页 UI）。
- **数据源**：优先聚合我们刚提交过的两个 awesome 目录（`0xsline/awesome-deepseek-harness`、`AdamPlatin123/awesome-dsh-plugins`）+ npm registry（`keywords:dsh`）+ GitHub `dsh-plugin` topic（REST 免鉴权）。
- **安装机制**：插件 = npm 包。装入 profile 的 `node_modules`（`dsh plugin --profile web add <pkg>` 的等价物，或直接 `npm install --prefix <profile>`），然后 **`ctx.loader.create({name})` 运行时挂载**——无需重启（`-auto` 目录选择器已验证这条路）。卸载 = `loader` 移除 + `npm rm`。
- 内置我们已有的 overlay 挂载方式（DESKTOP_PATCHES / 动态 loader.create），零新机制。

**依赖**：`npm`（运行时依赖，见 #3 的"npm 从哪来"）。**工作量**：3–4 天。**风险**：中（运行时 loader.create 卸载/重载的边角 + 包来源信任）。

## 5. 余额小部件（¥ 统计 + 充值跳转）

**目标**：对话底部统计栏显示「本轮 ¥X · 余额 ¥Y」，点击跳转充值。

**他们的做法**：主进程 `balance.js` 查 `https://api.deepseek.com/user/balance`（Bearer key，取 `DEEPSEEK_API_KEY` 或 `.credentials.yaml`）；按模型价格档估算本轮费用；preload 把结果推成 window 事件 `dsh-balance-changed`；client 插件渲染 + 跳 `platform.deepseek.com` 充值页。

**我们落地（更优）**：

- 主进程直接从宿主服务读密钥（`ctx.credentials` / settings），不必解析 `.credentials.yaml` 文件。
- 端点/价格表照用同一套（`/user/balance`、模型价格档、`DEEPSEEK_BALANCE_URL`/`DEEPSEEK_API_BASE` 覆盖），**价格表与端点需随官方调整，做成可配置**。
- 本轮费用估算：从会话 `session/projection` 的 token 统计（宿主已有 token-meter/context-meter）拿更准，优于他们自估。
- 推送到渲染层：复用我们 IPC 桥加一条 `dsh:balance` 推送（或走已有 host 事件流）；client 半做成 `dsh.client` 插件渲染到输入栏统计位（需查 Slot 树确认挂载点）。
- 充值跳转：`shell.openExternal`（我们已有外部打开处理）。

**依赖**：无。**工作量**：0.5–1 天。**风险**：低（只读查询 + UI）。

---

## 优先级与里程碑

| 里程碑 | 内容 | 理由 |
|---|---|---|
| **M1（先做）** | #1 无边框玻璃栏 + #5 余额小部件 | 低风险、见效快、都在窗口/UI 层 |
| **M2** | #2 文件更改/一键还原 | 高频刚需，in-process 有优势 |
| **M3** | #4 插件市场 | 生态放大器，但依赖 #3 的 npm 决策 |
| **M4（最后、独立验证）** | #3 dsh overlay 双通道更新 | 风险最高，需专项 ABI/重 boot 验证 |

**跨切依赖**：#3/#4 都用同一套自包含 npm（`npm` 打进包 + Electron 自带 Node 运行），无 PATH 依赖、无独立 node.exe——与"打包后自包含"一致。所有 dsh 插件（#2/#4/#5 的 client 半）走 overlay 挂载，复用已验证的模块系统。
