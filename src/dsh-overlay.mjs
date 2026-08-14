/**
 * Second update channel: the bundled @deepseek-ai/dsh agent itself.
 *
 * `checkLatest` asks the npm registry; `install` runs the bundled npm into a
 * staging directory and atomically swaps it in as `<userData>/agent`. The
 * boot layer prefers the overlay's package.json as the install anchor, so
 * the composition (healed fallback junctions + bundle resolution) follows
 * the overlay on the next boot — same process, no child. `rollback` removes
 * the overlay and falls back to the bundled copy.
 *
 * @module dsh-desktop/dsh-overlay
 */
import { existsSync, rmSync, renameSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runNpm } from './npm-runner.mjs';
import { INSTALL_ANCHOR } from './boot.mjs';

const PKG = '@deepseek-ai/dsh';
const VERSION_PATTERN = /^\d+\.\d+\.\d+([.-].+)?$/;

export function overlayDirs(userData) {
	return {
		overlay: join(userData, 'agent'),
		staging: join(userData, 'agent-staging'),
	};
}

export function overlayAnchor(userData) {
	return join(userData, 'agent', 'node_modules', PKG, 'package.json');
}

export function overlayVersion(userData) {
	try {
		const parsed = JSON.parse(readFileSync(overlayAnchor(userData), 'utf8'));
		return typeof parsed.version === 'string' ? parsed.version : null;
	} catch {
		return null;
	}
}

export function bundledDshVersion() {
	try {
		const parsed = JSON.parse(readFileSync(INSTALL_ANCHOR, 'utf8'));
		return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
	} catch {
		return '0.0.0';
	}
}

export function activeDshVersion(userData) {
	return overlayVersion(userData) ?? bundledDshVersion();
}

export async function checkLatestDsh({ logLine } = {}) {
	const result = await runNpm(['view', PKG, 'version'], { logLine });
	if (result.code !== 0) return null;
	const version = (result.stdout ?? '').trim().split('\n').pop()?.trim() ?? '';
	return VERSION_PATTERN.test(version) ? version : null;
}

export async function installDshOverlay(userData, version, { logLine } = {}) {
	const { overlay, staging } = overlayDirs(userData);
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });
	const result = await runNpm(['install', '--prefix', staging, '--no-save', `${PKG}@${version}`], { logLine });
	if (result.code !== 0) {
		const tail = (result.stderr || result.stdout || 'npm failed').trim().split('\n').slice(-5).join(' ');
		return { ok: false, reason: tail.slice(-400) };
	}
	const stagingAnchor = join(staging, 'node_modules', PKG, 'package.json');
	if (!existsSync(stagingAnchor)) {
		// Installed tree must contain the CLI package.
		rmSync(staging, { recursive: true, force: true });
		return { ok: false, reason: 'installed tree missing @deepseek-ai/dsh' };
	}
	const backup = `${overlay}.old`;
	rmSync(backup, { recursive: true, force: true });
	if (existsSync(overlay)) renameSync(overlay, backup);
	renameSync(staging, overlay);
	return { ok: true, restartRequired: true };
}

export function rollbackDshOverlay(userData) {
	const { overlay } = overlayDirs(userData);
	rmSync(overlay, { recursive: true, force: true });
}
