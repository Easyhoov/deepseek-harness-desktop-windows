/**
 * Tests for the desktop carrier's WebSocket-over-IPC bridge building blocks
 * (src/ws-ipc.mjs): the RFC 6455 frame codec is validated BOTH directions
 * against the real `ws` package, and the mock socket is driven through a
 * real `ws` WebSocketServer upgrade (the exact flow ipc-bridge.mjs uses for
 * plugin upgrade routes such as the sidebar terminal).
 *
 * Run: node --test --test-force-exit tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import {
	encodeClientFrame,
	ServerFrameDecoder,
	createMockSocket,
	OP_BINARY,
	OP_CLOSE,
	OP_PONG,
	OP_TEXT,
} from '../src/ws-ipc.mjs';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Wait for a bound WebSocketServer to start listening. */
function listen(wss) {
	if (wss.address() !== null) return Promise.resolve();
	return new Promise((resolve) => wss.once('listening', resolve));
}

/** Close a WebSocketServer, resolving when all clients are gone. */
function closeServer(wss) {
	return new Promise((resolve) => wss.close(() => resolve()));
}

/** Compute the Sec-WebSocket-Accept value for a client key. */
function acceptOf(key) {
	return createHash('sha1').update(key + GUID).digest('base64');
}

/** Perform a raw RFC 6455 handshake over a net socket (client side). */
async function rawHandshake(socket, { path = '/' } = {}) {
	const key = randomBytes(16).toString('base64');
	const writeHead = [
		`GET ${path} HTTP/1.1`,
		'Host: 127.0.0.1',
		'Upgrade: websocket',
		'Connection: Upgrade',
		`Sec-WebSocket-Key: ${key}`,
		'Sec-WebSocket-Version: 13',
		'',
		'',
	].join('\r\n');
	socket.write(writeHead);
	// Read until the end of the HTTP response headers.
	let received = '';
	while (!received.includes('\r\n\r\n')) {
		received += await new Promise((resolve, reject) => {
			socket.once('data', (chunk) => resolve(chunk.toString('binary')));
			socket.once('error', reject);
		});
	}
	assert.ok(received.includes('101 Switching Protocols'), `expected 101, got: ${received.slice(0, 120)}`);
	assert.ok(received.includes(acceptOf(key)), 'Sec-WebSocket-Accept must validate');
	return { key };
}

/** Sleep helper. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Drain a raw net socket into a decoder, collecting events. */
function wireRawSocket(socket, decoder) {
	const events = [];
	socket.on('data', (chunk) => {
		decoder.push(chunk);
		for (const ev of decoder.drain()) events.push(ev);
	});
	return events;
}

test('client frame encoding: real ws server receives masked text/binary frames', { timeout: 20000 }, async () => {
	const wss = new WebSocketServer({ port: 0 });
	await listen(wss);
	const received = [];
	wss.on('connection', (ws) => {
		ws.on('message', (data, isBinary) => received.push({ data, isBinary }));
		ws.send('pong-from-server');
	});
	const bound = wss.address().port;
	const socket = net.connect(bound, '127.0.0.1');
	await new Promise((resolve, reject) => {
		socket.once('connect', resolve);
		socket.once('error', reject);
	});
	await rawHandshake(socket);

	try {
		// Text frame.
		socket.write(encodeClientFrame('hello 终端', OP_TEXT));
		// Binary frame (64 KiB + 1 → exercises the 16-bit length path).
		const big = randomBytes(65537);
		socket.write(encodeClientFrame(big, OP_BINARY));
		await sleep(300);

		assert.equal(received.length, 2);
		assert.equal(received[0].isBinary, false);
		assert.equal(received[0].data.toString('utf8'), 'hello 终端');
		assert.equal(received[1].isBinary, true);
		assert.ok(received[1].data.equals(big), 'large binary payload must survive the codec');
	} finally {
		socket.destroy();
		await closeServer(wss);
	}
});

test('server frame decoding: real ws server frames parse into messages/ping/close', { timeout: 20000 }, async () => {
	const wss = new WebSocketServer({ port: 0 });
	await listen(wss);
	const serverSidePromise = new Promise((resolve) => {
		wss.on('connection', resolve);
	});
	const socket = net.connect(wss.address().port, '127.0.0.1');
	await new Promise((resolve, reject) => {
		socket.once('connect', resolve);
		socket.once('error', reject);
	});
	await rawHandshake(socket);

	const decoder = new ServerFrameDecoder();
	const events = wireRawSocket(socket, decoder);

	const serverSide = await serverSidePromise;
	try {
		serverSide.send('line-one');
		serverSide.send('line-two');
		serverSide.ping('hi');
		await sleep(300);
		assert.deepEqual(
			events.map((ev) => ev.type),
			['message', 'message', 'ping'],
		);
		assert.equal(events[0].data.toString(), 'line-one');
		assert.equal(events[1].data.toString(), 'line-two');
		assert.equal(events[2].data.toString(), 'hi');

		// Pong reply: the ws server's 'pong' event fires for our masked pong.
		const ponged = new Promise((resolve) => serverSide.once('pong', resolve));
		socket.write(encodeClientFrame(events[2].data, OP_PONG));
		await ponged;

		// Close: server closes → decoder yields the close event.
		serverSide.close(1001, 'bye');
		await sleep(300);
		const closeEv = events.find((ev) => ev.type === 'close');
		assert.ok(closeEv, 'close event expected');
		assert.equal(closeEv.code, 1001);
		assert.equal(closeEv.reason, 'bye');
	} finally {
		socket.destroy();
		await closeServer(wss);
	}
});

