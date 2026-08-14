// End-to-end test for the dsh overlay channel: install the official release
// into a given userData dir with the bundled npm under Electron's own Node.
// Usage: ELECTRON_RUN_AS_NODE=1 electron scripts/test-overlay.mjs <userData> [version]
import { installDshOverlay, overlayVersion, activeDshVersion, bundledDshVersion } from '../src/dsh-overlay.mjs';

const [, , userData, versionArg] = process.argv;
if (userData === undefined) {
	console.error('usage: ELECTRON_RUN_AS_NODE=1 electron scripts/test-overlay.mjs <userData> [version]');
	process.exit(2);
}
const version = versionArg ?? '0.1.0-rc.6';
console.log(`bundled: ${bundledDshVersion()}, installing ${version} → ${userData}`);
const result = await installDshOverlay(userData, version, { logLine: (line) => console.log(`[npm] ${line}`) });
console.log('result:', JSON.stringify(result));
console.log(`overlay version now: ${overlayVersion(userData)}`);
console.log(`active version now: ${activeDshVersion(userData)}`);
process.exit(result.ok ? 0 : 1);
