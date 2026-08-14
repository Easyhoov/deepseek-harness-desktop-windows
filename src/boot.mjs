/**
 * In-process boot of the shipped `web` profile for the Electron desktop app.
 *
 * Mirrors the dsh CLI's `runProfile` composition (bundle layers → profile
 * user layer → home layer → overlays) with two desktop differences:
 *
 *   1. The `webserver` row is disabled and an in-process `webServer` stub is
 *      provided in the boot prepare hook, so no socket ever binds.
 *   2. `web-runtime` prints no URL and registers no web-surface prompt
 *      section (the desktop carrier registers its own), and the idle
 *      `client-hmr` dev chain is disabled.
 *
 * @module dsh-desktop/boot
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
	boot,
	composeEntries,
	healProfilesModuleFallback,
	loadLayeredEnv,
	loadOptionalPatches,
	loadProfile,
	PROFILE_PATCH_FILENAME,
} from '@deepseek-ai/dsh-app-boot';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment';
import { provideCmdline } from '@deepseek-ai/dsh-cmdline';
import { addPlugins } from './dsh-runner.mjs';

/** This app's install anchor: the dsh CLI package.json inside our node_modules. */
export const INSTALL_ANCHOR = (() => {
	const resolved = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
	// In a packaged app the resolver reports an app.asar path, but the profile
	// fallback junctions this anchor feeds must target REAL directories: the
	// Loader's ESM resolution cannot cross a junction into an asar archive.
	// node_modules is fully asar-unpacked, so rewrite to the unpacked sibling.
	const marker = `${sep}app.asar${sep}`;
	const unpackedMarker = `${sep}app.asar.unpacked${sep}`;
	if (resolved.includes(marker) && !resolved.includes(unpackedMarker)) {
		return resolved.replace(marker, unpackedMarker);
	}
	return resolved;
})();

/** Shipped agent-preset root beside the CLI's config, mirrored from runProfile. */
export const SHIPPED_PRESET_ROOT = join(dirname(INSTALL_ANCHOR), 'config', 'agent-presets');

const NAME = 'dsh-desktop';
const PROFILE_ROOT_FILENAME = 'cordis.yml';
const TELEMETRY_ROW_ID = 'session-telemetry-otel';

