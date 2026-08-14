/**
 * DeepSeek Harness Desktop — preload shims.
 *
 * The shipped Web client uses `globalThis.fetch` for every upstream RPC and
 * `new WebSocket(...)` for the two event downlinks. This preload replaces
 * both with IPC-backed implementations, so the ENTIRE shipped client stack
 * runs unmodified while every byte of host traffic crosses the Electron IPC
 * bridge inside the main process (no network, no port).
 *
 * contextIsolation is OFF for this window by design: the page is our own
 * dist plus the shipped client bundles, and the shims must hand real
 * Response/WebSocket-shaped objects to the client without a contextBridge
 * serialization boundary.
 */
const { ipcRenderer } = require('electron');

const RealWebSocket = window.WebSocket;
let fetchSeq = 0;
let wsSeq = 0;

function abortError() {
	return new DOMException('This operation was aborted', 'AbortError');
}

// ---------------------------------------------------------------------------
// fetch shim: unary RPC, generic channels, HEAD probes — everything upstream.
// Long-lived bodies stream as chunk frames after a ready handshake.
// ---------------------------------------------------------------------------
function streamedResponse(reqId, status, headers) {
	let queue = [];
	let wake = null;
	let ended = false;
	const onChunk = (_event, payload) => {
		if (payload.reqId !== reqId) return;
		queue.push(new Uint8Array(payload.chunk));
		if (wake !== null) {
			wake();
			wake = null;
		}
	};
	const onEnd = (_event, payload) => {
		if (payload.reqId !== reqId) return;
		ended = true;
		if (wake !== null) {
			wake();
			wake = null;
		}
		ipcRenderer.removeListener('dsh:fetch-chunk', onChunk);
		ipcRenderer.removeListener('dsh:fetch-end', onEnd);
	};
	ipcRenderer.on('dsh:fetch-chunk', onChunk);
	ipcRenderer.on('dsh:fetch-end', onEnd);
	ipcRenderer.send('dsh:fetch-stream-ready', { reqId });
	const stream = new ReadableStream({
		async pull(controller) {
			while (queue.length > 0) controller.enqueue(queue.shift());
			if (ended) {
				controller.close();
				return;
			}
			await new Promise((resolve) => {
				wake = resolve;
			});
			while (queue.length > 0) controller.enqueue(queue.shift());
			if (ended) controller.close();
		},
		cancel() {
			ended = true;
			ipcRenderer.send('dsh:fetch-abort', { reqId });
			ipcRenderer.removeListener('dsh:fetch-chunk', onChunk);
			ipcRenderer.removeListener('dsh:fetch-end', onEnd);
		},
	});
	return new Response(stream, { status, headers });
}

// The carrier serves only app://localhost in-process; every other URL must go
// through the real browser fetch (plugin stores, CDNs, docs…). Capture the
// native fetch before the shim replaces it.
const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined;

function ipcFetch(input, init) {
	const req = new Request(input, init);
	let url;
	try {
		url = new URL(req.url);
	} catch {
		url = null;
	}
	if (url !== null && url.origin !== 'app://localhost') {
		if (nativeFetch === undefined) return Promise.reject(new Error('fetch unavailable'));
		return nativeFetch(input, init);
	}
	const reqId = ++fetchSeq;
	const signal = init && init.signal ? init.signal : undefined;

	return new Promise((resolve, reject) => {
		if (signal !== undefined && signal.aborted) {
			reject(abortError());
			return;
		}
		const onAbort = () => {
			ipcRenderer.send('dsh:fetch-abort', { reqId });
			reject(abortError());
		};
		if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true });

		Promise.resolve()
			.then(async () => {
				let body = null;
				if (req.body !== null) {
					const buffer = await req.arrayBuffer();
					if (buffer.byteLength > 0) body = buffer;
				}
				const headers = {};
				for (const [key, value] of req.headers) headers[key] = value;
				return ipcRenderer.invoke('dsh:fetch', { reqId, url: req.url, method: req.method, headers, body });
			})
			.then((result) => {
				if (result === undefined || result.ok !== true) {
					reject(new Error(`desktop carrier rejected fetch: ${result && result.reason ? result.reason : 'no response'}`));
					return;
				}
				if (result.stream === true) {
					resolve(streamedResponse(reqId, result.status ?? 200, result.headers ?? {}));
					return;
				}
				resolve(new Response(
					result.body === null || result.body === undefined ? null : new Uint8Array(result.body),
					{ status: result.status ?? 200, headers: result.headers ?? {} },
				));
			})
			.catch((error) => reject(error))
			.finally(() => {
				if (signal !== undefined) signal.removeEventListener('abort', onAbort);
			});
	});
}

