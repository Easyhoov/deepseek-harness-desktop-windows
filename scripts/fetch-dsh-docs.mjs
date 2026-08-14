// Download the full DSH docs tree from deepseek-ai/deepseek-harness (master)
// via the GitHub API (token from git credential fill), organizing locally:
//   *.zh.md → zh/ (Chinese)   *.md → en/ (English)
// The API contents endpoint with raw accept is used for content because
// raw.githubusercontent is unreliable from some networks.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const OUT = 'E:/TESTDS/dsh-desktop/docs/dsh-docs';
const REPO = 'deepseek-ai/deepseek-harness';

function token() {
	if (process.env.DSH_GITHUB_TOKEN) return process.env.DSH_GITHUB_TOKEN;
	try {
		const out = spawnSync('git', ['credential', 'fill'], { input: 'host=github.com\nprotocol=https\n', encoding: 'utf8' });
		for (const line of out.stdout.split('\n')) {
			if (line.startsWith('password=')) return line.slice(9).trim();
		}
	} catch {
		/* fall through */
	}
	return '';
}

const AUTH = token();
const headers = { accept: 'application/vnd.github.raw+json', 'user-agent': 'dsh-docs' };
if (AUTH !== '') headers.authorization = `Bearer ${AUTH}`;

let count = 0;
const failed = [];

async function get(path) {
	for (let i = 0; i < 4; i++) {
		try {
			const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers, signal: AbortSignal.timeout(25000) });
			if (r.status === 200) return await r.text();
			if (r.status === 404) return null;
		} catch {
			/* retry */
		}
	}
	throw new Error(`failed after retries: ${path}`);
}

async function listJson(path) {
	const h = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-docs' };
	if (AUTH !== '') h.authorization = `Bearer ${AUTH}`;
	const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: h, signal: AbortSignal.timeout(25000) });
	if (!r.ok) throw new Error(`${r.status} listing ${path}`);
	return r.json();
}

async function walk(dir) {
	const entries = await listJson(dir);
	for (const entry of entries) {
		if (entry.type === 'dir') {
			await walk(entry.path);
			continue;
		}
		if (entry.type !== 'file') continue;
		if (entry.name.endsWith('.i18n.yaml')) continue;
		let lang = null;
		let rel = entry.path;
		if (entry.name.endsWith('.zh.md')) {
			lang = 'zh';
			rel = entry.path.slice(0, -'.zh.md'.length) + '.md';
		} else if (entry.name.endsWith('.md')) {
			lang = 'en';
		} else {
			continue;
		}
		try {
			const text = await get(entry.path);
			if (text === null) continue;
			const outPath = join(OUT, lang, rel);
			mkdirSync(dirname(outPath), { recursive: true });
			writeFileSync(outPath, text, 'utf8');
			count++;
			process.stdout.write(`\r${count}  ${lang}/${rel}`);
		} catch (e) {
			failed.push(`${entry.path}: ${e.message}`);
		}
	}
}

await walk('docs');
process.stdout.write(`\n\ndone: ${count} files; failed: ${failed.length}\n`);
for (const f of failed) console.log('  ' + f);
