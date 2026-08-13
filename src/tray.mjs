/**
 * System tray: keep the harness running with the window closed, one click to
 * bring the window back, and the quit gesture that actually exits the app.
 *
 * @module dsh-desktop/tray
 */
import { Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';

export function createTray({ app, onShow, onQuit, onCheckUpdates, logLine }) {
	let tray;
	try {
		const iconPath = join(app.getAppPath(), 'assets', 'tray.png');
		const icon = nativeImage.createFromPath(iconPath);
		tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
	} catch (error) {
		logLine(`tray icon failed: ${String(error)}`);
		return undefined;
	}
	tray.setToolTip('DeepSeek Harness Desktop');
	const rebuildMenu = () => {
		tray.setContextMenu(Menu.buildFromTemplate([
			{ label: '显示 DeepSeek Harness', click: () => onShow() },
			{ type: 'separator' },
			{ label: '检查更新…', click: () => void onCheckUpdates?.() },
			{ label: '退出', click: () => onQuit() },
		]));
	};
	rebuildMenu();
	tray.on('click', () => onShow());
	tray.on('double-click', () => onShow());
	return tray;
}
