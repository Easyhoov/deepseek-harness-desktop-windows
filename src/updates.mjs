/**
 * electron-updater wiring: auto-download in the background, a visible
 * installer during the install phase, progress pushed to the renderer, a
 * tray "check updates" gesture, and a notification when an update is ready.
 * Only active in packaged builds; the update server comes from the builder's
 * publish configuration (generic provider, env-overridable).
 *
 * Phases emitted through onProgress: checking / downloading {version,percent}
 * / ready {version} / uptodate / error {message}.
 *
 * @module dsh-desktop/updates
 */
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;

export function installUpdater({ app, notify, logLine, onProgress }) {
	const emit = (phase, payload) => {
		try {
			onProgress?.({ phase, ...(payload ?? {}) });
		} catch {
			/* best effort */
		}
	};
	if (!app.isPackaged) {
		return {
			check: async () => ({ found: null, error: 'development build' }),
			checkSoon() {},
			consumeDownloaded: () => null,
			installNow() {},
			dispose() {},
		};
	}
	let inProgress = false;
	let started = false;
	let downloadedVersion = null;
	let downloadingVersion = null;

	const check = async () => {
		if (inProgress) return { found: null, error: 'check already running' };
		inProgress = true;
		try {
			const result = await autoUpdater.checkForUpdates();
			const version = result?.updateInfo?.version ?? null;
			logLine(`update check: ${version ?? 'none'}`);
			return { found: version !== null && version !== app.getVersion() ? version : null, error: null };
		} catch (error) {
			logLine(`update check failed: ${String(error)}`);
			return { found: null, error: String(error?.message ?? error) };
		} finally {
			inProgress = false;
		}
	};

	try {
		autoUpdater.autoDownload = true;
		// Install is handled in the app's before-quit with a visible installer
		// UI (isSilent=false), so the user sees the update actually installing.
		autoUpdater.autoInstallOnAppQuit = false;
		autoUpdater.on('checking-for-update', () => emit('checking'));
		autoUpdater.on('update-available', (info) => {
			downloadingVersion = info.version;
			emit('downloading', { version: info.version });
		});
		autoUpdater.on('update-not-available', () => emit('uptodate'));
		autoUpdater.on('download-progress', (progress) => {
			emit('downloading', { version: downloadingVersion ?? undefined, percent: Math.round(progress.percent ?? 0) });
		});
		autoUpdater.on('update-downloaded', (info) => {
			downloadedVersion = info.version;
			emit('ready', { version: info.version });
			logLine(`update ready: ${info.version}`);
			notify?.('DSH · 更新已就绪', `版本 ${info.version} 已下载，退出应用时自动安装`);
		});
		autoUpdater.on('error', (error) => {
			logLine(`updater: ${String(error)}`);
			emit('error', { message: String(error?.message ?? error) });
		});
		return {
			check,
			// One delayed background check after boot so updates surface without
			// the user ever clicking the menu entry.
			checkSoon(delayMs = 25_000) {
				if (started) return;
				started = true;
				setTimeout(() => {
					void check();
				}, delayMs);
			},
			/** One-shot read of the downloaded version; clears the flag. */
			consumeDownloaded() {
				const version = downloadedVersion;
				downloadedVersion = null;
				return version;
			},
			/** Quit and run the installer visibly; relaunch the app afterwards. */
			installNow() {
				try {
					autoUpdater.quitAndInstall(false, true);
				} catch (error) {
					logLine(`quitAndInstall failed: ${String(error)}`);
				}
			},
			dispose() {
				autoUpdater.removeAllListeners('checking-for-update');
				autoUpdater.removeAllListeners('update-available');
				autoUpdater.removeAllListeners('update-not-available');
				autoUpdater.removeAllListeners('download-progress');
				autoUpdater.removeAllListeners('update-downloaded');
				autoUpdater.removeAllListeners('error');
			},
		};
	} catch (error) {
		logLine(`updater init failed: ${String(error)}`);
		return {
			check: async () => ({ found: null, error: String(error?.message ?? error) }),
			checkSoon() {},
			consumeDownloaded: () => null,
			installNow() {},
			dispose() {},
		};
	}
}
