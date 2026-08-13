/**
 * Rasterize the official DSH favicon (DeepSeek whale) into PNG icons.
 *
 * Usage: electron scripts/rasterize.mjs <svg> <size> <out.png>
 *
 * The shipped favicon paints the whale white in dark mode and black in light
 * mode; for an app icon this script pins the brand blue (#4D6BFE) and renders
 * the SVG at any requested pixel size through an offscreen Chromium window,
 * which keeps the vector path identical to the official Web GUI's favicon.
 */
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , svgPath, sizeArg, outPath] = process.argv;
const size = Number.parseInt(sizeArg, 10);
if (!svgPath || !Number.isFinite(size) || !outPath) {
	console.error('usage: electron scripts/rasterize.mjs <svg> <size> <out.png>');
	app.exit(2);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
	try {
		let svg = readFileSync(svgPath, 'utf8');
		// Pin the official light-mode look: the DeepSeek Harness black whale.
		svg = svg.replace(/<style>[\s\S]*?<\/style>/, '<style>path { fill: #000000; }</style>');
		svg = svg.replace(/width="50\.000000" height="50\.000000"/, `width="${size}" height="${size}"`);
		const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
		const win = new BrowserWindow({
			show: false,
			width: size,
			height: size,
			frame: false,
			transparent: true,
			webPreferences: { offscreen: false, backgroundThrottling: false },
		});
		await win.loadURL(url);
		await new Promise((resolve) => setTimeout(resolve, 800));
		const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
		writeFileSync(outPath, image.toPNG());
		console.log(`wrote ${outPath} (${size}x${size})`);
		app.exit(0);
	} catch (error) {
		console.error(String(error));
		app.exit(1);
	}
});
