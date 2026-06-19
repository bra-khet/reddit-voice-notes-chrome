import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const targetDir = join(root, 'public', 'ffmpeg');

mkdirSync(targetDir, { recursive: true });
const workerSource = join(root, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm', 'worker.js');

cpSync(join(sourceDir, 'ffmpeg-core.js'), join(targetDir, 'ffmpeg-core.js'));
cpSync(join(sourceDir, 'ffmpeg-core.wasm'), join(targetDir, 'ffmpeg-core.wasm'));
cpSync(workerSource, join(targetDir, 'worker.js'));

console.log('Copied ffmpeg-core + worker assets to public/ffmpeg/');