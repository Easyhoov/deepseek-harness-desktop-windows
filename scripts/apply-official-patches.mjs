/**
 * Apply official upstream fixes to the bundled dsh packages.
 *
 * Currently one patch, mirroring the official deepseek-harness master fix for
 * the persistent-bash 3.5s prompt mismatch (published rc.6/rc.7 still carry
 * the bug):
 *
 *   dsh-tool-bash-persistent used to override PS1 to a private prompt
 *   (__DSH_PERSISTENT_BASH_PROMPT__) while dsh-terminal-bash waits for its own
 *   CONTROLLED_PROMPT ("dsh> "). The mismatch meant prompt-based readiness
 *   never fired and every command fell back to the 3.5s idle-silence settle.
 *   Master keeps the backend's own prompt (`stty -echo` only), so detection
 *   works and simple commands settle in milliseconds.
 *
 * Runs idempotently from postinstall/predist; safe to run repeatedly.
 *
 * @module dsh-desktop/apply-official-patches
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PATCHES = [
	{
		target: join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-tool-bash-persistent', 'lib', 'index.js'),
		description: 'persistent-bash: keep the backend prompt so readiness detection fires',
		replacements: [
			['const SHELL_PROMPT = "__DSH_PERSISTENT_BASH_PROMPT__ ";', 'const SHELL_PROMPT = "dsh> ";'],
			['result = result.slice(0, -31)', 'result = result.slice(0, -6)'],
			['text: `stty -echo; PS1=${quoteForBash(SHELL_PROMPT)}`,', "text: 'stty -echo',"],
		],
	},
];

let changed = false;
for (const patch of PATCHES) {
	let source;
	try {
		source = readFileSync(patch.target, 'utf8');
	} catch {
		console.log(`[patch] skip (not installed yet): ${patch.target}`);
		continue;
	}
	let applied = 0;
	for (const [from, to] of patch.replacements) {
		if (source.includes(from)) {
			if (!source.includes(to)) {
				source = source.replaceAll(from, to);
				applied += 1;
			} else {
				// Both present: already patched, keep as-is.
			}
		} else if (!source.includes(to)) {
			console.warn(`[patch] pattern not found in ${patch.target}: ${from.slice(0, 60)}…`);
		}
	}
	if (applied > 0) {
		writeFileSync(patch.target, source, 'utf8');
		changed = true;
		console.log(`[patch] applied ${applied} replacement(s): ${patch.description}`);
	} else {
		console.log(`[patch] already up to date: ${patch.description}`);
	}
}
if (changed) console.log('[patch] done — node_modules patched (fresh npm ci re-applies via postinstall).');
