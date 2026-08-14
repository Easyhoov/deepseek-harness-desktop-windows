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

	const offSearch = ui.on('dsh:marketplace-search', async ({ query = '', type = 'recommended', sort = 'score' } = {}) => {
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

	// Registry metadata for one package name; used both to reject placeholders
	// and to power the in-app detail view. `reachable:false` means the registry
	// call itself failed (network), `published:false` means the name exists but
	// nothing can be installed.
	async function fetchNpmInfo(name) {
		try {
			const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
				headers: { accept: 'application/vnd.npm.install-v1+json' },
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) return { reachable: true, published: false };
			const data = await response.json();
			const tags = data['dist-tags'];
			const latest = tags !== null && typeof tags === 'object' && typeof tags.latest === 'string' ? tags.latest : null;
			const versions = data.versions !== null && typeof data.versions === 'object' ? Object.keys(data.versions).length : 0;
			return {
				reachable: true,
				published: latest !== null || versions > 0,
				versions,
				latest,
				// abbreviated metadata has no per-version `time`; `modified` is the
				// registry's last-publish touch date, close enough for display.
				lastPublish: typeof data.modified === 'string' && data.modified !== '' ? data.modified : null,
			};
		} catch {
			return { reachable: false, published: false };
		}
	}

	// True only when the name is actually published to the npm registry with
	// at least one version — catches squatted/placeholder packages that exist
	// as names but can never be installed (e.g. the empty "open-design" name).
	async function verifyNpmPackage(name) {
		const info = await fetchNpmInfo(name);
		return info.reachable && info.published;
	}

	function branchCandidates(defaultBranch) {
		const branches = [];
		for (const branch of [defaultBranch, 'main', 'master']) {
			if (typeof branch === 'string' && branch !== '' && branches.indexOf(branch) === -1) branches.push(branch);
		}
		return branches;
	}

	// raw.githubusercontent.com is unstable from some networks (CN in
	// particular). On any failure there we fall back to the GitHub contents
	// API with a raw Accept header; 404 semantics are preserved for callers.
	async function fetchRepoFile(fullName, branch, path) {
		let response;
		try {
			response = await fetch(`https://raw.githubusercontent.com/${fullName}/${branch}/${path}`, {
				signal: AbortSignal.timeout(6_000),
			});
			if (response.status !== 404 && !response.ok) throw new Error(`raw ${response.status}`);
			if (response.status !== 404) return response;
		} catch {
			/* raw unreachable — try the API */
		}
		response = await fetch(`https://api.github.com/repos/${fullName}/contents/${path}?ref=${encodeURIComponent(branch)}`, {
			headers: { accept: 'application/vnd.github.raw+json', 'user-agent': 'dsh-desktop-marketplace' },
			signal: AbortSignal.timeout(10_000),
		});
		return response;
	}

	const offResolve = ui.on('dsh:marketplace-resolve-package', async ({ fullName, defaultBranch } = {}) => {
		if (typeof fullName !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(fullName)) return { ok: false, reason: 'invalid' };
		for (const branch of branchCandidates(defaultBranch)) {
			let pkg;
			try {
				const response = await fetchRepoFile(fullName, branch, 'package.json');
				if (response.status === 404) continue; // branch has no package.json — try the next one
				if (!response.ok) return { ok: false, reason: 'network' };
				pkg = await response.json();
			} catch {
				return { ok: false, reason: 'network' }; // unreachable (common CN network case)
			}
			if (typeof pkg.name !== 'string' || !PKG_NAME_PATTERN.test(pkg.name)) return { ok: false, reason: 'not-npm' };
			if (pkg.private === true) return { ok: false, reason: 'private', name: pkg.name }; // app/private repo, never published
			if (!(await verifyNpmPackage(pkg.name))) return { ok: false, reason: 'unpublished', name: pkg.name }; // name exists but nothing to install
			return { ok: true, name: pkg.name };
		}
		return { ok: false, reason: 'not-npm' };
	});

	// One repository's detail payload for the in-app detail view: npm publish
	// status plus the README body. Every piece degrades independently.
	const offDetail = ui.on('dsh:marketplace-detail', async ({ fullName, defaultBranch } = {}) => {
		if (typeof fullName !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(fullName)) return { ok: false, reason: 'invalid' };
		const branches = branchCandidates(defaultBranch);

		// 1. package.json + npm registry status
		const pkgInfo = { name: null, private: false, published: false, versions: null, latest: null, lastPublish: null, error: null };
		for (const branch of branches) {
			let pkg;
			try {
				const response = await fetchRepoFile(fullName, branch, 'package.json');
				if (response.status === 404) continue;
				if (!response.ok) { pkgInfo.error = 'network'; break; }
				pkg = await response.json();
			} catch {
				pkgInfo.error = 'network';
				break;
			}
			if (typeof pkg.name !== 'string' || !PKG_NAME_PATTERN.test(pkg.name)) { pkgInfo.error = 'not-npm'; break; }
			pkgInfo.name = pkg.name;
			if (pkg.private === true) { pkgInfo.private = true; pkgInfo.error = 'private'; break; }
			const info = await fetchNpmInfo(pkg.name);
			if (!info.reachable) { pkgInfo.error = 'network'; break; }
			pkgInfo.published = info.published;
			pkgInfo.versions = info.versions;
			pkgInfo.latest = info.latest;
			pkgInfo.lastPublish = info.lastPublish;
			if (!info.published) pkgInfo.error = 'unpublished';
			break;
		}
		if (pkgInfo.name === null && pkgInfo.error === null) pkgInfo.error = 'not-npm';

		// 2. README (common filenames, first non-empty wins)
		let readme = null;
		for (const branch of branches) {
			for (const file of ['README.md', 'readme.md', 'README.MD', 'Readme.md', 'README']) {
				try {
					const response = await fetchRepoFile(fullName, branch, file);
					if (response.status === 404) continue;
					if (!response.ok) break;
					const text = await response.text();
					if (String(text).trim() !== '') { readme = text; break; }
				} catch {
					break;
				}
			}
			if (readme !== null) break;
		}

		return { ok: true, pkg: pkgInfo, readme };
	});

	const offInstall = ui.on('dsh:marketplace-install', async ({ pkg } = {}) => {
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

	const offInstalled = ui.on('dsh:marketplace-installed', () => {
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
		offDetail();
		offInstall();
		offInstalled();
	}, 'desktop-marketplace lifecycle');
}

export { name };