/** The empty root entry list every profile tree patches over (same as the CLI). */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`;

/**
 * The desktop carrier overlay, as a declarative patch layer (same format as a
 * profile's cordis.patch.yml / a bundle patch). Only carrier rows live here;
 * the desktop plugins are bundles whose own cordis.patch.yml declares their
 * rows.
 */
const DESKTOP_PATCH_PATH = join(dirname(fileURLToPath(import.meta.url)), 'desktop.patch.yml');
const DESKTOP_PATCHES = parseYaml(readFileSync(DESKTOP_PATCH_PATH, 'utf8'));

/**
 * Shipped desktop bundles, materialized into the profile via the official
 * `dsh plugin add <path>` mechanism and registered by their `dsh.bundle`
 * manifest. The plugin sources ship as real files (asar-unpacked), so pnpm
 * links them directly.
 */
const DESKTOP_BUNDLES = [
	{ id: '@dsh-desktop/balance', dir: 'desktop-balance' },
	{ id: '@dsh-desktop/file-changes', dir: 'desktop-file-changes' },
	{ id: '@dsh-desktop/marketplace', dir: 'desktop-marketplace' },
];

const PLUGINS_ROOT = (() => {
	const base = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins');
	const marker = `${sep}app.asar${sep}`;
	const unpackedMarker = `${sep}app.asar.unpacked${sep}`;
	if (base.includes(marker) && !base.includes(unpackedMarker)) {
		return base.replace(marker, unpackedMarker);
	}
	return base;
})();

function homePatchPath() {
	return join(resolveDshHome(), PROFILE_PATCH_FILENAME);
}

/** ANY non-empty value disables telemetry (mirrors the CLI's privacy switch). */
function resolveTelemetryPatch(disabledEnv, hasRow) {
	if ((disabledEnv ?? '') === '' || !hasRow) return undefined;
	return { id: TELEMETRY_ROW_ID, disabled: true };
}

/**
 * Install the shipped desktop bundles into the profile with `dsh plugin add
 * <path>` (pnpm link + bundle registration) so their cordis.patch.yml layers
 * compose through dsh.profile.bundles like any other plugin. Idempotent: skips
 * bundles already present in the profile manifest, so steady-state boots never
 * spawn pnpm.
 */
async function ensureDesktopBundles(profileDir) {
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
	} catch {
		manifest = {};
	}
	const bundles = manifest.dsh?.profile?.bundles ?? [];
	const missing = DESKTOP_BUNDLES.filter((bundle) => bundles.indexOf(bundle.id) === -1);
	if (missing.length === 0) return;
	const specs = missing.map((bundle) => join(PLUGINS_ROOT, bundle.dir));
	const result = await addPlugins(profileDir, specs);
	if (result.code !== 0) {
		console.error('[dsh-desktop] desktop bundle install failed:', result.stderr || result.stdout);
	}
}

/**
 * Boot the shipped web profile in-process with the desktop overlay.
 * @param {object} options
 * @param {object} options.webServer - the in-process webServer stub provided in prepare.
 * @param {object} options.directoryPicker - the desktop directoryPicker service (Electron dialog).
 * @param {(code: number) => void} options.onExit - app exit requested by a booted app.
 * @returns {Promise<import('@deepseek-ai/cordis').Context>} the settled root context.
 */
export async function bootDesktop({ webServer, directoryPicker, desktopUi, overlayAnchor, onExit }) {
	// A user-installed overlay release of @deepseek-ai/dsh takes precedence
	// over the bundled copy: the healed fallback junctions and the bundle
	// resolution both follow this anchor, so the whole composition boots
	// from the overlay in-process (rollback = remove the overlay).
	const anchor = overlayAnchor !== undefined && overlayAnchor !== '' && existsSync(overlayAnchor)
		? overlayAnchor
		: INSTALL_ANCHOR;
	healProfilesModuleFallback(anchor);
	// First load initializes the profile manifest (and heals junctions); then
	// the shipped desktop bundles are installed via `dsh plugin add`, and the
	// profile is re-read so their cordis.patch.yml layers enter the composition.
	const bootProfile = loadProfile(NAME, 'web', anchor, undefined, { userLayer: true });
	writeFileSync(join(bootProfile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG);
	await ensureDesktopBundles(bootProfile.dir);
	const profile = loadProfile(NAME, 'web', anchor, undefined, { userLayer: true });
	if (desktopUi !== undefined) {
		desktopUi.profileDir = profile.dir;
		desktopUi.dshAnchor = anchor;
	}

	const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? [];
	const bundlePatches = profile.layers.flatMap((layer) => layer.patches);

	const rows = new Map();
	for (const row of composeEntries([bundlePatches, profile.patches, homePatches, DESKTOP_PATCHES])) {
		if (typeof row.id === 'string') rows.set(row.id, row);
	}

	const overlays = [...DESKTOP_PATCHES];
	if (rows.has('agent-presets')) {
		overlays.push({
			id: 'agent-presets',
			config: {
				...(rows.get('agent-presets')?.config ?? {}),
				roots: [{ path: join(dirname(anchor), 'config', 'agent-presets'), trust: 'system' }],
			},
		});
	}
	const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID));
	if (telemetryPatch !== undefined) overlays.push(telemetryPatch);

	const patches = [...bundlePatches, ...profile.patches, ...homePatches, ...overlays];
	const rootConfig = join(profile.dir, PROFILE_ROOT_FILENAME);

	const ctx = await boot(NAME, rootConfig, patches, (hostCtx) => {
		hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, loadLayeredEnv(NAME));
		provideCmdline(hostCtx, { args: [], exit: (code) => void onExit(code) });
		hostCtx.provide('webServer', webServer);
		hostCtx.provide('directoryPicker', directoryPicker);
		hostCtx.provide('desktopUi', desktopUi);
	}).catch((error) => {
		// The Loader aggregates per-entry failures; surface every one.
		const walk = (err, depth) => {
			if (depth > 6 || err === undefined || err === null) return;
			console.error(`[dsh-desktop] boot failure (depth ${depth}):`, err?.message ?? String(err));
			if (Array.isArray(err?.errors)) {
				for (const sub of err.errors) walk(sub, depth + 1);
			} else if (err?.cause !== undefined) {
				walk(err.cause, depth + 1);
			}
		};
		walk(error, 0);
		throw error;
	});
	return ctx;
}
