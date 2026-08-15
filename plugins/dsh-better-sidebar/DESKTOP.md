# dsh-better-sidebar · DeepSeek Harness Desktop 适配说明

本目录是 [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)
v0.12.2 的桌面版 vendor（MIT）。桌面应用把 `plugins/dsh-better-sidebar/` 作为内置
bundle 装配（见 `dsh-desktop/src/boot.mjs` 的 `DESKTOP_BUNDLES`），随应用分发，无需
用户手动安装。

## 桌面适配做了什么

dsh-better-sidebar 原本是 `dsh web` 的插件：host 半在 HTTP webserver 上注册
`/sidebar/*` 路由与 WebSocket upgrade，client 半注入右侧栏 UI。桌面版没有 HTTP 监听
（载波 = Electron IPC + app:// 协议），所以适配分三层：

### 1. 载波（dsh-desktop/src）——通用能力，所有插件受益

| 文件 | 改动 |
|---|---|
| `ws-ipc.mjs`（新增） | RFC 6455 帧编解码（客户端掩码帧编码、服务端帧流式解码、分片重组、ping/pong/close）+ 满足 `ws` 包 socket 契约的 mock 双工流 |
| `ipc-web-server.mjs` | 新增 `matchUpgrade(pathname)` 访问器 |
| `ipc-bridge.mjs` | `dsh:ws-open` 泛化：非 `/api/events.*` 的 loopback WebSocket 走通用双工会话（`dsh:ws-send` / `dsh:ws-close`），mock socket 驱动插件的 upgrade 路由；导出 mock req/res 供协议层复用 |
| `preload.cjs` | WebSocket shim：loopback 地址（localhost/127.x/[::1]）一律走 IPC 双工（含 `send()` 上行），远程地址仍代理真实 WebSocket |
| `main.mjs` | `protocol.handle('app')` 先分发 webServer 路由（GET/HEAD），命中则进程内返回 —— 让 `<img src="/sidebar/file">`、HTML 预览 iframe、懒加载 chunk `<script>`、下载链接在 app:// 下可用；未命中回落静态站点 |
| `boot.mjs` | `DESKTOP_BUNDLES` 增加 `dsh-better-sidebar`；`ensureVendorDeps` 首次启动时把插件运行依赖（`ws`/`schemastery`/`node-pty`）装进插件自带 node_modules（git 忽略，不入库） |

### 2. 插件 host 半（fork 补丁，仅一处）

`src/pty-manager.ts` / `src/agent-pty.ts`：node-pty 从模块顶层 import 改为**惰性加载**
（`loadNodePty()`，每次打开终端重试 require）。node-pty ≥1.1 自带 NAPI 预编译
（`prebuilds/win32-x64/pty.node`），Electron 下无需重建即可加载；惰性加载只是防御
层——万一某平台没有可用预编译产物，explorer / 编辑器 / Git / 浏览器 / 子代理照常
工作，终端 tab 显示明确错误而非拖垮整个插件。

### 3. 装配

- `package.json`：与上游 npm 包一致（name `dsh-better-sidebar`，`dsh.bundle.patch` →
  `cordis.patch.yml`，`dsh.client` 声明不变），client 半以包名 id 注册，桌面站点按
  `__plugins/dsh-better-sidebar/client.js` 物化；
- `cordis.patch.yml`：单条 `insert`（`better-sidebar` 行），与上游挂载方式相同；
- `lib/`：上游构建产物 + fork 补丁（`pnpm build` 产出）；
- 运行依赖装在插件目录自身的 node_modules（`ensureVendorDeps` 启动时用内置 pnpm
  安装，`auto-install-peers=false`；node-pty 的构建脚本被 pnpm 拦截也无妨——加载走
  NAPI 预编译）。

## 已知限制（桌面版）

- HTML 预览与内嵌浏览器沙箱在 Electron 渲染进程内行为与浏览器一致；`X-Frame-Options`
  拒绝的站点仍会显示原因面板。
- 侧边栏浏览器打开 HTTP 站点走系统浏览器分流等设置与 web 版一致（`browserInterceptHttp`
  默认开）。

## 从上游更新

1. `git clone https://github.com/omdsh-dev/DSH-better-sidebar.git`（或拉取已有克隆）；
2. 应用 fork 补丁（当前仅：`src/pty-manager.ts` 与 `src/agent-pty.ts` 的 node-pty
   惰性加载，见本文档第 2 节；对照本仓库 `dsh-desktop/plugins/dsh-better-sidebar/`
   与上游 diff 即可）；
3. `pnpm install && pnpm build`；
4. 把 `lib/`、`package.json`（保持 `name`/`dsh.*` 字段不变）、`cordis.patch.yml`、
   `LICENSE` 拷回 `dsh-desktop/plugins/dsh-better-sidebar/`，并同步版本号；
5. 重启桌面应用（bundle 变更需重装 profile：应用启动时 `ensureDesktopBundles` 自动
   处理）。

## 测试

- `dsh-desktop/tests/ws-ipc.test.mjs`：帧编解码与 mock socket 对真实 `ws` 双向验证
  （`node --test --test-force-exit tests/`）；
- 端到端：独立 `DSH_DESKTOP_HOME` 启动应用，确认右侧栏出现、资源管理器可浏览、终端
  按 node-pty 状态可用/降级。
