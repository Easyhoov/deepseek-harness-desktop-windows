/**
 * electron-updater wiring: auto-download in the background, install on quit,
 * a tray "check updates" gesture, and a notification when an update is ready.
 * Only active in packaged builds; the update server comes from the builder's
 * publish configuration (generic provider, env-overridable).
 *
 * @module dsh-desktop/updates
 */
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;

export function installUpdater({ app, notify, logLine }) {
	if (!app.isPackaged) {
		return {
			check: async () => ({ found: null, error: 'development build' }),
			checkSoon() {},
			dispose() {},
		};
	}
	let inProgress = false;
	let started = false;
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
		autoUpdater.autoInstallOnAppQuit = true;
		autoUpdater.on('update-downloaded', (info) => {
			logLine(`update ready: ${info.version}`);
			notify?.('DSH · 更新已就绪', `版本 ${info.version} 已下载，退出应用时自动安装`);
		});
		autoUpdater.on('error', (error) => {
			logLine(`updater: ${String(error)}`);
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
			dispose() {
				autoUpdater.removeAllListeners('update-downloaded');
				autoUpdater.removeAllListeners('error');
			},
		};
	} catch (error) {
		logLine(`updater init failed: ${String(error)}`);
		return {
			check: async () => ({ found: null, error: String(error?.message ?? error) }),
			checkSoon() {},
			dispose() {},
		};
	}
}
