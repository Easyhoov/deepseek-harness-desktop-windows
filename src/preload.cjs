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

function ipcFetch(input, init) {
	const req = new Request(input, init);
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
