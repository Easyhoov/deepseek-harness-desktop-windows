/**
 * Self-contained `dsh plugin` runner: invokes the bundled @deepseek-ai/dsh
 * CLI under Electron's own Node (ELECTRON_RUN_AS_NODE=1 on the child env
 * only) against the `web` profile, exactly like `dsh plugin --profile web`.
 * `dsh plugin` forwards to `pnpm`, so we synthesize a `pnpm.cmd` shim into a
 * temp dir and prepend it to the child PATH — the packaged app has no
 * node_modules/.bin shims.
 *
 * @module dsh-desktop/dsh-runner
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

function dshBinPath() {
	const pkgJson = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
	return join(dirname(pkgJson), 'lib', 'bin.js');
}

function pnpmCjsPath() {
	const pkgJson = createRequire(import.meta.url).resolve('pnpm/package.json');
	return join(dirname(pkgJson), 'bin', 'pnpm.cjs');
}

let shimDir = null;
function ensurePnpmShim() {
	if (shimDir !== null) return shimDir;
	const dir = join(tmpdir(), 'dsh-desktop-pnpm-shim');
	mkdirSync(dir, { recursive: true });
	// ELECTRON_RUN_AS_NODE is inherited from the child env, so this electron
	// invocation behaves as plain node.
	writeFileSync(join(dir, 'pnpm.cmd'), `@echo off\r\n"${process.execPath}" "${pnpmCjsPath()}" %*\r\n`, 'utf8');
	shimDir = dir;
	return dir;
}

/**
 * Run `dsh plugin --profile web <args...>` to completion.
 * @returns {Promise<{code: number|null, stdout: string, stderr: string}>}
 */
export function runDshPlugin(args, { logLine } = {}) {
	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let child;
		try {
			const shim = ensurePnpmShim();
			const path = `${shim}${process.env.PATH ? ';' + process.env.PATH : ''}`;
			child = spawn(process.execPath, [dshBinPath(), 'plugin', '--profile', 'web', ...args], {
				env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PATH: path },
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (error) {
			resolve({ code: null, stdout: '', stderr: String(error?.message ?? error) });
			return;
		}
		const cap = (chunk) => {
			const text = chunk.toString('utf8');
			return text.length < 4096 ? text : text.slice(-4096);
		};
		child.stdout.on('data', (chunk) => {
			stdout = (stdout + cap(chunk)).slice(-16384);
		});
		child.stderr.on('data', (chunk) => {
			stderr = (stderr + cap(chunk)).slice(-16384);
		});
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				/* already gone */
			}
		}, 15 * 60 * 1000); // 15-minute ceiling (git builds can be slow)
		child.on('error', (error) => {
			clearTimeout(timer);
			resolve({ code: null, stdout, stderr: String(error?.message ?? error) });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			logLine?.(`dsh plugin ${args.join(' ').slice(0, 80)} → ${code}`);
			resolve({ code, stdout, stderr });
		});
	});
}
