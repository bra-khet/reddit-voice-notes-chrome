#!/usr/bin/env node
// v6.0 visual entropy gate: inspect real 120-second base+baked MP4 artifacts.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import {
  evaluateVisualSizeQa,
  formatVisualSizeQaReport,
} from './visual-size-qa-core.mjs';

const USAGE = `Usage:
  npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]

Records PASS only when both real artifacts are approximately 120 seconds,
base is <=25 MiB, baked is <=30 MiB, and their durations agree within 0.1 s.`;

function parseArgs(args) {
  const parsed = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--preset' || arg === '--base' || arg === '--baked') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      parsed[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function inspectMp4(filePath) {
  const absolutePath = resolve(filePath);
  const bytes = await readFile(absolutePath);
  const blob = new Blob([bytes], { type: 'video/mp4' });
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('no video track found');
    const durationSeconds = await videoTrack.computeDuration();
    return { path: absolutePath, sizeBytes: bytes.byteLength, durationSeconds };
  } finally {
    input.dispose();
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!options.preset || !options.base || !options.baked) {
    throw new Error('--preset, --base, and --baked are all required.');
  }

  const [base, baked] = await Promise.all([
    inspectMp4(options.base),
    inspectMp4(options.baked),
  ]);
  const report = evaluateVisualSizeQa({ preset: options.preset, base, baked });
  console.log(options.json ? JSON.stringify(report, null, 2) : formatVisualSizeQaReport(report));
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Visual size QA could not run: ${detail}\n\n${USAGE}`);
  process.exitCode = 2;
}
