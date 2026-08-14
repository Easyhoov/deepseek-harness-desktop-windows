/**
 * @dsh-desktop/marketplace — host half.
 *
 * Search surface: the GitHub `dsh-plugin` topic (stars-sorted) plus the npm
 * registry, aggregated into one result list. Install: bundled npm into the
 * profile directory, then a runtime `ctx.loader.create` mount — the host
 * half goes live immediately and the client half appears after a UI reload
 * (new client bundles are outside the current page's boot graph).
 *
 * Inert on non-desktop hosts (desktopUi absent).
 */
const name = 'desktop-marketplace';
const PKG_NAME_PATTERN = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function apply(ctx) {
	const ui = ctx.get('desktopUi');
	if (ui === undefined) return;
	const loader = ctx.get('loader');

	async function searchGitHub(query) {
		const q = query !== undefined && query !== '' ? `topic:dsh-plugin ${query}` : 'topic:dsh-plugin';
		const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`;
		const response = await fetch(url, {
			headers: { 'User-Agent': 'dsh-desktop', Accept: 'application/vnd.github+json' },
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok) return [];
		const data = await response.json();
		return (data.items ?? []).map((item) => ({
			source: 'github',
			id: `gh:${item.full_name}`,
			name: item.full_name,
			description: item.description ?? '',
			stars: item.stargazers_count ?? 0,
			url: item.html_url ?? '',
		}));
	}

	async function searchNpm(query) {
		const text = query !== undefined && query !== '' ? query : 'dsh';
		const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=20`;
		const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
		if (!response.ok) return [];
		const data = await response.json();
		return (data.objects ?? [])
			.filter((o) => /dsh|deepseek|harness/i.test(`${o.package?.name ?? ''} ${o.package?.description ?? ''}`))
			.map((o) => ({
				source: 'npm',
				id: `npm:${o.package.name}`,
				name: o.package.name,
				description: o.package.description ?? '',
				stars: null,
				url: o.package.links?.npm ?? '',
			}));
	}

	const offSearch = ui.on('marketplace-search', async ({ query } = {}) => {
		const [github, npm] = await Promise.allSettled([searchGitHub(query), searchNpm(query)]);
		const results = [
			...(github.status === 'fulfilled' ? github.value : []),
			...(npm.status === 'fulfilled' ? npm.value : []),
		];
		return { ok: true, results };
	});

	const offInstall = ui.on('marketplace-install', async ({ pkg } = {}) => {
		if (typeof pkg !== 'string' || !PKG_NAME_PATTERN.test(pkg)) return { ok: false, reason: 'invalid package name' };
		if (typeof ui.profileDir !== 'string' || ui.profileDir === '') return { ok: false, reason: 'profile directory unknown' };
		if (typeof ui.npm !== 'function') return { ok: false, reason: 'npm runner unavailable' };
		const res = await ui.npm(['install', '--prefix', ui.profileDir, '--no-save', pkg]);
		if (res.code !== 0) {
			const tail = (res.stderr || res.stdout || 'npm failed').trim().split('\n').slice(-6).join(' ');
			return { ok: false, reason: tail.slice(-500) };
		}
		try {
			if (loader !== undefined) await loader.create({ name: pkg });
			return { ok: true, mounted: true, note: '已安装并挂载宿主；界面新元素刷新后生效' };
		} catch (error) {
			return { ok: true, mounted: false, note: `已安装，但运行时挂载失败（重启后生效）：${String(error?.message ?? error)}` };
		}
	});

	const offInstalled = ui.on('marketplace-installed', () => {
		const names = [];
		if (loader !== undefined) {
			for (const entry of loader.entries()) names.push(entry.options.name);
		}
		return {
			ok: true,
			installed: names.filter((n) => !n.startsWith('@deepseek-ai/') && !n.startsWith('@dsh-desktop/')),
		};
	});

	ctx.effect(() => () => {
		offSearch();
		offInstall();
		offInstalled();
	}, 'desktop-marketplace lifecycle');
}

export { name };
