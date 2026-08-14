/**
 * Self-contained pnpm runner for profile plugin management, executed under
 * Electron's own Node (ELECTRON_RUN_AS_NODE=1 on the child env only).
 *
 * Instead of shelling out to `dsh plugin` (whose internal `spawnSync("pnpm",
 * {shell:true})` opens a visible cmd.exe console), pnpm is spawned directly
 * with real arguments and a hidden window, then the profile manifest's
 * `dsh.profile.bundles` is reconciled against the installed state — the same
 * contract the dsh CLI applies, without the console window or the shell
 * quoting fragility.
 *
 * @module dsh-desktop/dsh-runner
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';

function pnpmPath() {
	// pnpm's exports map points "." at ./package.json and hides the
	// ./package.json subpath, so resolve('pnpm') yields the package root's
	// package.json directly; join bin/pnpm.cjs ourselves.
	const pkgJson = createRequire(import.meta.url).resolve('pnpm');
	return unpack(join(dirname(pkgJson), 'bin', 'pnpm.cjs'));
}

// A pnpm.cmd shim on PATH so nested lifecycle scripts that call `pnpm`
// (e.g. a git dependency's prepare: `pnpm install`) resolve to the bundled
// pnpm. The main pnpm invocation stays direct + hidden; only PATH lookup goes
// through the shim. ELECTRON_RUN_AS_NODE is inherited by the shell children.
let shimDir = null;
function ensurePnpmShim() {
	if (shimDir !== null) return shimDir;
	const dir = join(tmpdir(), 'dsh-desktop-pnpm-shim');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'pnpm.cmd'), `@echo off\r\n"${process.execPath}" "${pnpmPath()}" %*\r\n`, 'utf8');
	shimDir = dir;
	return dir;
}

// In a packaged app the resolver reports app.asar paths, but node_modules is
// fully asar-unpacked — the child (ELECTRON_RUN_AS_NODE) reads real files, so
// rewrite to the unpacked sibling (same as boot.mjs's INSTALL_ANCHOR).
function unpack(p) {
	const marker = `${sep}app.asar${sep}`;
	const unpacked = `${sep}app.asar.unpacked${sep}`;
	if (p.includes(marker) && !p.includes(unpacked)) return p.replace(marker, unpacked);
	return p;
}

/** The bundled dsh CLI entry (lib/bin.js), as a real unpacked path. */
export function dshBinPath() {
	const pkgJson = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
	return unpack(join(dirname(pkgJson), 'lib', 'bin.js'));
}

/**
 * Start one pnpm invocation as a cancellable task.
 * @param {string[]} args - pnpm arguments (add/remove …).
 * @param {object} [opts] - cwd, logLine, onOutput(chunk), timeoutMs.
 * @returns {{done: Promise<{code:number|null, stdout:string, stderr:string, killed:boolean}>, kill(): void}}
 */
export function startPnpm(args, { cwd, logLine, onOutput, timeoutMs } = {}) {
	let child = null;
	let killed = false;
	const done = new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		try {
			const path = `${ensurePnpmShim()}${process.env.PATH ? ';' + process.env.PATH : ''}`;
			child = spawn(process.execPath, [pnpmPath(), ...args], {
				cwd,
				env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CI: 'true', PATH: path },
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
		const emit = (chunk) => {
			try {
				onOutput?.(chunk.toString('utf8'));
			} catch {
				/* best effort */
			}
		};
		child.stdout.on('data', (chunk) => {
			stdout = (stdout + cap(chunk)).slice(-16384);
			emit(chunk);
		});
		child.stderr.on('data', (chunk) => {
			stderr = (stderr + cap(chunk)).slice(-16384);
			emit(chunk);
		});
		const timer = setTimeout(() => {
			killed = true;
			try {
				child.kill();
			} catch {
				/* already gone */
			}
		}, timeoutMs ?? 15 * 60 * 1000);
		child.on('error', (error) => {
			clearTimeout(timer);
			resolve({ code: null, stdout, stderr: String(error?.message ?? error), killed });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			logLine?.(`pnpm ${args.join(' ').slice(0, 80)} → ${code}${killed ? ' (killed)' : ''}`);
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

// ---- profile manifest reconciliation (mirrors the dsh CLI's contract) ----

function readProfileManifest(profileDir) {
	try {
		return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
	} catch {
		return {};
	}
}

function writeProfileManifest(profileDir, manifest) {
	writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function bundleDir(profileDir, packageName) {
	return join(profileDir, 'node_modules', ...packageName.split('/'));
}

function isBundle(profileDir, packageName) {
	try {
		const pkg = JSON.parse(readFileSync(join(bundleDir(profileDir, packageName), 'package.json'), 'utf8'));
		return Boolean(pkg?.dsh && pkg.dsh.bundle && typeof pkg.dsh.bundle.patch === 'string');
	} catch {
		return false;
	}
}

/** A dependency resolving to a dsh.bundle package joins the layer stack; a
 *  dependency-listed name that no longer declares a bundle leaves it.
 *  `beforeDeps` is the dependency snapshot taken BEFORE the pnpm operation,
 *  so a removed dependency also leaves the layer list. */
function reconcilePlugins(profileDir, beforeDeps) {
	const manifest = readProfileManifest(profileDir);
	const dependencies = Object.keys(manifest.dependencies ?? {});
	const bundles = manifest.dsh?.profile?.bundles ?? [];
	let changed = false;
	for (const name of dependencies) {
		if (isBundle(profileDir, name) && !bundles.includes(name)) {
			bundles.push(name);
			changed = true;
		}
	}
	for (const name of [...bundles]) {
		const wasDependency = beforeDeps.has(name) || dependencies.includes(name);
		const stillBundle = dependencies.includes(name) && isBundle(profileDir, name);
		if (wasDependency && !stillBundle) {
			bundles.splice(bundles.indexOf(name), 1);
			changed = true;
		}
	}
	if (!changed) return;
	manifest.dsh = {
		...manifest.dsh,
		profile: {
			...manifest.dsh?.profile,
			bundles,
		},
	};
	writeProfileManifest(profileDir, manifest);
}

/**
 * `pnpm add <specs…>` in the profile + bundle reconciliation.
 * @returns {Promise<{code:number|null, stdout:string, stderr:string, killed:boolean}>}
 */
export async function addPlugins(profileDir, specs, opts = {}) {
	const before = new Set(Object.keys(readProfileManifest(profileDir).dependencies ?? {}));
	const task = startPnpm(['add', ...specs], { ...opts, cwd: profileDir });
	const res = await task.done;
	if (res.code === 0 && !res.killed) reconcilePlugins(profileDir, before);
	return res;
}

/**
 * `pnpm remove <pkg>` in the profile + bundle reconciliation.
 * @returns {Promise<{code:number|null, stdout:string, stderr:string, killed:boolean}>}
 */
export async function removePlugin(profileDir, pkg, opts = {}) {
	const before = new Set(Object.keys(readProfileManifest(profileDir).dependencies ?? {}));
	const task = startPnpm(['remove', pkg], { ...opts, cwd: profileDir });
	const res = await task.done;
	if (res.code === 0 && !res.killed) reconcilePlugins(profileDir, before);
	return res;
}
