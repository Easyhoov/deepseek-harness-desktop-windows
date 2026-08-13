/**
 * In-process webServer replacement for the Electron desktop carrier.
 *
 * The shipped Web composition registers its routes on the `webServer`
 * service (the node:http server from @deepseek-ai/dsh-host-webserver). The
 * desktop app disables that row and provides THIS object under the same
 * service name instead: identical route/fallback/index-tap semantics, zero
 * sockets. The IPC bridge later dispatches renderer requests through
 * `match()` + the registered handlers, so every shipped host row (the /api
 * gateway carrier, plugin bundle serving, RPC channels, the SPA fallback)
 * keeps working unchanged.
 *
 * `port` reports 0 and `host` reports '127.0.0.1' because the web-runtime
 * glue and the directory-picker chooser read those as composition facts.
 */

export function createIpcWebServer() {
	const exact = new Map();
	const prefixes = new Map();
	const upgrades = new Map();
	const indexTaps = [];
	let fallback;

	return {
		/** No socket ever binds: port 0 is the honest composition fact. */
		get port() {
			return 0;
		},
		/** Loopback literal keeps the directory picker on the native backend. */
		get host() {
			return '127.0.0.1';
		},

		register(route) {
			const table = route.kind === 'exact' ? exact : prefixes;
			if (table.has(route.path)) {
				throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
			}
			table.set(route.path, route);
			return () => {
				table.delete(route.path);
			};
		},

		registerUpgrade(route) {
			if (upgrades.has(route.path)) {
				throw new Error(`webserver: duplicate upgrade route "${route.path}"`);
			}
			upgrades.set(route.path, route);
			return () => {
				upgrades.delete(route.path);
			};
		},

		registerFallback(handler) {
			if (fallback !== undefined) {
				throw new Error('webserver: fallback already registered');
			}
			fallback = handler;
			return () => {
				fallback = undefined;
			};
		},

		tapIndex(transform) {
			indexTaps.push(transform);
			return () => {
				const at = indexTaps.indexOf(transform);
				if (at !== -1) indexTaps.splice(at, 1);
			};
		},

		applyIndexTaps(html) {
			let out = html;
			for (const transform of indexTaps) out = transform(out);
			return out;
		},

		/** Longest-prefix-wins over the prefix table after an exact-table miss. */
		match(pathname) {
			const hit = exact.get(pathname);
			if (hit !== undefined) return hit;
			let best;
			for (const [prefix, route] of prefixes) {
				if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
				if (best === undefined || prefix.length > best.path.length) best = route;
			}
			return best;
		},

		fallbackHandler() {
			return fallback;
		},
	};
}