test('mock socket: ws handleUpgrade works end-to-end through the mock duplex', { timeout: 20000 }, async () => {
	const wss = new WebSocketServer({ noServer: true });
	const decoder = new ServerFrameDecoder();
	let handshaken = false;
	const events = [];
	const socket = createMockSocket({
		onWrite(buffer) {
			decoder.push(buffer);
			if (!handshaken) {
				if (!decoder.consumeHandshake()) return;
				handshaken = true;
			}
			for (const ev of decoder.drain()) events.push(ev);
		},
	});

	const request = {
		method: 'GET',
		url: '/sidebar/ws/terminal?sessionId=s1&tab=t1',
		headers: {
			host: '127.0.0.1',
			upgrade: 'websocket',
			connection: 'Upgrade',
			'sec-websocket-key': randomBytes(16).toString('base64'),
			'sec-websocket-version': '13',
		},
	};

	let serverWs;
	wss.handleUpgrade(request, socket, Buffer.alloc(0), (ws) => {
		serverWs = ws;
		ws.on('message', (data) => {
			ws.send(`echo:${data.toString('utf8')}`);
		});
		ws.send('welcome');
	});

	assert.equal(handshaken, true, 'mock socket must have seen the 101 handshake');
	assert.ok(serverWs, 'upgrade must complete');
	assert.equal(serverWs.readyState, WebSocket.OPEN);
	// ws's `bufferedAmount` getter reads `socket._writableState.length` — the
	// plugin's terminal onData guard touches it on every pty output, so the
	// mock must answer (regression: it used to throw and crash the carrier).
	assert.equal(typeof serverWs.bufferedAmount, 'number');
	// ws's Sender flushes asynchronously; the bridge receives frames the same
	// way (IPC events), so wait a tick before asserting.
	await sleep(100);
	assert.equal(events[0].data.toString(), 'welcome');

	// Renderer → server: a masked frame fed into the socket.
	socket.feed(encodeClientFrame('ls -la', OP_TEXT));
	await sleep(100);
	assert.equal(events[1].data.toString(), 'echo:ls -la');

	// Server-initiated close surfaces as a close event.
	serverWs.close(1011, 'boom');
	await sleep(100);
	const closeEv = events.find((ev) => ev.type === 'close');
	assert.ok(closeEv);
	assert.equal(closeEv.code, 1011);
	assert.equal(closeEv.reason, 'boom');
	// The client side replies with a close frame and ends the stream (the
	// bridge does this when the renderer shim's close() arrives as
	// 'dsh:ws-close'), which completes the server-side closing handshake.
	const reply = Buffer.concat([Buffer.from([1011 >> 8, 1011 & 0xff]), Buffer.from('bye')]);
	socket.feed(encodeClientFrame(reply, OP_CLOSE));
	socket.end();
	await sleep(100);
	await closeServer(wss);

	// A client close (tab closed) gracefully ends the stream.
	const wss2 = new WebSocketServer({ noServer: true });
	const socket2 = createMockSocket({ onWrite() {} });
	let closed = false;
	wss2.handleUpgrade(request, socket2, Buffer.alloc(0), (ws) => {
		ws.on('close', () => {
			closed = true;
		});
	});
	socket2.feed(encodeClientFrame(Buffer.concat([Buffer.from([1000 >> 8, 1000 & 0xff]), Buffer.from('bye')]), OP_CLOSE));
	socket2.end();
	await sleep(100);
	assert.equal(closed, true, 'server-side ws must observe the client close');
	await closeServer(wss2);
});

test('mock socket contract: ws sender path (cork/write/uncork) does not throw', () => {
	const socket = createMockSocket({ onWrite() {} });
	// The Sender uses cork/uncork for fragmented frames; plain write must
	// also return true and invoke the callback.
	socket.cork();
	socket.write(Buffer.from('a'));
	socket.write(Buffer.from('b'), () => {});
	socket.uncork();
	assert.equal(socket.write(Buffer.from('c')), true);
	socket.end();
	socket.destroy();
	assert.equal(socket.destroyed, true);
});

test('fragmented server frames are reassembled', () => {
	const decoder = new ServerFrameDecoder();
	// Hand-built fragmented text frame: fin=0 opcode=1 "he", continuation "ll", fin=1 "o".
	const frame = (fin, opcode, payload) => {
		const head = Buffer.from([(fin ? 0x80 : 0) | opcode, payload.length]);
		return Buffer.concat([head, Buffer.from(payload, 'utf8')]);
	};
	const events = [];
	for (const ev of drainAll(decoder, Buffer.concat([frame(false, OP_TEXT, 'he'), frame(false, 0x0, 'll')]))) events.push(ev);
	assert.equal(events.length, 0, 'incomplete fragments must not emit');
	for (const ev of drainAll(decoder, frame(true, 0x0, 'o'))) events.push(ev);
	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'message');
	assert.equal(events[0].opcode, OP_TEXT);
	assert.equal(events[0].data.toString(), 'hello');
});

/** Append to a decoder and return its drained events (test shorthand). */
function drainAll(decoder, chunk) {
	decoder.push(chunk);
	return decoder.drain();
}