// ---------------------------------------------------------------------------
// WebSocket shim: the two downlink streams; anything else proxies a real
// WebSocket so future client features keep working.
// ---------------------------------------------------------------------------
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

class IpcWebSocket extends EventTarget {
	constructor(url, protocols) {
		super();
		this.url = String(url);
		this.binaryType = 'blob';
		this.bufferedAmount = 0;
		this.extensions = '';
		this.protocol = '';
		this._readyState = WS_CONNECTING;
		this._real = null;
		this._streamId = null;
		this._offFrame = null;
		this._closed = false;

		let pathname = '';
		try {
			pathname = new URL(this.url).pathname;
		} catch {
			/* proxy below */
		}
		if (pathname === '/api/events.mux' || pathname === '/api/events.host') {
			this._openIpc(pathname);
		} else {
			this._proxyReal(url, protocols);
		}
	}

	get readyState() {
		return this._readyState;
	}

	send() {
		// Downlink-only protocol: the shipped client never sends frames.
		if (this._real !== null) this._real.send(...arguments);
	}

	close(code, reason) {
		if (this._readyState === WS_CLOSED) return;
		this._closed = true;
		this._readyState = WS_CLOSED;
		if (this._streamId !== null) {
			ipcRenderer.send('dsh:ws-close', { streamId: this._streamId });
			this._detachFrame();
		}
		if (this._real !== null) this._real.close(code, reason);
		this.dispatchEvent(new Event('close'));
	}

	async _openIpc(pathname) {
		this._streamId = ++wsSeq;
		const streamId = this._streamId;
		const onFrame = (_event, payload) => {
			if (payload.streamId !== streamId) return;
			if (this._readyState !== WS_OPEN) return;
			this.dispatchEvent(new MessageEvent('message', { data: payload.frame }));
		};
		try {
			const result = await ipcRenderer.invoke('dsh:ws-open', { streamId, path: pathname });
			if (this._closed || this._readyState === WS_CLOSED) {
				ipcRenderer.send('dsh:ws-close', { streamId });
				return;
			}
			if (result === undefined || result.ok !== true) {
				this._readyState = WS_CLOSED;
				this.dispatchEvent(new Event('error'));
				return;
			}
			ipcRenderer.on('dsh:ws-frame', onFrame);
			this._offFrame = () => ipcRenderer.removeListener('dsh:ws-frame', onFrame);
			this._readyState = WS_OPEN;
			this.dispatchEvent(new Event('open'));
		} catch {
			if (this._readyState !== WS_CLOSED) {
				this._readyState = WS_CLOSED;
				this.dispatchEvent(new Event('error'));
			}
		}
	}

	_detachFrame() {
		if (this._offFrame !== null) {
			this._offFrame();
			this._offFrame = null;
		}
	}

	_proxyReal(url, protocols) {
		try {
			const real = new RealWebSocket(url, protocols);
			this._real = real;
			real.addEventListener('open', () => {
				this._readyState = WS_OPEN;
				this.dispatchEvent(new Event('open'));
			});
			real.addEventListener('message', (event) => {
				this.dispatchEvent(new MessageEvent('message', { data: event.data }));
			});
			real.addEventListener('close', (event) => {
				if (this._readyState !== WS_CLOSED) this.dispatchEvent(new Event('close'));
				this._readyState = WS_CLOSED;
			});
			real.addEventListener('error', () => {
				this.dispatchEvent(new Event('error'));
			});
		} catch {
			this._readyState = WS_CLOSED;
			queueMicrotask(() => this.dispatchEvent(new Event('error')));
		}
	}
}

IpcWebSocket.CONNECTING = WS_CONNECTING;
IpcWebSocket.OPEN = WS_OPEN;
IpcWebSocket.CLOSING = WS_CLOSING;
IpcWebSocket.CLOSED = WS_CLOSED;

