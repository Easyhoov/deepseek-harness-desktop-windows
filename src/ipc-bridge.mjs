/**
 * The Electron IPC carrier: renderer fetch/WebSocket traffic becomes
 * in-process route dispatches against the in-process webServer stub.
 *
 * Upstream:  renderer fetch  → ipcRenderer.invoke('dsh:fetch') → mock
 *            node:http req/res → webServer route handlers (the shipped
 *            connection bridge, plugin routes, the SPA fallback) → buffered
 *            response back over IPC.
 * Downlink:  WebSocket shim   → 'dsh:ws-open'/'dsh:ws-close' → direct
 *            apiProxy.events.mux/host pumps → 'dsh:ws-frame' messages.
 *
 * The trust model: only the app window's webContents may call these
 * channels, and every mock request carries Host: 127.0.0.1 so the shipped
 * browser-trust fence treats the desktop renderer as the loopback caller it
 * logically is (there is no network attacker surface: the carrier IS the
 * renderer boundary).
 *
 * @module dsh-desktop/ipc-bridge
 */
import { randomUUID } from 'node:crypto';

const MUX_EVENTS_PATH = '/api/events.mux';
const HOST_EVENTS_PATH = '/api/events.host';

/** Wire shapes mirrored from @deepseek-ai/dsh-client-connection's node half. */
function serverRequest(frame) {
	return {
		type: 'server-request',
		rpcId: frame.rpcId,
		method: frame.payload.type,
		payload: frame.payload,
	};
}

function failureFrame(error) {
	return {
		rpcId: randomUUID(),
		payload: {
			type: 'stream/error',
			error: { code: 'internal', message: String(error), details: {} },
		},
	};
}

/** Minimal IncomingMessage stand-in for the bridge inside route handlers. */
function createMockRequest({ url, method, headers, body }) {
	let destroyed = false;
	return {
		method,
		url,
		headers: { ...headers, host: '127.0.0.1' },
		destroyed,
		destroy() {
			destroyed = true;
			this.destroyed = true;
		},
		async *[Symbol.asyncIterator]() {
			if (body === undefined || body === null || body.byteLength === 0) return;
			yield Buffer.from(body);
		},
	};
}

/**
 * Minimal ServerResponse stand-in: writeHead/write/end plus close/drain
 * events. Optional callbacks turn writes/ends/headers into carrier events
 * for the chunked response protocol.
 */
function createMockResponse({ onChunk, onEnd, onHeaders } = {}) {
	const listeners = new Map();
	const res = {
		statusCode: 200,
		headersSent: false,
		writableEnded: false,
		destroyed: false,
		_chunks: [],
		_headers: {},
		writeHead(status, headers) {
			res.statusCode = status;
			Object.assign(res._headers, headers ?? {});
			res.headersSent = true;
			onHeaders?.();
			return res;
		},
		write(chunk) {
			const buffer = chunk === undefined ? undefined : Buffer.from(chunk);
			if (buffer !== undefined) {
				res._chunks.push(buffer);
				onChunk?.(buffer);
			}
			// Always true: the IPC carrier buffers, backpressure has no socket.
			return true;
		},
		end(chunk) {
			if (chunk !== undefined) {
				res._chunks.push(Buffer.from(chunk));
				onChunk?.(Buffer.from(chunk));
			}
			if (res.writableEnded) return;
			res.writableEnded = true;
			onEnd?.();
		},
		on(event, fn) {
			if (!listeners.has(event)) listeners.set(event, new Set());
			listeners.get(event).add(fn);
			return res;
		},
		once(event, fn) {
			const wrapped = (...args) => {
				res.off(event, wrapped);
				fn(...args);
			};
			return res.on(event, wrapped);
		},
		off(event, fn) {
			listeners.get(event)?.delete(fn);
			return res;
		},
		_emit(event, ...args) {
			const set = listeners.get(event);
			if (set === undefined) return;
			for (const fn of [...set]) fn(...args);
		},
		destroy() {
			if (res.writableEnded || res.destroyed) return;
			res.destroyed = true;
			res._emit('close');
			onEnd?.();
		},
	};
	return res;
}

/**
 * Install the carrier. @param getWindow returns the trusted BrowserWindow
 * (may be undefined before the window exists — handlers reject then).
 * @param logLine - optional line logger for packaged runs (console is detached).
 */
