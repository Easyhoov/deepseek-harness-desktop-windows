/**
 * Desktop site preparation: materialize the built frontend dist beside the
 * user data directory, run the official index taps (boot manifest + theme
 * bootstrap) through the in-process webServer, and rebase every URL for
 * `file://` (or an optional `app://` scheme).
 *
 * Plugin bundles are copied to `__plugins/<id>/client.js` and the boot
 * manifest's `url` fields rewritten to match, so the client module system
 * loads them as plain classic scripts from disk — no protocol interception
 * and no server.
 *
 * @module dsh-desktop/site
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, statSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';

/** node_modules is fully asar-unpacked: rewrite archive paths to real files. */
function unpacked(path) {
	const marker = `${sep}app.asar${sep}`;
	const unpackedMarker = `${sep}app.asar.unpacked${sep}`;
	if (path.includes(marker) && !path.includes(unpackedMarker)) {
		return path.replace(marker, unpackedMarker);
	}
	return path;
}

function distIndexPath() {
	try {
		return unpacked(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'));
	} catch {
		throw new Error('dsh-desktop: frontend dist not built; install @deepseek-ai/dsh-web-frontend');
	}
}

function copyIfChanged(source, dest) {
	try {
		const s = statSync(source);
		try {
			const d = statSync(dest);
			if (d.size === s.size && d.mtimeMs === s.mtimeMs) return false;
		} catch {
			/* dest missing: copy below */
		}
		mkdirSync(dirname(dest), { recursive: true });
		copyFileSync(source, dest);
	} catch (error) {
		if (error?.code === 'ENOENT') return false;
		throw error;
	}
	return true;
}

/**
 * @param {object} options
 * @param {object} options.webServer - in-process webServer stub (owns applyIndexTaps).
 * @param {object} options.clientModules - the client module registry service.
 * @param {string} options.wwwDir - target directory for the materialized site.
 * @param {string} [options.scheme] - 'file' (relative URLs) or 'app' (absolute).
 * @returns {{ indexPath: string, graph: object }} the index to load and the boot graph.
 */
export function prepareSite({ webServer, clientModules, wwwDir, scheme = 'file' }) {
	const distIndex = distIndexPath();
	const distDir = dirname(distIndex);

	// Materialize the dist tree (fonts, css, js, langs, manifest, favicon).
	cpSync(distDir, wwwDir, {
		recursive: true,
		filter: (src) => src !== distIndex,
	});

	// Official index pipeline: boot manifest (client-modules) + theme tap.
	let html = readFileSync(distIndex, 'utf8');
	html = webServer.applyIndexTaps(html);

	if (scheme === 'file') {
		// file:// has a null origin: rebase every absolute URL to relative.
		html = html.replace(/\/assets\//g, './assets/');
		html = html.replace(/href="\/favicon\.svg"/g, 'href="./favicon.svg"');
		html = html.replace(/href="\/manifest\.webmanifest"/g, 'href="./manifest.webmanifest"');
		html = html.replace(/\/plugins\//g, './__plugins/');
	} else {
		// app:// is a standard origin: keep absolute paths, just repoint bundles.
		html = html.replace(/\/plugins\//g, '/__plugins/');
	}
	// file URLs need no cache-busting query.
	html = html.replace(/(client\.js)\?rev=[0-9a-f]{12}/g, '$1');
	writeFileSync(join(wwwDir, 'index.html'), html, 'utf8');

	// Materialize plugin bundles next to the site.
	const graph = clientModules.graph();
	for (const entry of graph.entries) {
		const clientPath = unpacked(clientModules.clientPath(entry.id) ?? '');
		if (clientPath === '') continue;
		const dest = join(wwwDir, '__plugins', ...entry.id.split('/'), 'client.js');
		copyIfChanged(clientPath, dest);
	}

	return {
		indexPath: join(wwwDir, 'index.html'),
		graph,
	};
}
