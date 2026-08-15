/**
 * WebSocket wire codec + mock duplex for the desktop carrier's generic
 * WebSocket-over-IPC bridge.
 *
 * The renderer's WebSocket shim deals in MESSAGES (the browser API surface),
 * while the in-process `ws` WebSocketServer (which plugins such as
 * dsh-better-sidebar use for their terminals) deals in the RFC 6455 byte
 * stream. This module bridges the two without ever opening a socket:
 *
 * - `encodeClientFrame(payload, opcode)` wraps a message payload in a MASKED
 *   client→server frame — RFC 6455 requires clients to mask, and `ws`'s
 *   receiver rejects unmasked client frames.
 * - `ServerFrameDecoder` is an incremental parser for server→client frames
 *   (unmasked; text/binary/close/ping/pong; 7/16/64-bit lengths and
 *   continuation fragmentation).
 * - `createMockSocket({ onWrite })` is the EventEmitter-based Duplex stand-in
 *   that `ws`'s handleUpgrade/WebSocket machinery drives. Written bytes flow
 *   to `onWrite` (the bridge decodes them into renderer messages); renderer
 *   frames are fed back with `socket.emit('data', frame)`.
 *
 * @module dsh-desktop/ws-ipc
 */
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

// Opcodes (RFC 6455 §5.2).
export const OP_TEXT = 0x1;
export const OP_BINARY = 0x2;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

/** Marker string the ws handshake response ends with (headers terminator). */
export const HANDSHAKE_TERMINATOR = '\r\n\r\n';

/**
 * Wrap one message payload in a masked client→server frame.
 * @param {string | Uint8Array} payload - message bytes.
 * @param {number} [opcode] - OP_TEXT / OP_BINARY / OP_CLOSE / OP_PING / OP_PONG.
 * @returns {Buffer} the complete frame (FIN set, mask set, random 4-byte mask).
 */
export function encodeClientFrame(payload, opcode = OP_TEXT) {
	const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
	const len = data.length;
	let header;
	if (len < 126) {
		header = Buffer.alloc(2);
		header[1] = 0x80 | len;
	} else if (len < 65536) {
		header = Buffer.alloc(4);
		header[1] = 0x80 | 126;
		header.writeUInt16BE(len, 2);
	} else {
		header = Buffer.alloc(10);
		header[1] = 0x80 | 127;
		header.writeBigUInt64BE(BigInt(len), 2);
	}
	header[0] = 0x80 | opcode; // FIN + opcode
	const mask = randomBytes(4);
	const masked = Buffer.allocUnsafe(len);
	for (let i = 0; i < len; i += 1) masked[i] = data[i] ^ mask[i & 3];
	return Buffer.concat([header, mask, masked]);
}

/**
 * Incremental parser for the server→client byte stream. `ws`'s Sender emits
 * unmasked frames (possibly split across several socket.write calls for
 * fragmented messages); push raw bytes and collect decoded events:
 *
 * - { type: 'message', opcode, data: Buffer } — a complete data message
 *   (continuation fragments are reassembled before this is emitted);
 * - { type: 'close', code, reason } — close frame;
 * - { type: 'ping', data: Buffer } / { type: 'pong', data: Buffer }.
 */
export class ServerFrameDecoder {
	constructor() {
		this.buffer = Buffer.alloc(0);
		this.fragments = [];
		this.fragmentOpcode = 0;
	}

	/**
	 * Append raw bytes to the input buffer. Decoding happens in
	 * {@link drain} (call it after every push — the handshake skip must run
	 * between the two, so push deliberately does NOT decode itself).
	 * @param {Uint8Array} chunk
	 */
	push(chunk) {
		this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
	}

	/** Decode whatever is buffered right now (after a handshake skip, etc.). */
	drain() {
		const events = [];
		for (;;) {
			const frame = this.tryParse();
			if (frame === null) break;
			this.handleFrame(frame, events);
		}
		return events;
	}

