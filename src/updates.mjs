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
		return { check: async () => {}, dispose() {} };
	}
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
			async check() {
				try {
					const result = await autoUpdater.checkForUpdates();
					logLine(`update check: ${result?.updateInfo?.version ?? 'up to date'}`);
				} catch (error) {
					logLine(`update check failed: ${String(error)}`);
				}
			},
			dispose() {
				autoUpdater.removeAllListeners('update-downloaded');
				autoUpdater.removeAllListeners('error');
			},
		};
	} catch (error) {
		logLine(`updater init failed: ${String(error)}`);
		return { check: async () => {}, dispose() {} };
	}
}