// Install the shims before any page script runs.
window.fetch = ipcFetch;
window.WebSocket = IpcWebSocket;
window.__DSH_DESKTOP__ = true;

// ---------------------------------------------------------------------------
// dshDesktop bridge: small capability surface for page plugins (main world —
// direct assignment, no contextBridge needed).
// ---------------------------------------------------------------------------
window.dshDesktop = {
	appVersion: '',
	windowControls: {
		minimize: () => ipcRenderer.invoke('dsh:chrome-window', { action: 'minimize' }),
		toggleMaximize: () => ipcRenderer.invoke('dsh:chrome-window', { action: 'toggle-maximize' }),
		close: () => ipcRenderer.invoke('dsh:chrome-window', { action: 'close' }),
		isMaximized: () => ipcRenderer.invoke('dsh:chrome-window', { action: 'is-maximized' }),
	},
	menu: {
		action: (action, payload) => ipcRenderer.invoke('dsh:chrome-menu', { action, ...(payload ?? {}) }),
	},
	openExternal: (url) => ipcRenderer.invoke('dsh:open-external', { url }),
	marketplace: {
		search: (query, type, sort) => ipcRenderer.invoke('dsh:marketplace-search', { query, type, sort }),
		install: (source) => ipcRenderer.invoke('dsh:marketplace-install', { source }),
		installCancel: () => ipcRenderer.invoke('dsh:marketplace-install-cancel', {}),
		uninstall: (pkg) => ipcRenderer.invoke('dsh:marketplace-uninstall', { pkg }),
		verifyNpm: (name) => ipcRenderer.invoke('dsh:marketplace-verify-npm', { name }),
		installed: () => ipcRenderer.invoke('dsh:marketplace-installed', {}),
		resolve: (fullName, defaultBranch) => ipcRenderer.invoke('dsh:marketplace-resolve-package', { fullName, defaultBranch }),
		detail: (fullName, defaultBranch, type, topics) => ipcRenderer.invoke('dsh:marketplace-detail', { fullName, defaultBranch, type, topics }),
	},
	fileChanges: {
		get: (sessionId) => ipcRenderer.invoke('dsh:file-changes-get', { sessionId }),
		revert: (sessionId, opId) => ipcRenderer.invoke('dsh:file-revert', { sessionId, opId }),
		revertAll: (sessionId) => ipcRenderer.invoke('dsh:file-revert-all', { sessionId }),
	},
};

// Balance pushes from the host plugin → window event for the client widget.
ipcRenderer.on('dsh:balance', (_event, data) => {
	try {
		window.dispatchEvent(new CustomEvent('dsh-balance-changed', { detail: data }));
	} catch {
		/* best effort */
	}
});

// File-change pushes from the host plugin → window event for the client panel.
ipcRenderer.on('dsh:file-changes', (_event, data) => {
	try {
		window.dispatchEvent(new CustomEvent('dsh-file-changes-changed', { detail: data }));
	} catch {
		/* best effort */
	}
});

// Marketplace install output pushes → window event for the progress panel.
ipcRenderer.on('dsh:marketplace-install-progress', (_event, data) => {
	try {
		window.dispatchEvent(new CustomEvent('dsh-marketplace-install-progress', { detail: data }));
	} catch {
		/* best effort */
	}
});

