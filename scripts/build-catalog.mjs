/**
 * Marketplace catalog builder: collects GitHub repositories tagged for the
 * DSH ecosystem (dsh-plugin / deepseek-harness / dsh topics), classifies
 * them into types (plugin / skill / collection / channel / application /
 * infrastructure / directory), scores them for the "recommended" sort
 * (stars × recency), and writes catalog/catalog.json.
 *
 * Run by the `catalog` workflow on a schedule; GITHUB_TOKEN raises the
 * search rate limit. Local runs work unauthenticated (slower).
 *
 * Usage: node scripts/build-catalog.mjs [out.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const SEARCH_QUERIES = ['topic:dsh-plugin', 'topic:deepseek-harness', 'topic:dsh'];
const OUT = resolve(process.argv[2] ?? 'catalog/catalog.json');

const headers = {
	'User-Agent': 'dsh-desktop-catalog',
	Accept: 'application/vnd.github+json',
	...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function searchRepos(query) {
	const all = [];
	for (let page = 1; page <= 10; page += 1) {
		const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100&page=${page}`;
		const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
		if (!response.ok) {
			console.log(`search "${query}" page ${page}: HTTP ${response.status} — stopping`);
			break;
		}
		const data = await response.json();
		const items = data.items ?? [];
		all.push(...items);
		if (items.length < 100) break;
	}
	return all;
}

function classify(repo) {
	const topics = (repo.topics ?? []).map((t) => t.toLowerCase());
	const hay = `${repo.name} ${repo.description ?? ''} ${topics.join(' ')}`.toLowerCase();
	if (/skill/.test(hay) || repo.name.startsWith('dsh-skill') || repo.name.endsWith('-skills')) return 'skill';
	if (/(awesome|合集|collection)/.test(hay)) return 'collection';
	if (/(awesome|directory|index|目录|索引)/.test(hay)) return 'directory';
	if (/(微信|wechat|telegram|飞书|钉钉|discord|channel|bridge|渠道|适配|im-)/.test(hay)) return 'channel';
	if (/(desktop|tui|客户端|electron|tauri|\bapp\b)/.test(hay)) return 'application';
	if (/(infrastructure|framework|\bsdk\b|runtime|基础|脚手架)/.test(hay)) return 'infrastructure';
	return 'plugin';
}

/** Recommended score: log-stars × 10 plus a 90-point recency component. */
function scoreOf(stars, pushedAt) {
	const days = Math.max(0, (Date.now() - Date.parse(pushedAt)) / 86_400_000);
	return Math.round((Math.log10(stars + 1) * 10 + Math.max(0, 90 - days / 7)) * 100) / 100;
}

const byName = new Map();
for (const query of SEARCH_QUERIES) {
	const repos = await searchRepos(query);
	console.log(`"${query}": ${repos.length} repos`);
	for (const repo of repos) {
		if (repo.archived || repo.disabled) continue;
		byName.set(repo.full_name, repo);
	}
}

const repos = [...byName.values()].map((repo) => ({
	fullName: repo.full_name,
	owner: repo.owner?.login ?? repo.full_name.split('/')[0],
	name: repo.name,
	description: repo.description ?? '',
	topics: repo.topics ?? [],
	stars: repo.stargazers_count ?? 0,
	pushedAt: repo.pushed_at ?? repo.updated_at ?? '',
	defaultBranch: repo.default_branch ?? 'main',
	language: repo.language ?? null,
	htmlUrl: repo.html_url,
	homepage: repo.homepage ?? '',
	type: classify(repo),
})).map((entry) => ({ ...entry, score: scoreOf(entry.stars, entry.pushedAt) }))
	.sort((a, b) => b.score - a.score);

const counts = {};
for (const repo of repos) counts[repo.type] = (counts[repo.type] ?? 0) + 1;

const catalog = {
	updatedAt: new Date().toISOString(),
	counts,
	repos,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(catalog, null, 1)}\n`, 'utf8');
console.log(`wrote ${OUT}: ${repos.length} repos, counts=${JSON.stringify(counts)}`);