export function installIpcBridge({ ctx, webServer, getWindow, ipcMain, logLine }) {
	const apiProxy = ctx.get('apiProxy');
	const pendingFetches = new Map();
	const wsPumps = new Map(); // webContents.id -> Map(streamId -> AbortController)
	let fetchCount = 0;

	function isTrustedSender(event) {
		const win = getWindow();
		return win !== undefined && !win.isDestroyed() && event.sender.id === win.webContents.id;
	}

	function traceFetch(url, method) {
		if (fetchCount >= 8) return;
		fetchCount += 1;
		console.log(`[dsh-desktop] ipc fetch #${fetchCount}: ${method} ${url}`);
		logLine?.(`ipc fetch #${fetchCount}: ${method} ${url}`);
	}

	function routeFor(url) {
		const rawPath = new URL(url, 'http://dsh.internal').pathname;
		return webServer.match(rawPath) ?? webServer.fallbackHandler();
	}

	// ---- upstream: fetch over IPC -----------------------------------------
	// Chunked protocol: the invoke reply carries status + headers (plus the
	// whole body when the response already ended); long-lived bodies stream
	// as 'dsh:fetch-chunk' frames after the renderer acknowledges with
	// 'dsh:fetch-stream-ready', which prevents any frame loss between the
	// invoke resolution and the renderer attaching its listeners.
	const onFetch = async (event, payload) => {
		if (!isTrustedSender(event)) return { ok: false, reason: 'untrusted sender' };
		const { reqId, url, method, headers, body } = payload;
		if (typeof url !== 'string' || typeof method !== 'string') {
			return { ok: false, reason: 'bad request shape' };
		}
		traceFetch(url, method);
		const send = (channel, data) => {
			if (!event.sender.isDestroyed()) event.sender.send(channel, data);
		};
		const stream = { state: 'buffering', ended: false };
		let resolveReply;
		const reply = new Promise((resolve) => {
			resolveReply = resolve;
		});
		const settle = (value) => {
			if (resolveReply !== undefined) {
				resolveReply(value);
				resolveReply = undefined;
			}
		};
		const res = createMockResponse({
			onHeaders() {
				// Prefer the inline reply for ordinary responses (the body lands
				// within the same tick); the delayed settle only wins for genuinely
				// long-lived streams, which is exactly when chunking pays off.
				setTimeout(() => {
					settle({ ok: true, stream: true, status: res.statusCode, headers: res._headers });
				}, 10);
			},
			onChunk(chunk) {
				if (stream.state === 'streaming') {
					send('dsh:fetch-chunk', { reqId, chunk });
				} else {
					stream.buffered.push(chunk);
				}
			},
			onEnd() {
				if (stream.ended) return;
				stream.ended = true;
				if (stream.state === 'streaming') {
					send('dsh:fetch-end', { reqId });
					pendingFetches.delete(reqId);
				}
			},
		});
		stream.buffered = [];
		const req = createMockRequest({
			url,
			method,
			headers: headers ?? {},
			body: body ?? null,
		});
		pendingFetches.set(reqId, { req, res, stream });
		const dispatch = (async () => {
			try {
				const route = routeFor(url);
				if (route === undefined) {
					res.writeHead(404);
					res.end();
				} else {
					await route.handler(req, res);
				}
			} catch (error) {
				if (!res.headersSent) {
					res.writeHead(500);
					res.end(`handler failure: ${String(error)}`);
				} else if (!res.writableEnded) {
					res.end();
				}
			}
			if (res.writableEnded && resolveReply !== undefined) {
				// The whole response finished before any reply went out: send it
				// inline (the streaming settle timer, if armed, becomes a no-op).
				pendingFetches.delete(reqId);
				settle({
					ok: true,
					status: res.statusCode,
					headers: res._headers,
					body: res._chunks.length > 0 ? Buffer.concat(res._chunks) : null,
				});
			}
		})();
		return reply;
	};

	const onFetchStreamReady = (event, { reqId }) => {
		if (!isTrustedSender(event)) return;
		const pending = pendingFetches.get(reqId);
		if (pending === undefined || pending.stream.state !== 'buffering') return;
		pending.stream.state = 'streaming';
		for (const chunk of pending.stream.buffered) {
			if (!event.sender.isDestroyed()) event.sender.send('dsh:fetch-chunk', { reqId, chunk });
		}
		pending.stream.buffered = [];
		if (pending.stream.ended) {
			if (!event.sender.isDestroyed()) event.sender.send('dsh:fetch-end', { reqId });
			pendingFetches.delete(reqId);
		}
	};

	const onFetchAbort = (event, { reqId }) => {
		if (!isTrustedSender(event)) return;
		const pending = pendingFetches.get(reqId);
		if (pending === undefined) return;
		pending.res.destroy();
		pending.req.destroy();
	};

	// ---- downlink: event streams over IPC ---------------------------------
	const onWsOpen = async (event, { streamId, path }) => {
		if (!isTrustedSender(event)) return { ok: false, reason: 'untrusted sender' };
		if (apiProxy === undefined) return { ok: false, reason: 'no api gateway' };
		if (path !== MUX_EVENTS_PATH && path !== HOST_EVENTS_PATH) {
			return { ok: false, reason: `unknown stream ${path}` };
		}
		console.log(`[dsh-desktop] ipc ws-open: ${path} (stream ${streamId})`);
		logLine?.(`ipc ws-open: ${path} (stream ${streamId})`);
		let pumps = wsPumps.get(event.sender.id);
		if (pumps === undefined) {
			pumps = new Map();
			wsPumps.set(event.sender.id, pumps);
		}
		if (pumps.has(streamId)) return { ok: false, reason: 'duplicate stream id' };
		const abort = new AbortController();
		pumps.set(streamId, abort);
		const open = path === MUX_EVENTS_PATH
			? (signal) => apiProxy.events.mux({ rpcId: randomUUID(), payload: {} }, signal)
			: (signal) => apiProxy.events.host({ rpcId: randomUUID(), payload: {} }, signal);
		(async () => {
			try {
				for await (const frame of open(abort.signal)) {
					if (event.sender.isDestroyed()) break;
					event.sender.send('dsh:ws-frame', {
						streamId,
						frame: JSON.stringify(serverRequest(frame)),
					});
				}
			} catch (error) {
				if (!abort.signal.aborted) {
					try {
						event.sender.send('dsh:ws-frame', {
							streamId,
							frame: JSON.stringify(failureFrame(error)),
						});
					} catch {}
				}
			} finally {
				pumps.delete(streamId);
			}
		})();
		return { ok: true };
	};

	const onWsClose = (event, { streamId }) => {
		if (!isTrustedSender(event)) return;
		wsPumps.get(event.sender.id)?.get(streamId)?.abort();
	};

	const onSenderGone = (webContentsId) => {
		const pumps = wsPumps.get(webContentsId);
		if (pumps !== undefined) {
			for (const abort of pumps.values()) abort.abort();
			wsPumps.delete(webContentsId);
		}
	};

	const disposers = [];
	ipcMain.handle('dsh:fetch', onFetch);
	ipcMain.on('dsh:fetch-abort', onFetchAbort);
	ipcMain.on('dsh:fetch-stream-ready', onFetchStreamReady);
	ipcMain.handle('dsh:ws-open', onWsOpen);
	ipcMain.on('dsh:ws-close', onWsClose);
	disposers.push(() => {
		ipcMain.removeHandler('dsh:fetch');
		ipcMain.removeListener('dsh:fetch-abort', onFetchAbort);
		ipcMain.removeListener('dsh:fetch-stream-ready', onFetchStreamReady);
		ipcMain.removeHandler('dsh:ws-open');
		ipcMain.removeListener('dsh:ws-close', onWsClose);
		for (const abort of [...wsPumps.values()].flatMap((m) => [...m.values()])) abort.abort();
	});

	return {
		onSenderGone,
		dispose() {
			for (const dispose of disposers) dispose();
		},
		/** Export the session log straight in the main process (used by the
		 * navigation/download interception for /api/session.export). */
		async exportSessionLog(sessionId, includeDescendants, signal) {
			if (apiProxy === undefined) throw new Error('no api gateway');
			const request = {
				sessionId,
				...(includeDescendants === true ? { includeDescendants: true } : {}),
			};
			const response = await apiProxy.downloads.sessionLog(request, signal);
			return Buffer.from(await response.arrayBuffer());
		},
	};
}
