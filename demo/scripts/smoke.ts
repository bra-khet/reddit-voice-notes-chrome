/*
 * Phase 1 smoke test — proves the shared voice brain runs end-to-end.
 *
 * Run:  npm run smoke   (bundles with esbuild → node; see package.json)
 *
 * Verifies that, for the SAME inputs the extension uses, the resolver + renderer
 * produce a real FFmpeg artifact — i.e. the preview=bake graph path works outside
 * the extension with no edits.
 *
 * CHANGED (Track D Phase 0): imports moved from demo/src/voice/* to the repo-root
 * src/voice/* they used to be copied from. esbuild resolves these relative paths
 * directly, so this file does not go through the "@" alias.
 */
import { resolveVoiceGraph } from '../../src/voice/dsp/resolve-graph';
import { buildStylizedGraph } from '../../src/voice/dsp/build-stylized-graph';
import { CHARACTER_PRESETS } from '../../src/voice/dsp/preset-graphs';
import { normalizeVoiceEffectConfig } from '../../src/voice/types';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// 1. Every character preset resolves + builds to a non-empty FFmpeg artifact.
for (const preset of CHARACTER_PRESETS) {
  const cfg = normalizeVoiceEffectConfig({
    enabled: true,
    characterPresetId: preset.id,
    intensity: preset.intensity,
  });
  const result = buildStylizedGraph(resolveVoiceGraph(cfg));
  const artifact = result.af ?? result.filterComplex ?? '';
  check(
    `preset ${preset.id}`,
    result.mode !== 'none' && artifact.length > 0,
    `${result.mode} (${result.stages.length} stages): ${artifact.slice(0, 56)}…`,
  );
}

// 2. The design-doc smoke example: incognito @ intensity 7.
const incognito = buildStylizedGraph(
  resolveVoiceGraph(
    normalizeVoiceEffectConfig({ enabled: true, characterPresetId: 'incognito', intensity: 7 }),
  ),
);
check('incognito@7 is active', incognito.mode !== 'none');

// 3. Voice-off resolves to a no-op (no FFmpeg pass).
const off = buildStylizedGraph(resolveVoiceGraph(normalizeVoiceEffectConfig({ enabled: false })));
check('voice-off → none', off.mode === 'none');

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
