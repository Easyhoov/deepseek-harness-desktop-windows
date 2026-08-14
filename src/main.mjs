/**
 * DeepSeek Harness Desktop — Electron main entry.
 *
 * Boots the shipped `web` profile composition in-process (no child process,
 * no HTTP listener), materializes the built frontend dist beside user data,
 * and bridges every renderer fetch/WebSocket over Electron IPC. The window
 * loads the dist from a privileged app:// scheme.
 *
 * Desktop conveniences: first-run home wizard (+ live dsh-web conflict
 * guard), system tray with close-to-tray, host-event-driven native
 * notifications, renderer crash recovery, chunked IPC responses with
 * taskbar progress for session exports, and electron-updater wiring.
 *
 * Environment:
 *   DSH_DESKTOP_HOME  → harness home (highest precedence).
 *   DSH_HOME          → inherited fallback when DSH_DESKTOP_HOME is unset.
 *   DSH_DESKTOP_CWD   → boot working directory (default: user home).
 *   DSH_DESKTOP_SCHEME=file → load the dist over file:// (debug only).
 *
 * @module dsh-desktop/main
 */
import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron';
import { writeFile, readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { createIpcWebServer } from './ipc-web-server.mjs';
import { bootDesktop } from './boot.mjs';
import { installIpcBridge } from './ipc-bridge.mjs';
import { prepareSite } from './site.mjs';
import { resolveHome, guardSharedHome } from './home.mjs';
import { installNotifications } from './notifications.mjs';
import { createTray } from './tray.mjs';
import { installUpdater } from './updates.mjs';
import { runNpm } from './npm-runner.mjs';
import { overlayAnchor, overlayVersion, bundledDshVersion, activeDshVersion, checkLatestDsh, installDshOverlay, rollbackDshOverlay } from './dsh-overlay.mjs';

/** File log for packaged runs (the GUI binary detaches from the console). */
function logLine(line) {
	try {
		appendFileSync(join(app.getPath('userData'), 'dsh-desktop.log'), `${new Date().toISOString()} ${line}\n`);
	} catch {
		/* best effort */
	}
}

/** Minimal MIME table for the materialized dist tree. */
const MIME_BY_EXT = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
};

function contentTypeFor(pathname) {
	return MIME_BY_EXT[extname(pathname).toLowerCase()] ?? 'application/octet-stream';
}

const APP_NAME = 'DeepSeek Harness Desktop';
// app:// (host `localhost`) is the default: a standard, secure origin keeps
// the shipped client's `connection.isLoopback` true (host-scoped settings,
// open-file affordances) while serving the dist without any server. file://
// remains available via env but reports a non-loopback origin to the client.
const SCHEME = process.env.DSH_DESKTOP_SCHEME === 'file' ? 'file' : 'app';

if (SCHEME === 'app') {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: 'app',
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
				stream: true,
			},
		},
	]);
}

const DESKTOP_SURFACE_TEXT = `You are interacting with the user through the DeepSeek Harness desktop application (an Electron shell). The host composition runs in-process inside the Electron main process: the built frontend loads from the local file system (a dist copy, not a server), every /api request and event downlink crosses an Electron IPC bridge instead of HTTP, and there is no browser, no listening port, and no local HTTP server. The window can be hidden to the system tray while sessions keep running, and native notifications announce approvals, questions, errors, and finished replies. When the user refers to "this app", "this window", or "this GUI" without naming another target, they mean this desktop GUI. UI changes require rebuilding and restarting the desktop app; never promise hot reloads. Do not start replacement servers — the desktop carrier owns the transport.`;

let win = null;
let splash = null;
let ctx = null;
let bridge = null;
let notifications = null;
let updater = null;
let tray = null;
let quitting = false;
let recovering = false;
let wwwDir = '';
let indexPath = '';
let crashStrikeStart = 0;
let crashStrikes = 0;

const getWindow = () => (win !== null && !win.isDestroyed() ? win : undefined);

/** The desktop carrier's renderer push channel, injected into the host tree
 * as the `desktopUi` service (desktop plugins read it with ctx.get). */
const desktopUi = {
	send(channel, payload) {
		const target = getWindow();
		if (target === undefined || target.webContents.isDestroyed()) return;
		target.webContents.send(channel, payload);
	},
	/** Register a renderer-callable RPC for desktop plugins (sender-verified). */
	on(channel, handler) {
		ipcMain.handle(channel, (event, payload) => {
			const target = getWindow();
			if (target === undefined || event.sender.id !== target.webContents.id) {
				return { ok: false, reason: 'untrusted sender' };
			}
			try {
				return Promise.resolve(handler(payload ?? {}));
			} catch (error) {
				return { ok: false, reason: String(error?.message ?? error) };
			}
		});
		return () => ipcMain.removeHandler(channel);
	},
	/** Self-contained npm (bundled package under Electron's own Node). */
	npm(args) {
		return runNpm(args, { logLine });
	},
	/** Set by the boot layer once the profile directory is known. */
	profileDir: '',
};