// ---------------------------------------------------------------------------
// Custom window chrome: frameless glass title bar (36px) injected into the
// page, themed by the DSH UI's own CSS variables.
// ---------------------------------------------------------------------------
const CHROME_BAR_ID = '__dsh_desktop_chrome__';
const CHROME_BAR_HEIGHT = 36;
const CHROME_CSS = `
#${CHROME_BAR_ID}{position:fixed;top:0;left:0;right:0;height:${CHROME_BAR_HEIGHT}px;z-index:2147483000;
  display:flex;align-items:center;justify-content:space-between;padding:0 6px 0 10px;
  -webkit-app-region:drag;user-select:none;box-sizing:border-box;
  font-family:var(--dsw-font-family,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);
  background:color-mix(in srgb,var(--dsw-alias-bg-base,#0b1220) 74%,transparent);
  backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);
  border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,rgba(255,255,255,.09)) 55%,transparent)}
#${CHROME_BAR_ID} .dch-left{display:flex;align-items:center;gap:8px;min-width:0;-webkit-app-region:drag}
#${CHROME_BAR_ID} .dch-icon{width:20px;height:20px;border-radius:6px;display:block;flex:none;-webkit-app-region:drag}
#${CHROME_BAR_ID} .dch-title{font-size:12.5px;font-weight:600;letter-spacing:.2px;line-height:16px;
  color:var(--dsw-alias-label-primary,#e6ecff);white-space:nowrap;-webkit-app-region:drag}
#${CHROME_BAR_ID} .dch-badge{font-size:10px;line-height:14px;padding:1px 6px;border-radius:999px;
  color:var(--dsw-alias-label-tertiary,#93a5d8);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.09));
  white-space:nowrap;-webkit-app-region:drag;font-family:var(--ds-font-family-code,Consolas,monospace)}
#${CHROME_BAR_ID} .dch-right{display:flex;align-items:center;gap:2px;-webkit-app-region:no-drag}
#${CHROME_BAR_ID} .dch-btn{width:30px;height:28px;display:grid;place-items:center;border:none;border-radius:8px;
  background:transparent;color:var(--dsw-alias-label-secondary,#b8c5ea);cursor:pointer;padding:0;font-size:13px;line-height:1;
  -webkit-app-region:no-drag;outline:none;transition:background .12s,color .12s}
#${CHROME_BAR_ID} .dch-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.09));
  color:var(--dsw-alias-label-primary,#eef2ff)}
#${CHROME_BAR_ID} .dch-close:hover{background:#e81123;color:#fff}
#${CHROME_BAR_ID} .dch-menu{position:fixed;top:${CHROME_BAR_HEIGHT + 8}px;right:8px;width:248px;z-index:2147483001;
  -webkit-app-region:no-drag;box-sizing:border-box;padding:6px;display:none;
  background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,var(--dsw-alias-bg-base,#0b1220) 92%,white));
  border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));border-radius:12px;
  box-shadow:0 12px 40px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.35);
  backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5);
  color:var(--dsw-alias-label-primary,#e6ecff);font-family:var(--dsw-font-family,"Segoe UI","Microsoft YaHei",system-ui,sans-serif)}
#${CHROME_BAR_ID} .dch-menu.open{display:block}
#${CHROME_BAR_ID} .dch-mi{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;font-size:12.5px;
  cursor:pointer;color:var(--dsw-alias-label-primary,#e6ecff)}
#${CHROME_BAR_ID} .dch-mi:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.09))}
#${CHROME_BAR_ID} .dch-up{font-size:10.5px;line-height:15px;padding:1px 8px;border-radius:999px;flex:none;
  color:var(--dsw-alias-label-secondary,#b8c5ea);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.09));
  white-space:nowrap;display:inline-flex;align-items:center;-webkit-app-region:drag;
  font-variant-numeric:tabular-nums}
#${CHROME_BAR_ID} .dch-upbar{position:absolute;left:0;bottom:0;height:2px;width:0;pointer-events:none;
  background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover-solid,#5b7cfa) 90%,transparent);
  transition:width .25s ease}
`;

