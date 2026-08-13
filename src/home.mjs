/**
 * Home resolution for the desktop app: env vars, a first-run choice dialog,
 * and a live `dsh web` instance conflict check.
 *
 * Precedence: DSH_DESKTOP_HOME > inherited DSH_HOME > saved choice > default
 * (an app-owned directory under userData). Choosing the CLI's shared home
 * (~/.dsh) is explicit and persisted; when it is in use, a live web-instance
 * probe warns about concurrent writers before boot.
 *
 * @module dsh-desktop/home
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { defaultDshHome } from '@deepseek-ai/dsh-home-paths';

const CONFIG_FILENAME = 'desktop-config.json';

function configPath(userData) {
	return `${userData}/${CONFIG_FILENAME}`;
}

function readSavedHome(userData) {
	try {
		const parsed = JSON.parse(readFileSync(configPath(userData), 'utf8'));
		return typeof parsed?.home === 'string' && parsed.home !== '' ? parsed.home : undefined;
	} catch {
		return undefined;
	}
}

function saveHome(userData, home) {
	mkdirSync(userData, { recursive: true });
	writeFileSync(configPath(userData), `${JSON.stringify({ home }, null, 2)}\n`, 'utf8');
}

/** Detect a live dsh web instance: matching node processes and/or a 3080 listener. */
function detectWebInstance(timeoutMs = 8000) {
	const script = [
		'$procs = @(Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Where-Object { $_.CommandLine -match \'deepseek-ai[\\\\/]dsh\' -and $_.CommandLine -match \'web\' })',
		'$listeners = @(Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq \'127.0.0.1\' -or $_.LocalAddress -eq \'0.0.0.0\' })',
		'Write-Output (($procs.Count -gt 0) -or ($listeners.Count -gt 0))',
	].join('; ');
	return new Promise((resolve) => {
		execFile(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-Command', script],
			{ windowsHide: true, timeout: timeoutMs },
			(error, stdout) => {
				if (error !== null) {
					resolve(undefined);
					return;
				}
				resolve(String(stdout).trim() === 'True');
			},
		);
	});
}

/**
 * Resolve the harness home for this run, asking the user on first launch.
 * @param {object} deps - electron app/dialog handles plus userData and logger.
 * @returns {Promise<{home: string, source: string}>}
 */
export async function resolveHome({ app, dialog, logLine }) {
	const userData = app.getPath('userData');
	const envHome = process.env.DSH_DESKTOP_HOME ?? '';
	if (envHome !== '') {
		return { home: envHome, source: 'DSH_DESKTOP_HOME' };
	}
	if (process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '') {
		return { home: process.env.DSH_HOME, source: 'DSH_HOME' };
	}
	const saved = readSavedHome(userData);
	if (saved !== undefined) {
		return { home: saved, source: 'saved' };
	}
	const sharedHome = defaultDshHome();
	const ownHome = `${userData}/dsh-home`;
	const choice = dialog.showMessageBoxSync({
		type: 'question',
		title: 'DeepSeek Harness Desktop · 首次启动',
		message: '选择数据目录',
		detail: '桌面版默认使用独立的数据目录（与命令行 dsh 隔离）。\n也可以复用 ~/.dsh，在桌面版里直接看到命令行创建的会话。',
		buttons: ['独立数据目录', '复用 ~/.dsh', '取消'],
		defaultId: 0,
		cancelId: 2,
		noLink: true,
	});
	if (choice === 2) {
		throw new Error('first-run home choice cancelled');
	}
	const home = choice === 1 ? sharedHome : ownHome;
	saveHome(userData, home);
	logLine(`home choice: ${home}`);
	return { home, source: choice === 1 ? 'shared' : 'own' };
}

/**
 * Warn when the shared CLI home is concurrently in use by a web instance.
 * @returns {Promise<{home: string, switched: boolean}>} the home to boot with.
 */
export async function guardSharedHome({ app, dialog, home, logLine }) {
	const sharedHome = defaultDshHome();
	if (home !== sharedHome) return { home, switched: false };
	const live = await detectWebInstance();
	if (live !== true) return { home, switched: false };
	logLine('detected a live dsh web instance while sharing ~/.dsh');
	const choice = dialog.showMessageBoxSync({
		type: 'warning',
		title: '检测到 dsh web 正在运行',
		message: '命令行 dsh web 实例正在使用同一个数据目录',
		detail: '两个进程同时写同一 home 有数据冲突风险。可以继续共用（例如准备关闭 web 实例），或本次改用独立数据目录。',
		buttons: ['仍要共用', '改用独立数据目录', '取消启动'],
		defaultId: 0,
		cancelId: 2,
		noLink: true,
	});
	if (choice === 2) throw new Error('startup cancelled: shared home in use');
	if (choice === 1) {
		const privateHome = `${app.getPath('userData')}/dsh-home`;
		saveHome(app.getPath('userData'), privateHome);
		logLine(`switched to private home after conflict: ${privateHome}`);
		return { home: privateHome, switched: true };
	}
	return { home, switched: false };
}

export { detectWebInstance };
