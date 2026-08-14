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
import { dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';

// In a packaged app the resolver reports app.asar paths, but node_modules is
// fully asar-unpacked — the child (ELECTRON_RUN_AS_NODE) reads real files, so
// rewrite to the unpacked sibling (same as boot.mjs's INSTALL_ANCHOR).
function unpack(p) {
	const marker = `${sep}app.asar${sep}`;
	const unpacked = `${sep}app.asar.unpacked${sep}`;
	if (p.includes(marker) && !p.includes(unpacked)) return p.replace(marker, unpacked);
	return p;
}

function dshBinPath() {
	const pkgJson = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
	return unpack(join(dirname(pkgJson), 'lib', 'bin.js'));
}

function pnpmCjsPath() {
	// pnpm's exports map points "." at ./package.json and hides the
	// ./package.json subpath, so resolve('pnpm') yields the package root's
	// package.json directly; join bin/pnpm.cjs ourselves.
	const pkgJson = createRequire(import.meta.url).resolve('pnpm');
	return unpack(join(dirname(pkgJson), 'bin', 'pnpm.cjs'));
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
 * Start `dsh plugin --profile web <args...>` as a cancellable task.
 * @param {object} [opts] - logLine, onOutput(chunk, stream), timeoutMs.
 * @returns {{done: Promise<{code:number|null, stdout:string, stderr:string, killed:boolean}>, kill(): void}}
 */
export function startDshPlugin(args, { logLine, onOutput, timeoutMs } = {}) {
	let child = null;
	let killed = false;
	const done = new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		try {
			const shim = ensurePnpmShim();
			const path = `${shim}${process.env.PATH ? ';' + process.env.PATH : ''}`;
			// `dsh plugin` forwards these args to pnpm through a shell; quote any
			// spec containing whitespace so paths like "…/DeepSeek Harness
			// Desktop/…" survive as a single argument.
			const quotedArgs = args.map((arg) => (/[\s"&|<>^]/.test(String(arg)) ? `"${String(arg)}"` : arg));
			child = spawn(process.execPath, [dshBinPath(), 'plugin', '--profile', 'web', ...quotedArgs], {
				env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PATH: path },
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (error) {
			resolve({ code: null, stdout: '', stderr: String(error?.message ?? error), killed: false });
			return;
		}
		const cap = (chunk) => {
			const text = chunk.toString('utf8');
			return text.length < 4096 ? text : text.slice(-4096);
		};
		const emit = (chunk, stream) => {
			try {
				onOutput?.(chunk.toString('utf8'), stream);
			} catch {
				/* best effort */
			}
		};
		child.stdout.on('data', (chunk) => {
			stdout = (stdout + cap(chunk)).slice(-16384);
			emit(chunk, 'stdout');
		});
		child.stderr.on('data', (chunk) => {
			stderr = (stderr + cap(chunk)).slice(-16384);
			emit(chunk, 'stderr');
		});
		const timer = setTimeout(() => {
			killed = true;
			try {
				child.kill();
			} catch {
				/* already gone */
			}
		}, timeoutMs ?? 15 * 60 * 1000); // generous ceiling (git builds can be slow)
		child.on('error', (error) => {
			clearTimeout(timer);
			resolve({ code: null, stdout, stderr: String(error?.message ?? error), killed });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			logLine?.(`dsh plugin ${args.join(' ').slice(0, 80)} → ${code}${killed ? ' (killed)' : ''}`);
			resolve({ code, stdout, stderr, killed });
		});
	});
	return {
		done,
		kill() {
			killed = true;
			try {
				child?.kill();
			} catch {
				/* already gone */
			}
		},
	};
}

/**
 * Run `dsh plugin --profile web <args...>` to completion.
 * @returns {Promise<{code: number|null, stdout: string, stderr: string}>}
 */
export function runDshPlugin(args, opts) {
	return startDshPlugin(args, opts).done;
}
