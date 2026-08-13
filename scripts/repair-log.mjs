/**
 * Repair a session.jsonl.zstd log whose committed seq chain has out-of-order
 * or duplicate-seq regions (the turn-interruption flush reorder).
 *
 * Strategy: decompress every concatenated zstd frame, simulate the strict
 * committed-region walker (same span rule as dsh-session's decodeStorageRecord:
 * a chunk block spans args/texts.length events), and for each line whose
 * start seq does not continue the chain, renumber that line (seq, seq0, and
 * every numeric value in sourceEventSeqs) forward by exactly the gap the
 * walker expects. Everything after the first repair shifts consistently, so
 * internal seq references stay coherent. Timestamps are never touched.
 *
 * The file is recompressed as one zstd frame. Runs must target a COLD log:
 * never repair a session a live host still owns and appends to.
 *
 * Usage: node scripts/repair-log.mjs <file> [--in-place]
 *   default writes <file>.repaired; --in-place backs up to <file>.bak first.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { zstdDecompressSync, zstdCompressSync } from 'node:zlib';

const [, , file, modeArg] = process.argv;
if (!file) {
	console.error('usage: node scripts/repair-log.mjs <file> [--in-place]');
	process.exit(2);
}
const inPlace = modeArg === '--in-place';

const compressed = readFileSync(file);
const offsets = [];
for (let i = 0; i + 4 <= compressed.length; i += 1) {
	if (compressed[i] === 0x28 && compressed[i + 1] === 0xb5 && compressed[i + 2] === 0x2f && compressed[i + 3] === 0xfd) {
		offsets.push(i);
	}
}
if (offsets.length === 0) {
	console.error('no zstd frames found — not a session.jsonl.zstd file?');
	process.exit(2);
}
const parts = [];
for (let k = 0; k < offsets.length; k += 1) {
	const start = offsets[k];
	const end = k + 1 < offsets.length ? offsets[k + 1] : compressed.length;
	parts.push(zstdDecompressSync(compressed.subarray(start, end)));
}
const raw = Buffer.concat(parts).toString('utf8');
const lines = raw.split('\n');
const hadTrailingNewline = raw.endsWith('\n');

function spanOf(p) {
	if (p.type === 'tool-call-chunks') return Array.isArray(p.data?.args) ? p.data.args.length : 1;
	if (p.type === 'reasoning-chunks' || p.type === 'text-chunks') return Array.isArray(p.data?.texts) ? p.data.texts.length : 1;
	return 1;
}

function shiftSeqFields(value, delta) {
	if (value === null || typeof value !== 'object') return;
	if (typeof value.seq === 'number') value.seq += delta;
	if (typeof value.seq0 === 'number') value.seq0 += delta;
	if (value.sourceEventSeqs !== null && typeof value.sourceEventSeqs === 'object') {
		for (const key of Object.keys(value.sourceEventSeqs)) {
			if (typeof value.sourceEventSeqs[key] === 'number') value.sourceEventSeqs[key] += delta;
		}
	}
}

let committed = -1;
let fixes = 0;
for (let i = 0; i < lines.length; i += 1) {
	const text = lines[i];
	if (text.trim() === '') continue;
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		console.log(`WARN line ${i + 1}: unparsable JSON left untouched`);
		continue;
	}
	const isBlock = typeof parsed.seq0 === 'number';
	const start = isBlock ? parsed.seq0 : parsed.seq;
	if (typeof start !== 'number') continue; // header/meta lines carry no seq
	if (committed !== -1 && start !== committed + 1) {
		const delta = committed + 1 - start;
		shiftSeqFields(parsed, delta);
		fixes += 1;
		if (fixes <= 10) console.log(`line ${i + 1}: ${parsed.type} start ${start} -> ${start + delta} (delta +${delta})`);
		lines[i] = JSON.stringify(parsed);
		committed = start + delta;
	} else {
		committed = start;
	}
	committed += (isBlock ? spanOf(parsed) : 1) - 1;
}

if (fixes === 0) {
	console.log('no seq violations found — the log is already contiguous; nothing written');
	process.exit(0);
}

let outText = lines.join('\n');
if (!hadTrailingNewline) outText = outText.replace(/\n$/, '');
const recompressed = zstdCompressSync(Buffer.from(outText, 'utf8'));

if (inPlace) {
	copyFileSync(file, `${file}.bak`);
	writeFileSync(file, recompressed);
	console.log(`repaired ${fixes} line(s); original backed up to ${file}.bak`);
} else {
	writeFileSync(`${file}.repaired`, recompressed);
	console.log(`repaired ${fixes} line(s); wrote ${file}.repaired`);
}
console.log(`committed events: ${committed + 1}`);
