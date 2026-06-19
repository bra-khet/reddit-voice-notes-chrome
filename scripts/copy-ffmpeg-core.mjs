import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = join(root, 'public', 'ffmpeg');

const coreSourceDir = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const ffmpegEsmSourceDir = join(root, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm');

function copyDirRecursive(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (entry.isFile() && !entry.name.endsWith('.ts')) {
      cpSync(from, to);
    }
  }
}

mkdirSync(targetDir, { recursive: true });

cpSync(join(coreSourceDir, 'ffmpeg-core.js'), join(targetDir, 'ffmpeg-core.js'));
cpSync(join(coreSourceDir, 'ffmpeg-core.wasm'), join(targetDir, 'ffmpeg-core.wasm'));

// BUG FIX: FFmpeg worker hung at 0% — lone worker.js blob missed sibling ESM modules.
// Fix: Copy the full @ffmpeg/ffmpeg dist/esm tree so ./const.js imports resolve at runtime.
copyDirRecursive(ffmpegEsmSourceDir, join(targetDir, 'esm'));

console.log('Copied ffmpeg-core + full @ffmpeg/ffmpeg esm bundle to public/ffmpeg/');