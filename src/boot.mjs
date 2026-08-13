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
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
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

/** The desktop overlay: HTTP out, IPC in. Applied after the profile user layer. */
const DESKTOP_PATCHES = [
	// No HTTP listener: the desktop carrier owns the transport.
	{ id: 'webserver', disabled: true },
	// No URL line and no web-surface prompt: the desktop carrier prints and
	// registers its own surface context.
	{
		id: 'web-runtime',
		config: {
			printUrl: false,
			surfaceContext: false,
			trustedHosts: [],
		},
	},
	// Idle dev-only reload chain; without a rebuild watcher it only polls.
	{ id: 'client-hmr', disabled: true },
	// The -auto chooser's native backend drives IFileOpenDialog through a
	// spawned koffi child process, which cannot run under Electron. The
	// desktop carrier provides `directoryPicker` itself (Electron's native
	// dialog); this row keeps the CLIENT-side flow occupant (a pure UI
	// plugin with an empty host apply) in the boot graph.
	{ id: 'directory-picker', disabled: true },
	{
		insert: [
			{
				id: 'ui-directory-picker-native',
				name: '@deepseek-ai/dsh-client-ui-directory-picker-native',
			},
		],
	},
];

function homePatchPath() {
	return join(resolveDshHome(), PROFILE_PATCH_FILENAME);
}

/** ANY non-empty value disables telemetry (mirrors the CLI's privacy switch). */
function resolveTelemetryPatch(disabledEnv, hasRow) {
	if ((disabledEnv ?? '') === '' || !hasRow) return undefined;
	return { id: TELEMETRY_ROW_ID, disabled: true };
}

/**
 * Boot the shipped web profile in-process with the desktop overlay.
 * @param {object} options
 * @param {object} options.webServer - the in-process webServer stub provided in prepare.
 * @param {object} options.directoryPicker - the desktop directoryPicker service (Electron dialog).
 * @param {(code: number) => void} options.onExit - app exit requested by a booted app.
 * @returns {Promise<import('@deepseek-ai/cordis').Context>} the settled root context.
 */
export async function bootDesktop({ webServer, directoryPicker, onExit }) {
	healProfilesModuleFallback(INSTALL_ANCHOR);
	const profile = loadProfile(NAME, 'web', INSTALL_ANCHOR, undefined, { userLayer: true });
	writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG);

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
				roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
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
