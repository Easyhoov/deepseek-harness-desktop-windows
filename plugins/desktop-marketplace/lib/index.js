/**
 * @dsh-desktop/marketplace — host half.
 *
 * Catalog-first marketplace: a prebuilt catalog (GitHub Action collects and
 * classifies the dsh-plugin / deepseek-harness / dsh topic repos into
 * catalog/catalog.json) is fetched from raw.githubusercontent.com with a
 * 24h local cache — instant search, no GitHub rate limits, offline-capable.
 * The live npm registry search remains as a supplementary source. Install
 * resolves a GitHub repo's npm package name (its package.json), then runs
 * the bundled npm into the profile and mounts via ctx.loader.create.
 *
 * Inert on non-desktop hosts (desktopUi absent).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';

const name = 'desktop-marketplace';
const PKG_NAME_PATTERN = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const CATALOG_URL = process.env.DSH_MARKETPLACE_CATALOG_URL
	|| 'https://raw.githubusercontent.com/Easyhoov/deepseek-harness-desktop/main/catalog/catalog.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function apply(ctx) {
	const ui = ctx.get('desktopUi');
	if (ui === undefined) return;
	const loader = ctx.get('loader');

	let catalog = null;
	let catalogAt = 0;
	const cachePath = () => join(resolveDshHome(), 'marketplace-catalog.json');

	async function loadCatalog(force) {
		if (!force && catalog !== null && Date.now() - catalogAt < CACHE_TTL_MS) return catalog;
		// Disk cache first: offline / rate-limited runs still work.
		try {
			const onDisk = JSON.parse(readFileSync(cachePath(), 'utf8'));
			if (!force && Date.now() - Date.parse(onDisk.updatedAt ?? 0) < CACHE_TTL_MS) {
				catalog = onDisk;
				catalogAt = Date.now();
				return catalog;
			}
			catalog = onDisk; // stale fallback while we refresh
		} catch {
			/* no cache yet */
		}
		try {
			const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(15_000) });
			if (response.ok) {
				const data = await response.json();
				if (Array.isArray(data.repos)) {
					catalog = data;
					catalogAt = Date.now();
					try {
						writeFileSync(cachePath(), JSON.stringify(data), 'utf8');
					} catch {
						/* cache write is best-effort */
					}
				}
			}
		} catch {
			/* network unavailable: keep the stale/disk copy */
		}
		return catalog ?? { updatedAt: null, counts: {}, repos: [] };
	}

	async function searchNpm(query) {
		const text = query !== undefined && query !== '' ? query : 'dsh';
		const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=15`;
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
				topics: [],
				pushedAt: '',
				type: 'npm',
				score: 0,
			}));
	}

	const offSearch = ui.on('marketplace-search', async ({ query = '', type = 'recommended', sort = 'score' } = {}) => {
		const cat = await loadCatalog(false);
		let repos = cat.repos ?? [];
		const q = String(query ?? '').trim().toLowerCase();
		if (q !== '') {
			repos = repos.filter((repo) => `${repo.fullName} ${repo.description ?? ''} ${(repo.topics ?? []).join(' ')}`.toLowerCase().includes(q));
		}
		if (type !== 'recommended' && type !== 'all') {
			repos = repos.filter((repo) => repo.type === type);
		}
		if (sort === 'stars') repos = [...repos].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
		else if (sort === 'updated') repos = [...repos].sort((a, b) => String(b.pushedAt ?? '').localeCompare(String(a.pushedAt ?? '')));
		else repos = [...repos].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

		const catalogResults = repos.slice(0, 60).map((repo) => ({
			source: 'github',
			id: `gh:${repo.fullName}`,
			name: repo.fullName,
			description: repo.description ?? '',
			stars: repo.stars ?? 0,
			url: repo.htmlUrl ?? '',
			topics: (repo.topics ?? []).slice(0, 5),
			pushedAt: repo.pushedAt ?? '',
			type: repo.type ?? 'plugin',
			score: repo.score ?? 0,
			defaultBranch: repo.defaultBranch ?? 'main',
		}));

		const npmResults = q !== '' ? await searchNpm(q) : [];
		return {
			ok: true,
			results: [...npmResults, ...catalogResults],
			counts: cat.counts ?? {},
			updatedAt: cat.updatedAt ?? null,
		};
	});

	const offResolve = ui.on('marketplace-resolve-package', async ({ fullName, defaultBranch } = {}) => {
		if (typeof fullName !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(fullName)) return { ok: false, reason: 'invalid repository' };
		for (const branch of [defaultBranch, 'main', 'master']) {
			if (typeof branch !== 'string' || branch === '') continue;
			try {
				const response = await fetch(`https://raw.githubusercontent.com/${fullName}/${branch}/package.json`, {
					signal: AbortSignal.timeout(10_000),
				});
				if (response.status === 404) continue;
				if (!response.ok) break;
				const pkg = await response.json();
				if (typeof pkg.name === 'string' && PKG_NAME_PATTERN.test(pkg.name)) return { ok: true, name: pkg.name };
				break;
			} catch {
				break;
			}
		}
		return { ok: false, reason: 'not an npm package' };
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
		offResolve();
		offInstall();
		offInstalled();
	}, 'desktop-marketplace lifecycle');
}

export { name };
