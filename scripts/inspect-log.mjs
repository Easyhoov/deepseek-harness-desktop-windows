// Inspect a session.jsonl.zstd log: split concatenated zstd frames by magic,
// decompress, then audit seq continuity around a focus line and at the tail.
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const [, , file, focusLineArg] = process.argv;
const focusLine = Number.parseInt(focusLineArg ?? '0', 10);

const compressed = readFileSync(file);
const offsets = [];
for (let i = 0; i + 4 <= compressed.length; i += 1) {
	if (compressed[i] === 0x28 && compressed[i + 1] === 0xb5 && compressed[i + 2] === 0x2f && compressed[i + 3] === 0xfd) {
		offsets.push(i);
	}
}
const parts = [];
let failed = 0;
for (let k = 0; k < offsets.length; k += 1) {
	const start = offsets[k];
	const end = k + 1 < offsets.length ? offsets[k + 1] : compressed.length;
	try {
		parts.push(zstdDecompressSync(compressed.subarray(start, end)));
	} catch (error) {
		failed += 1;
		if (failed <= 5) console.log(`frame ${k} FAILED: ${error.message}`);
	}
}
console.log(`frames: ${offsets.length}, decompressed: ${parts.length}, failed: ${failed}`);
const text = Buffer.concat(parts).toString('utf8');
const lines = text.split('\n').filter((line) => line.trim() !== '');
console.log(`total lines: ${lines.length}`);

const seqOf = (line) => {
	try {
		const parsed = JSON.parse(line);
		return typeof parsed.seq === 'number' ? parsed.seq : undefined;
	} catch {
		return undefined;
	}
};

if (focusLine > 0) {
	const from = Math.max(1, focusLine - 12);
	const to = Math.min(lines.length, focusLine + 12);
	console.log(`--- lines ${from}..${to} ---`);
	for (let i = from; i <= to; i += 1) {
		const parsed = (() => { try { return JSON.parse(lines[i - 1]); } catch { return null; } })();
		const brief = parsed === null ? 'unparseable' : `${parsed.type ?? '?'} seq=${parsed.seq ?? '?'}`;
		console.log(`${String(i).padStart(6)}: ${brief}`);
	}
}

console.log('--- tail 25 lines ---');
for (let i = Math.max(1, lines.length - 24); i <= lines.length; i += 1) {
	const parsed = (() => { try { return JSON.parse(lines[i - 1]); } catch { return null; } })();
	const brief = parsed === null ? 'unparseable' : `${parsed.type ?? '?'} seq=${parsed.seq ?? '?'}`;
	console.log(`${String(i).padStart(6)}: ${brief}`);
}

let violations = 0;
let prev;
let firstGapLine = 0;
for (let i = 0; i < lines.length; i += 1) {
	const seq = seqOf(lines[i]);
	if (seq === undefined) continue;
	if (prev !== undefined && seq !== prev + 1) {
		violations += 1;
		if (firstGapLine === 0) firstGapLine = i + 1;
		if (violations <= 12) console.log(`GAP at line ${i + 1}: seq ${seq} (prev ${prev}, delta ${seq - prev})`);
	}
	prev = seq;
}
console.log(`seq violations total: ${violations}, first at line ${firstGapLine}`);
