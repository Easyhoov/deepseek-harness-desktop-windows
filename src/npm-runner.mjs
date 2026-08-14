/**
 * Self-contained npm runner: the `npm` package is bundled as a runtime
 * dependency and executed under Electron's own Node (ELECTRON_RUN_AS_NODE=1
 * on the CHILD env only — never globally, Chromium utility children must
 * not inherit it).
 *
 * @module dsh-desktop/npm-runner
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

function npmCliPath() {
	try {
		// npm's exports map hides ./bin/npm-cli.js: resolve the package root
		// via its exported package.json and join the bin path ourselves.
		const pkgJson = createRequire(import.meta.url).resolve('npm/package.json');
		return join(dirname(pkgJson), 'bin', 'npm-cli.js');
	} catch {
		throw new Error('npm is not bundled; add the npm package as a runtime dependency');
	}
}

/**
 * Run one npm command to completion.
 * @returns {Promise<{code: number|null, stdout: string, stderr: string}>}
 */
export function runNpm(args, { logLine } = {}) {
	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let child;
		try {
			child = spawn(process.execPath, [npmCliPath(), ...args], {
				env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (error) {
			resolve({ code: null, stdout: '', stderr: String(error?.message ?? error) });
			return;
		}
		const cap = (chunk) => {
			const text = chunk.toString('utf8');
			if (text.length < 4096) return text;
			return text.slice(-4096);
		};
		child.stdout.on('data', (chunk) => {
			stdout = (stdout + cap(chunk)).slice(-8192);
		});
		child.stderr.on('data', (chunk) => {
			stderr = (stderr + cap(chunk)).slice(-8192);
		});
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				/* already gone */
			}
		}, 10 * 60 * 1000); // 10-minute ceiling
		child.on('error', (error) => {
			clearTimeout(timer);
			resolve({ code: null, stdout, stderr: String(error?.message ?? error) });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			logLine?.(`npm ${args.join(' ').slice(0, 80)} → ${code}`);
			resolve({ code, stdout, stderr });
		});
	});
}
