// Records a short demo of the simulator: speed it up, kill a node, watch the cluster
// suspect it and converge on "dead". Writes docs/demo.webm, plus docs/demo.mp4 and
// docs/demo.gif when ffmpeg is on PATH.
//
// Usage: node scripts/record-demo.mjs [url]   (default: the live demo)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'https://nazarii-piontko.github.io/gossip-visualizer/';
const OUT_DIR = 'docs';
const SIZE = { width: 1280, height: 800 };
const TICK_MS = 300;
const KILLED_NODE = 3;

const tmp = mkdtempSync(join(tmpdir(), 'gossip-demo-'));
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: tmp, size: SIZE } });
const recordingStart = Date.now();
const page = await context.newPage();
await page.goto(URL);
await page.getByTestId('node').first().waitFor();
// the video starts with a blank page; remember where the real content begins
const trimSec = (Date.now() - recordingStart) / 1000;

await page.locator('.controls input[type=range]').first().fill(String(TICK_MS));
await page.waitForTimeout(3000);
await page.getByTestId('node').nth(KILLED_NODE).click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Kill' }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'close' }).click();
await page.waitForTimeout(22000);

const webm = join(OUT_DIR, 'demo.webm');
await context.close(); // finalizes the video file
await page.video().saveAs(webm);
await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${webm}`);

const ffmpeg = (...args) => spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error) {
  console.warn('ffmpeg not found: skipping mp4/gif conversion');
  process.exit(0);
}
const trimmed = ['-ss', trimSec.toFixed(2), '-i', webm];

ffmpeg(...trimmed, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart',
  join(OUT_DIR, 'demo.mp4'));
console.log(`wrote ${join(OUT_DIR, 'demo.mp4')}`);

// two-pass palette: far better colors than ffmpeg's default GIF palette
ffmpeg(...trimmed, '-vf',
  'fps=15,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
  '-loop', '0', join(OUT_DIR, 'demo.gif'));
console.log(`wrote ${join(OUT_DIR, 'demo.gif')}`);
