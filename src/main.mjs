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
		title: APP_NAME,
		autoHideMenuBar: true,
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

	created.once('ready-to-show', () => created.show());
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

	ctx = await bootDesktop({ webServer, directoryPicker, onExit: quitApp });
	logLine('boot ok');

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