function showWindow() {
	const target = getWindow();
	if (target === undefined) return;
	if (target.isMinimized()) target.restore();
	target.show();
	target.focus();
}

function quitApp(code = 0) {
	app.exitCode = code;
	app.quit();
}

// ---------------------------------------------------------------------------
// startup splash: a small frameless window shown while the host boots.
// ---------------------------------------------------------------------------
function createSplash() {
	try {
		const icon = readFile(join(app.getAppPath(), 'assets', 'icon.png')).then((data) => data.toString('base64'));
		const html = (iconB64) => `<!doctype html><html><head><meta charset="utf-8"><style>
			html,body{height:100%;margin:0}
			body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
				background:#f6f8fc;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#1a2233}
			img{width:64px;height:64px;border-radius:16px;animation:pulse 1.6s ease-in-out infinite}
			.spinner{width:18px;height:18px;border:2px solid #d5dbe8;border-top-color:#1a2233;border-radius:50%;animation:spin .8s linear infinite}
			.t{font-size:13px;font-weight:600;letter-spacing:.3px}
			@keyframes spin{to{transform:rotate(360deg)}}
			@keyframes pulse{0%,100%{opacity:.75;transform:scale(1)}50%{opacity:1;transform:scale(1.04)}}
			</style></head><body><img src="data:image/png;base64,${iconB64}"><div class="spinner"></div><div class="t">DeepSeek Harness 启动中…</div></body></html>`;
		splash = new BrowserWindow({
			width: 340,
			height: 220,
			frame: false,
			transparent: true,
			resizable: false,
			alwaysOnTop: true,
			skipTaskbar: true,
			show: true,
		});
		void icon.then((b64) => splash?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html(b64))}`));
	} catch (error) {
		logLine(`splash failed: ${String(error)}`);
	}
}

function destroySplash() {
	if (splash === null) return;
	try {
		splash.destroy();
	} catch {
		/* already gone */
	}
	splash = null;
}

// ---------------------------------------------------------------------------
// session log export: the shipped client hands the browser a download URL;
// the desktop carrier runs the export in-process, shows taskbar progress,
// saves through a native dialog, and notifies on completion.
// ---------------------------------------------------------------------------
async function handleExportRequest(urlString) {
	if (bridge === null) return;
	let parsed;
	try {
		parsed = new URL(urlString);
	} catch {
		return;
	}
	const sessionId = parsed.searchParams.get('sessionId');
	if (sessionId === null || sessionId === '') return;
	const includeDescendants = parsed.searchParams.get('includeDescendants') === 'true';
	const filename = `dsh-session-${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.zip`;
	const target = getWindow();
	if (target === undefined) return;
	const { canceled, filePath } = await dialog.showSaveDialog(target, {
		title: 'Export session log',
		defaultPath: join(app.getPath('downloads'), filename),
		filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
	});
	if (canceled || filePath === undefined) return;
	const abort = new AbortController();
	target.setProgressBar(2); // indeterminate
	try {
		const body = await bridge.exportSessionLog(sessionId, includeDescendants, abort.signal);
		await writeFile(filePath, body);
		target.setProgressBar(-1);
		notifications?.notify('DSH · 导出完成', filename, () => shell.showItemInFolder(filePath));
		logLine(`export done: ${filePath}`);
	} catch (error) {
		abort.abort();
		target.setProgressBar(-1);
		if (!abort.signal.aborted) {
			dialog.showErrorBox('Session export failed', String(error?.stack ?? error));
		}
	}
}

// ---------------------------------------------------------------------------
// window + navigation policy
// ---------------------------------------------------------------------------
function createWindow() {
	const created = new BrowserWindow({
		width: 1440,
		height: 920,
		minWidth: 960,
		minHeight: 640,
		show: false,
		frame: false,
		title: APP_NAME,
		backgroundColor: '#101014',
		icon: join(app.getAppPath(), 'assets', 'icon.png'),
		webPreferences: {
			preload: join(app.getAppPath(), 'src', 'preload.cjs'),
			contextIsolation: false,
			nodeIntegration: false,
			sandbox: false,
			webSecurity: true,
			spellcheck: false,
		},
	});
	win = created;

	// Close-to-tray: the harness keeps running behind the tray icon.
	created.on('close', (event) => {
		if (quitting) return;
		event.preventDefault();
		created.hide();
	});

	created.once('ready-to-show', () => {
		destroySplash();
		created.show();
	});
	// Custom-chrome maximize state → the injected title bar swaps its glyph.
	const sendMaximized = (isMaximized) => {
		if (!created.webContents.isDestroyed()) created.webContents.send('dsh:chrome-maximized', isMaximized);
	};
	created.on('maximize', () => sendMaximized(true));
	created.on('unmaximize', () => sendMaximized(false));
	created.webContents.on('console-message', (event) => {
		const { level, message } = event;
		console.log(`[renderer:${level}] ${message}`);
		if (level >= 2) logLine(`[renderer:${level}] ${message}`);
	});
	created.webContents.on('destroyed', () => {
		if (bridge !== null) bridge.onSenderGone(created.webContents.id);
	});
	created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

	created.webContents.on('will-navigate', (event, url) => {
		let parsed;
		try {
			parsed = new URL(url);
		} catch {
			event.preventDefault();
			return;
		}
		if (parsed.pathname === '/api/session.export') {
			event.preventDefault();
			void handleExportRequest(url);
			return;
		}
		const allowed = SCHEME === 'file' ? url.startsWith('file://') : url.startsWith('app://');
		if (!allowed) {
			event.preventDefault();
			if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
				void shell.openExternal(url);
			}
		}
	});

	return created;
}

async function openWindow() {
	createWindow();
	if (SCHEME === 'app') {
		await win.loadURL('app://localhost/index.html');
	} else {
		await win.loadFile(indexPath);
	}
}

// ---------------------------------------------------------------------------
// prompt surface: orient the agent to the desktop shell.
// ---------------------------------------------------------------------------
function registerDesktopSurface() {
	const systemPrompt = ctx?.get('systemPrompt');
	if (systemPrompt === undefined) return;
	systemPrompt.section({
		name: 'app:desktop-surface',
		order: -98,
		text: () => DESKTOP_SURFACE_TEXT,
	});
}

// ---------------------------------------------------------------------------
// shutdown
// ---------------------------------------------------------------------------
async function shutdown() {
	console.log('[dsh-desktop] shutting down');
	try {
		notifications?.dispose();
		notifications = null;
		updater?.dispose();
		updater = null;
		destroySplash();
		if (bridge !== null) bridge.dispose();
		bridge = null;
		tray?.destroy();
		tray = null;
		if (win !== null && !win.isDestroyed()) win.destroy();
		if (ctx !== null) await ctx.fiber.dispose();
	} catch (error) {
		console.error('[dsh-desktop] dispose failed:', error);
	}
	console.log('[dsh-desktop] goodbye');
}

// ---------------------------------------------------------------------------
// custom window chrome: IPC handlers for the injected title bar.
// ---------------------------------------------------------------------------
function installChromeIpc() {
	const trusted = (event) => {
		const target = getWindow();
		return target !== undefined && event.sender.id === target.webContents.id;
	};
	ipcMain.handle('dsh:chrome-init', (event) => {
		if (!trusted(event)) return null;
		return { appName: APP_NAME, appVersion: app.getVersion(), dshVersion: activeDshVersion(app.getPath('userData')) };
	});
	ipcMain.handle('dsh:chrome-window', (event, { action } = {}) => {
		if (!trusted(event)) return false;
		const target = getWindow();
		if (target === undefined) return false;
		switch (action) {
			case 'minimize':
				target.minimize();
				return true;
			case 'toggle-maximize':
				if (target.isMaximized()) target.unmaximize();
				else target.maximize();
				return true;
			case 'close':
				target.close();
				return true;
			case 'is-maximized':
				return target.isMaximized();
			default:
				return false;
		}
	});
	ipcMain.handle('dsh:chrome-menu', async (event, { action } = {}) => {
		if (!trusted(event)) return null;
		const userData = app.getPath('userData');
		switch (action) {
			case 'check-updates':
				void updater?.check();
				return true;
			case 'check-dsh-update': {
				const current = activeDshVersion(userData);
				const latest = await checkLatestDsh({ logLine });
				if (latest === null) {
					dialog.showMessageBoxSync(getWindow(), { type: 'warning', title: APP_NAME, message: '检查失败', detail: '无法查询官方 @deepseek-ai/dsh 版本（npm 网络不可达？）', buttons: ['确定'], noLink: true });
					return true;
				}
				if (latest === current) {
					dialog.showMessageBoxSync(getWindow(), { type: 'info', title: APP_NAME, message: 'dsh 已是最新', detail: `当前 ${current}（官方最新 ${latest}）`, buttons: ['确定'], noLink: true });
					return true;
				}
				const choice = dialog.showMessageBoxSync(getWindow(), {
					type: 'info',
					title: APP_NAME,
					message: `发现官方 dsh 新版本 ${latest}`,
					detail: `当前 ${current}。更新会安装官方发行版到用户目录，重启后生效（可一键回退内置版）。`,
					buttons: ['立即更新', '取消'],
					defaultId: 0,
					cancelId: 1,
					noLink: true,
				});
				if (choice !== 0) return true;
				notifications?.notify('DSH · 正在更新 dsh', `下载并安装官方 ${latest}…`);
				const result = await installDshOverlay(userData, latest, { logLine });
				if (!result.ok) {
					dialog.showErrorBox('dsh 更新失败', result.reason);
					return true;
				}
				const again = dialog.showMessageBoxSync(getWindow(), {
					type: 'info', title: APP_NAME, message: 'dsh 更新完成', detail: `官方 ${latest} 已安装，重启应用后生效。`, buttons: ['立即重启', '稍后'], defaultId: 0, cancelId: 1, noLink: true,
				});
				if (again === 0) {
					app.relaunch();
					quitApp(0);
				}
				return true;
			}
			case 'rollback-dsh': {
				const overlay = overlayVersion(userData);
				if (overlay === null) {
					dialog.showMessageBoxSync(getWindow(), { type: 'info', title: APP_NAME, message: '没有可回退的 overlay', detail: `当前使用内置版 ${bundledDshVersion()}`, buttons: ['确定'], noLink: true });
					return true;
				}
				const choice = dialog.showMessageBoxSync(getWindow(), {
					type: 'question', title: APP_NAME, message: `回退到内置 dsh ${bundledDshVersion()}？`, detail: `将移除用户目录的 overlay（${overlay}），重启后生效。`, buttons: ['回退并重启', '取消'], defaultId: 0, cancelId: 1, noLink: true,
				});
				if (choice !== 0) return true;
				rollbackDshOverlay(userData);
				app.relaunch();
				quitApp(0);
				return true;
			}
			case 'quit':
				quitApp(0);
				return true;
			case 'about':
				dialog.showMessageBoxSync(getWindow(), {
					type: 'info',
					title: APP_NAME,
					message: APP_NAME,
					detail: `版本 ${app.getVersion()}\ndsh ${activeDshVersion(userData)}${overlayVersion(userData) !== null ? '（overlay）' : '（内置）'}\n非官方 DeepSeek Harness 桌面版（MIT）`,
					buttons: ['确定'],
					noLink: true,
				});
				return true;
			default:
				return false;
		}
	});
	ipcMain.handle('dsh:open-external', (event, { url } = {}) => {
		if (!trusted(event)) return false;
		try {
			const parsed = new URL(String(url));
			if (parsed.protocol !== 'https:') return false;
			void shell.openExternal(parsed.toString());
			return true;
		} catch {
			return false;
		}
	});
	return () => {
		ipcMain.removeHandler('dsh:chrome-init');
		ipcMain.removeHandler('dsh:chrome-window');
		ipcMain.removeHandler('dsh:chrome-menu');
		ipcMain.removeHandler('dsh:open-external');
	};
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
async function run() {
	const { home, source } = await resolveHome({ app, dialog, logLine });
	const guarded = await guardSharedHome({ app, dialog, home, logLine });
	process.env.DSH_HOME = guarded.home;
	if (guarded.switched === true) logLine(`home switched at runtime: ${process.env.DSH_HOME}`);
	logLine(`home resolved (source=${source})`);
	const cwd = process.env.DSH_DESKTOP_CWD || app.getPath('home');
	try {
		process.chdir(cwd);
	} catch {
		/* keep the inherited cwd */
	}

	createSplash();
	console.log(`[dsh-desktop] booting web profile in-process (DSH_HOME=${process.env.DSH_HOME}, scheme=${SCHEME})`);
	logLine(`booting (DSH_HOME=${process.env.DSH_HOME}, scheme=${SCHEME})`);
	const webServer = createIpcWebServer();

	// Native directory chooser: Electron's own dialog replaces the shipped
	// koffi child-process backend (which cannot run under Electron). The
	// client-side flow occupant stays mounted via the desktop overlay.
	// Provided in the boot prepare hook because the API gateway injects it.
	const directoryPicker = {
		capability() {
			return {
				kind: 'native',
				pick: async (signal) => {
					const target = getWindow();
					if (target === undefined || signal?.aborted === true) return null;
					const { canceled, filePaths } = await dialog.showOpenDialog(target, {
						title: 'Select Workspace Directory',
						properties: ['openDirectory', 'createDirectory'],
					});
					if (canceled || filePaths.length === 0) return null;
					return filePaths[0];
				},
			};
		},
	};

	ctx = await bootDesktop({
		webServer,
		directoryPicker,
		desktopUi,
		overlayAnchor: overlayAnchor(app.getPath('userData')),
		onExit: quitApp,
	});
	logLine('boot ok');
	installChromeIpc();
	logLine(`dsh ${activeDshVersion(app.getPath('userData'))} (${overlayVersion(app.getPath('userData')) !== null ? 'overlay' : 'bundled'})`);

	const clientModules = ctx.get('clientModules');
	if (clientModules === undefined) {
		throw new Error('dsh-desktop: the client-modules row did not mount; the web profile is incomplete');
	}

	wwwDir = join(app.getPath('userData'), 'www');
	({ indexPath } = prepareSite({ webServer, clientModules, wwwDir, scheme: SCHEME }));
	logLine(`site ok (${indexPath})`);

	bridge = installIpcBridge({ ctx, webServer, getWindow, ipcMain, logLine });
	registerDesktopSurface();
	notifications = installNotifications({ ctx, getWindow, logLine });
	updater = installUpdater({ app, notify: notifications?.notify, logLine });

	if (SCHEME === 'app') {
		protocol.handle('app', async (request) => {
			const url = new URL(request.url);
			const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
			try {
				const data = await readFile(join(wwwDir, pathname));
				return new Response(data, {
					headers: { 'content-type': contentTypeFor(pathname) },
				});
			} catch {
				return new Response('not found', { status: 404 });
			}
		});
	}

	// Session-scoped download interception (registered once: the session
	// survives window recovery, while per-window listeners would duplicate).
	session.defaultSession.on('will-download', (event, item) => {
		const url = item.getURL();
		if (url.includes('/api/session.export')) {
			event.preventDefault();
			void handleExportRequest(url);
		}
	});

	await openWindow();
	tray = createTray({
		app,
		onShow: showWindow,
		onQuit: () => quitApp(0),
		onCheckUpdates: () => void updater?.check(),
		logLine,
	});
	logLine('window created');

	// Background update check shortly after a clean boot.
	setTimeout(() => void updater?.check(), 15_000).unref?.();

	console.log('[dsh-desktop] ready');
	logLine('ready');
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------
app.setName(APP_NAME);
app.setAppUserModelId('com.deepseek.harness.desktop');

app.on('render-process-gone', (_event, _webContents, details) => {
	logLine(`renderer gone: ${JSON.stringify(details)}`);
	if (quitting || recovering) return;
	const now = Date.now();
	if (now - crashStrikeStart > 60_000) {
		crashStrikeStart = now;
		crashStrikes = 0;
	}
	crashStrikes += 1;
	if (crashStrikes > 3) {
		logLine('renderer crashed repeatedly; giving up');
		dialog.showErrorBox(
			'DeepSeek Harness Desktop',
			'界面进程反复崩溃，应用即将退出。请查看日志或重启应用。',
		);
		quitApp(1);
		return;
	}
	// The host composition survives: rebuild the window and reload the site.
	recovering = true;
	logLine(`recovering renderer (strike ${crashStrikes})`);
	openWindow()
		.catch((error) => logLine(`recovery failed: ${String(error)}`))
		.finally(() => {
			recovering = false;
		});
});

app.on('child-process-gone', (_event, details) => {
	if (details.reason !== 'clean-exit') {
		logLine(`child gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
	}
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on('second-instance', () => {
		showWindow();
	});

	// Tray-resident: closing the window hides it; quitting is explicit.
	app.on('window-all-closed', () => {
		/* stay alive in the tray */
	});

	app.on('before-quit', (event) => {
		if (quitting) return;
		event.preventDefault();
		quitting = true;
		shutdown().finally(() => {
			app.exit(app.exitCode ?? 0);
		});
	});

	app.whenReady()
		.then(run)
		.catch((error) => {
			console.error('[dsh-desktop] boot failed:', error);
			logLine(`boot failed: ${String(error?.stack ?? error)}`);
			void shutdown()
				.catch(() => {})
				.finally(() => {
					dialog.showErrorBox(
						'DeepSeek Harness Desktop failed to start',
						String(error?.stack ?? error),
					);
					app.exit(1);
				});
		});
}