	/** Try to parse one complete frame off the buffer head; null = need more. */
	tryParse() {
		const buf = this.buffer;
		if (buf.length < 2) return null;
		const b0 = buf[0];
		const b1 = buf[1];
		const fin = (b0 & 0x80) !== 0;
		const opcode = b0 & 0x0f;
		const masked = (b1 & 0x80) !== 0;
		let len = b1 & 0x7f;
		let offset = 2;
		if (len === 126) {
			if (buf.length < offset + 2) return null;
			len = buf.readUInt16BE(offset);
			offset += 2;
		} else if (len === 127) {
			if (buf.length < offset + 8) return null;
			const big = buf.readBigUInt64BE(offset);
			offset += 8;
			if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
				// Absurd frame: drop the connection instead of OOM'ing.
				this.buffer = Buffer.alloc(0);
				throw new Error('ws-ipc: frame length exceeds safe integer');
			}
			len = Number(big);
		}
		let maskKey = null;
		if (masked) {
			if (buf.length < offset + 4) return null;
			maskKey = buf.subarray(offset, offset + 4);
			offset += 4;
		}
		if (buf.length < offset + len) return null;
		let payload = buf.subarray(offset, offset + len);
		if (maskKey !== null) {
			const unmasked = Buffer.allocUnsafe(len);
			for (let i = 0; i < len; i += 1) unmasked[i] = payload[i] ^ maskKey[i & 3];
			payload = unmasked;
		}
		this.buffer = buf.subarray(offset + len);
		return { fin, opcode, payload };
	}

	handleFrame(frame, events) {
		const { fin, opcode, payload } = frame;
		if (opcode === OP_CLOSE) {
			let code = 1005;
			let reason = '';
			if (payload.length >= 2) {
				code = payload.readUInt16BE(0);
				reason = payload.subarray(2).toString('utf8');
			}
			events.push({ type: 'close', code, reason });
			return;
		}
		if (opcode === OP_PING || opcode === OP_PONG) {
			events.push({ type: opcode === OP_PING ? 'ping' : 'pong', data: Buffer.from(payload) });
			return;
		}
		// Data frames (text/binary) + continuation.
		if (opcode === 0x0) {
			if (this.fragments.length === 0) return; // stray continuation: ignore
			this.fragments.push(Buffer.from(payload));
			if (fin) {
				events.push({ type: 'message', opcode: this.fragmentOpcode, data: Buffer.concat(this.fragments) });
				this.fragments = [];
				this.fragmentOpcode = 0;
			}
			return;
		}
		if (opcode === OP_TEXT || opcode === OP_BINARY) {
			if (!fin) {
				this.fragments = [Buffer.from(payload)];
				this.fragmentOpcode = opcode;
				return;
			}
			events.push({ type: 'message', opcode, data: Buffer.from(payload) });
		}
		// Unknown opcodes (0x3–0x7, 0xB–0xF): reserved, drop.
	}

	/** Discard everything up to and including the HTTP handshake terminator.
	 *  Returns true when the handshake bytes were consumed (any remainder is
	 *  treated as frame bytes). Used to skip the ws server's 101 response. */
	consumeHandshake() {
		const marker = Buffer.from(HANDSHAKE_TERMINATOR, 'ascii');
		const at = this.buffer.indexOf(marker);
		if (at === -1) return false;
		this.buffer = this.buffer.subarray(at + marker.length);
		return true;
	}
}

/**
 * The EventEmitter-based Duplex stand-in `ws` drives during an upgrade.
 *
 * Satisfies the exact contract the installed ws version uses (verified
 * against ws 8.21): on/once/off/removeListener + 'data'/'end'/'close'/
 * 'error'/'finish' events, write/end/destroy/pause/resume/cork/uncork/
 * unshift/setTimeout/setNoDelay/setKeepAlive, and readable/writable/
 * destroyed flags.
 *
 * Renderer→main frames are fed with `socket.emit('data', buffer)`; every
 * byte the ws machinery writes lands in the `onWrite(buffer)` callback.
 */
export function createMockSocket({ onWrite } = {}) {
	const socket = new EventEmitter();
	socket.readable = true;
	socket.writable = true;
	socket.writableEnded = false;
	socket.writableFinished = false;
	socket.destroyed = false;
	socket.allowHalfOpen = true;
	socket.remoteAddress = '127.0.0.1';
	socket.remotePort = 0;
	socket.localAddress = '127.0.0.1';
	socket.localPort = 0;
	socket._unshifted = [];
	// ws's socketOnClose inspects the readable state to flush buffered data
	// before ending the receiver; the mock has no stream machinery, so
	// report "nothing buffered, end already emitted".
	socket._readableState = { endEmitted: true, length: 0 };
	socket.read = () => null;
	// ws's `bufferedAmount` getter (websocket.js) reads
	// `socket._writableState.length`; the mock never buffers, so report 0.
	socket._writableState = { length: 0 };

	socket.write = (chunk, encoding, callback) => {
		if (typeof encoding === 'function') {
			callback = encoding;
			encoding = undefined;
		}
		const buffer = Buffer.isBuffer(chunk)
			? chunk
			: Buffer.from(chunk, encoding);
		if (buffer.length > 0) onWrite?.(buffer);
		if (typeof callback === 'function') queueMicrotask(callback);
		return true;
	};

	socket.end = (chunk, encoding, callback) => {
		if (typeof chunk === 'function') {
			callback = chunk;
			chunk = undefined;
		} else if (typeof encoding === 'function') {
			callback = encoding;
			encoding = undefined;
		}
		if (chunk !== undefined && chunk !== null && chunk.length !== 0) {
			socket.write(chunk, encoding);
		}
		if (socket.writableEnded) return socket;
		socket.writableEnded = true;
		socket.writableFinished = true;
		socket.writable = false;
		queueMicrotask(() => {
			socket.emit('finish');
			socket.emit('end');
			socket.emit('close');
		});
		return socket;
	};

	socket.destroy = (error) => {
		if (socket.destroyed) return socket;
		socket.destroyed = true;
		socket.readable = false;
		socket.writable = false;
		if (error !== undefined && error !== null) {
			queueMicrotask(() => socket.emit('error', error));
		}
		queueMicrotask(() => socket.emit('close'));
		return socket;
	};

	socket.pause = () => socket;
	socket.resume = () => socket;
	socket.setTimeout = () => socket;
	socket.setNoDelay = () => socket;
	socket.setKeepAlive = () => socket;
	socket.setEncoding = () => socket;
	socket.cork = () => {};
	socket.uncork = () => {};

	socket.unshift = (chunk) => {
		socket._unshifted.push(Buffer.from(chunk));
	};

	socket.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: 0 });

	/** Feed a frame (already encoded) into the socket as if the renderer sent it. */
	socket.feed = (buffer) => {
		let data = buffer;
		if (socket._unshifted.length > 0) {
			data = Buffer.concat([...socket._unshifted, buffer]);
			socket._unshifted = [];
		}
		if (!socket.destroyed) socket.emit('data', data);
	};

	return socket;
}