function installChrome() {
	if (document.getElementById(CHROME_BAR_ID) !== null) return;
	const style = document.createElement('style');
	style.textContent = CHROME_CSS;
	(document.head ?? document.documentElement).appendChild(style);

	// Push the app body below the bar; the shell keeps its 100% height.
	const layout = document.createElement('style');
	layout.textContent = `html,body{height:100%}body{margin:0;padding-top:${CHROME_BAR_HEIGHT}px !important;box-sizing:border-box}`;
	(document.head ?? document.documentElement).appendChild(layout);

	const bar = document.createElement('div');
	bar.id = CHROME_BAR_ID;
	bar.innerHTML = `
		<div class="dch-left">
			<img class="dch-icon" src="/favicon.svg" alt="">
			<span class="dch-title">DeepSeek Harness</span>
			<span class="dch-badge" id="${CHROME_BAR_ID}-badge"></span>
			<span class="dch-up" id="${CHROME_BAR_ID}-up" hidden></span>
		</div>
		<div class="dch-right">
			<button class="dch-btn" id="${CHROME_BAR_ID}-menu" title="菜单">⋯</button>
			<button class="dch-btn" id="${CHROME_BAR_ID}-min" title="最小化">─</button>
			<button class="dch-btn" id="${CHROME_BAR_ID}-max" title="最大化/还原">□</button>
			<button class="dch-btn dch-close" id="${CHROME_BAR_ID}-close" title="关闭（隐藏到托盘）">✕</button>
		</div>
		<div class="dch-menu" id="${CHROME_BAR_ID}-menu-panel">
			<div class="dch-mi" data-act="marketplace">插件市场</div>
			<div class="dch-mi" data-act="check-updates">检查应用更新</div>
			<div class="dch-mi" data-act="check-dsh-update">更新 dsh（官方版）</div>
			<div class="dch-mi" data-act="rollback-dsh">回退 dsh 到内置版</div>
			<div class="dch-mi" data-act="about">关于</div>
			<div class="dch-mi" data-act="quit">退出</div>
		</div>
		<div class="dch-upbar" id="${CHROME_BAR_ID}-upbar"></div>`;
	document.body.appendChild(bar);

	const byId = (id) => document.getElementById(`${CHROME_BAR_ID}-${id}`);
	const menuPanel = byId('menu-panel');
	const closeMenu = () => menuPanel.classList.remove('open');
	byId('menu').addEventListener('click', (event) => {
		event.stopPropagation();
		menuPanel.classList.toggle('open');
	});
	byId('min').addEventListener('click', () => void window.dshDesktop.windowControls.minimize());
	byId('max').addEventListener('click', () => void window.dshDesktop.windowControls.toggleMaximize());
	byId('close').addEventListener('click', () => void window.dshDesktop.windowControls.close());
	menuPanel.addEventListener('click', (event) => {
		const item = event.target.closest('.dch-mi');
		if (item === null) return;
		closeMenu();
		if (item.dataset.act === 'marketplace') {
			window.dispatchEvent(new CustomEvent('dsh-marketplace-open'));
			return;
		}
		void window.dshDesktop.menu.action(item.dataset.act);
	});
	window.addEventListener('click', closeMenu);

	// Version badge + maximize glyph.
	void ipcRenderer.invoke('dsh:chrome-init').then((info) => {
		if (info !== null && info !== undefined) {
			const badge = byId('badge');
			if (badge !== null) badge.textContent = `v${info.appVersion}`;
			window.dshDesktop.appVersion = info.appVersion;
		}
	});
	ipcRenderer.on('dsh:chrome-maximized', (_event, isMax) => {
		const max = byId('max');
		if (max !== null) max.textContent = isMax ? '❐' : '□';
	});

	// Update progress: pill in the bar + a 2px progress line along its bottom
	// edge. Downloading/ready persist; transient states auto-hide.
	ipcRenderer.on('dsh:update-progress', (_event, data) => {
		const up = byId('up');
		const upbar = byId('upbar');
		if (up === null || upbar === null) return;
		const phase = data && data.phase ? data.phase : '';
		const version = data && data.version ? ' v' + data.version : '';
		const percent = typeof data.percent === 'number' ? data.percent : 0;
		const persist = phase === 'downloading' || phase === 'ready';
		let text = '';
		if (phase === 'checking') text = '正在检查更新…';
		else if (phase === 'downloading') text = '下载更新' + version + ' ' + percent + '%';
		else if (phase === 'ready') text = '更新' + version + '已就绪，退出时安装';
		else if (phase === 'uptodate') text = '已是最新版本';
		else if (phase === 'error') text = '更新检查失败';
		else {
			up.hidden = true;
			upbar.style.width = '0%';
			return;
		}
		up.textContent = text;
		up.hidden = false;
		upbar.style.width = phase === 'downloading' ? percent + '%' : phase === 'ready' ? '100%' : '0%';
		clearTimeout(installChrome.upTimer);
		if (!persist) installChrome.upTimer = setTimeout(() => { up.hidden = true; }, 6000);
	});
}

function ready(fn) {
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
	else fn();
}

ready(installChrome);
