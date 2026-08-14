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

	// A real dsh plugin bundle declares a patch layer under `dsh.bundle`.
	const isBundle = (pkg) => Boolean(pkg?.dsh && pkg.dsh.bundle && typeof pkg.dsh.bundle.patch === 'string');

	// Some repos ship a one-line installer instead of an npm bundle.
	async function detectInstallScript(fullName, branches) {
		for (const file of ['install.sh', 'install.ps1']) {
			for (const branch of branches) {
				try {
					const response = await fetchRepoFile(fullName, branch, file);
					if (response.status === 404) continue;
					if (!response.ok) break;
					if (file === 'install.sh') return { command: `curl -fsSL https://raw.githubusercontent.com/${fullName}/${branch}/install.sh | bash`, script: file };
					return { command: `irm https://raw.githubusercontent.com/${fullName}/${branch}/install.ps1 | iex`, script: file };
				} catch {
					break;
				}
			}
		}
		return null;
	}

	// Monorepo bundles: when the repo root is not itself a bundle, look for a
	// workspace subdirectory (packages/* etc.) whose package.json declares
	// dsh.bundle, so it can install via `github:repo#path:subdir`.
	async function findBundleSubdir(fullName, branches, workspaces) {
		const dirs = new Set();
		if (Array.isArray(workspaces)) {
			for (const glob of workspaces) {
				const m = /^([^/*]+)\/\*$/.exec(String(glob));
				if (m !== null && m[1] !== '') dirs.add(m[1]);
			}
		}
		for (const branch of branches) {
			try {
				const response = await fetchRepoFile(fullName, branch, 'pnpm-workspace.yaml');
				if (response.status === 404) continue;
				if (!response.ok) break;
				const text = await response.text();
				const re = /-\s*['"]?([^'"\s#*]+)\/\*/g;
				let mm;
				while ((mm = re.exec(text)) !== null) {
					if (mm[1] !== undefined && mm[1] !== '') dirs.add(mm[1]);
				}
				break;
			} catch {
				break;
			}
		}
		if (dirs.size === 0) dirs.add('packages');
		const branch = branches[0];
		let checked = 0;
		for (const dir of dirs) {
			let listing;
			try {
				const response = await fetch(`https://api.github.com/repos/${fullName}/contents/${dir}?ref=${encodeURIComponent(branch)}`, {
					headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-desktop-marketplace' },
					signal: AbortSignal.timeout(10_000),
				});
				if (!response.ok) continue;
				listing = await response.json();
			} catch {
				continue;
			}
			if (!Array.isArray(listing)) continue;
			for (const entry of listing) {
				if (entry.type !== 'dir' || checked++ > 12) continue;
				try {
					const response = await fetchRepoFile(fullName, branch, `${dir}/${entry.name}/package.json`);
					if (response.status === 404) continue;
					if (!response.ok) break;
					const pkg = await response.json();
					if (isBundle(pkg)) return `${dir}/${entry.name}`;
				} catch {
					/* skip this subdir */
				}
			}
		}
		return null;
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
			if (pkg.private === true) return { ok: false, reason: 'private', name: pkg.name };
			if (!isBundle(pkg)) return { ok: false, reason: 'not-bundle', name: pkg.name }; // not a dsh plugin bundle
			const info = await fetchNpmInfo(pkg.name);
			if (info.reachable && info.published) return { ok: true, source: pkg.name, method: 'npm', name: pkg.name };
			// Unpublished (or registry unreachable) bundle: install from git.
			return { ok: true, source: `github:${fullName}`, method: 'git', name: pkg.name };
		}
		return { ok: false, reason: 'not-npm' };
	});

	// One repository's detail payload for the in-app detail view: npm publish
	// status, the install method (npm/git/script/skill/mcp/app/manual), and the
	// README body. Every piece degrades independently.
	const offDetail = ui.on('dsh:marketplace-detail', async ({ fullName, defaultBranch, type, topics } = {}) => {
		if (typeof fullName !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(fullName)) return { ok: false, reason: 'invalid' };
		const branches = branchCandidates(defaultBranch);
		const topicList = Array.isArray(topics) ? topics.map((t) => String(t).toLowerCase()) : [];
		const catalogType = typeof type === 'string' ? type : 'plugin';
		const hasTopic = (...keys) => topicList.some((t) => keys.some((k) => t.includes(k)));

		// 1. package.json + npm registry status
		const pkgInfo = { name: null, private: false, published: false, versions: null, latest: null, lastPublish: null, error: null, bundle: false, workspaces: [] };
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
			pkgInfo.bundle = isBundle(pkg);
			pkgInfo.workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : [];
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

		// 2. Install method — authoritative for the detail-view actions.
		const isApp = catalogType === 'application' || topicList.indexOf('desktop-app') !== -1;
		const isSkill = catalogType === 'skill' || hasTopic('agent-skills', 'skill');
		const isMcp = hasTopic('mcp');
		let install;
		if (isApp) {
			install = { method: 'application', source: null, command: null, note: '独立应用，需到仓库页下载或构建' };
		} else if (pkgInfo.name !== null && pkgInfo.error !== 'network' && pkgInfo.error !== 'not-npm') {
			if (pkgInfo.bundle) {
				if (pkgInfo.published) {
					install = { method: 'npm', source: pkgInfo.name, command: `dsh plugin --profile web add ${pkgInfo.name}`, note: null };
				} else if (!pkgInfo.private) {
					install = { method: 'git', source: `github:${fullName}`, command: `dsh plugin --profile web add github:${fullName}`, note: '从 GitHub 安装（首次可能需在 pnpm-workspace.yaml 授权构建脚本）' };
				} else {
					install = { method: 'manual', source: null, command: null, note: '私有仓库，无法自动安装' };
				}
			} else if (!pkgInfo.private) {
				// Root isn't a bundle — the plugin may live in a monorepo subdir.
				const subdir = await findBundleSubdir(fullName, branches, pkgInfo.workspaces);
				if (subdir !== null) {
					install = { method: 'git', source: `github:${fullName}#path:${subdir}`, command: `dsh plugin --profile web add github:${fullName}#path:${subdir}`, note: 'monorepo 插件，从子目录安装（首次可能需授权构建脚本）' };
				} else if (isSkill) {
					install = { method: 'skill', source: null, command: null, note: '这是 Agent Skill，不是 DSH 插件：安装到 ~/.dsh/skills/<名字> 或项目 .dsh/skills/<名字>' };
				} else if (isMcp) {
					install = { method: 'mcp', source: null, command: null, note: '这是 MCP 服务，按仓库说明配置 MCP，而不是安装为 DSH 插件' };
				} else {
					const script = await detectInstallScript(fullName, branches);
					install = script !== null ? { method: 'script', source: null, command: script.command, note: '仓库提供一键安装脚本' } : { method: 'manual', source: null, command: null, note: '不是 npm 组合包，安装方式见仓库 README' };
				}
			} else if (isSkill) {
				install = { method: 'skill', source: null, command: null, note: '这是 Agent Skill，不是 DSH 插件：安装到 ~/.dsh/skills/<名字> 或项目 .dsh/skills/<名字>' };
			} else if (isMcp) {
				install = { method: 'mcp', source: null, command: null, note: '这是 MCP 服务，按仓库说明配置 MCP，而不是安装为 DSH 插件' };
			} else {
				const script = await detectInstallScript(fullName, branches);
				install = script !== null ? { method: 'script', source: null, command: script.command, note: '仓库提供一键安装脚本' } : { method: 'manual', source: null, command: null, note: '不是 npm 组合包，安装方式见仓库 README' };
			}
		} else if (isSkill) {
			install = { method: 'skill', source: null, command: null, note: '这是 Agent Skill，不是 DSH 插件：安装到 ~/.dsh/skills/<名字>' };
		} else if (isMcp) {
			install = { method: 'mcp', source: null, command: null, note: '这是 MCP 服务，按仓库说明配置 MCP' };
		} else {
			const script = await detectInstallScript(fullName, branches);
			install = script !== null ? { method: 'script', source: null, command: script.command, note: '仓库提供一键安装脚本' } : { method: 'manual', source: null, command: null, note: '安装方式见仓库 README' };
		}

		// 3. README (common filenames, first non-empty wins)
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

		return { ok: true, pkg: pkgInfo, install, readme };
	});

	// One install at a time; the task stays cancellable and streams its output
	// to the renderer (`dsh:marketplace-install-progress`), like the community
	// dsh-webui-market-plugin.
	let installTask = null;
	const offInstall = ui.on('dsh:marketplace-install', async ({ source } = {}) => {
		if (typeof source !== 'string' || source === '') return { ok: false, reason: 'invalid source' };
		if (typeof ui.dshPluginAdd !== 'function') return { ok: false, reason: 'dsh plugin runner unavailable' };
		if (installTask !== null) return { ok: false, reason: '另一个安装正在进行，请先等待或取消' };
		const push = (line) => {
			ui.send('dsh:marketplace-install-progress', { source, line: String(line).slice(0, 500) });
		};
		const task = ui.dshPluginAdd(source, {
			timeoutMs: 10 * 60 * 1000,
			onOutput: (chunk) => push(chunk),
		});
		installTask = { source, kill: task.kill };
		push('开始安装…');
		const res = await task.done;
		installTask = null;
		push(res.killed ? '安装超时，已中止' : `退出码 ${res.code}`);
		if (res.killed) return { ok: false, reason: '安装超时（10 分钟），已中止' };
		if (res.code !== 0) {
			const tail = (res.stderr || res.stdout || 'pnpm failed').trim().split('\n').slice(-8).join(' ');
			return { ok: false, reason: tail.slice(-600) };
		}
		return { ok: true, mounted: false, note: '已安装进 web profile，重启应用后生效' };
	});

	const offCancel = ui.on('dsh:marketplace-install-cancel', () => {
		if (installTask === null) return { ok: false, reason: '没有正在进行的安装' };
		installTask.kill();
		return { ok: true };
	});

	const offUninstall = ui.on('dsh:marketplace-uninstall', async ({ pkg } = {}) => {
		if (typeof pkg !== 'string' || pkg === '') return { ok: false, reason: 'invalid package' };
		if (typeof ui.dshPluginRemove !== 'function') return { ok: false, reason: 'dsh plugin runner unavailable' };
		const res = await ui.dshPluginRemove(pkg);
		if (res.code !== 0) {
			const tail = (res.stderr || res.stdout || 'pnpm failed').trim().split('\n').slice(-8).join(' ');
			return { ok: false, reason: tail.slice(-600) };
		}
		return { ok: true, note: '已卸载，重启应用后生效' };
	});

	const offInstalled = ui.on('dsh:marketplace-installed', () => {
		const names = [];
		if (loader !== undefined) {
			for (const entry of loader.entries()) names.push(entry.options.name);
		}
		// Reflect the profile manifest's bundle list too (official installs land
		// there and only mount on the next boot).
		if (typeof ui.profileDir === 'string' && ui.profileDir !== '') {
			try {
				const manifest = JSON.parse(readFileSync(join(ui.profileDir, 'package.json'), 'utf8'));
				for (const bundle of manifest.dsh?.profile?.bundles ?? []) {
					if (names.indexOf(bundle) === -1) names.push(bundle);
				}
			} catch {
				/* no profile manifest yet */
			}
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
		offCancel();
		offUninstall();
		offInstalled();
	}, 'desktop-marketplace lifecycle');
}

export { name };
