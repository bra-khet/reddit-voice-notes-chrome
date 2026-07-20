// CHANGED: one pure evaluator owns the v6 visual long-capture acceptance contract.
// WHY: every high-entropy preset needs identical duration and artifact-size gates.

export const VISUAL_SIZE_QA_EXPECTED_DURATION_SECONDS = 120;
export const VISUAL_SIZE_QA_MIN_DURATION_SECONDS = 118;
export const VISUAL_SIZE_QA_MAX_DURATION_SECONDS = 120.5;
export const VISUAL_SIZE_QA_MAX_DURATION_DRIFT_SECONDS = 0.1;
export const VISUAL_SIZE_QA_MIN_BYTES = 256;
// Sync: mirrors LAST_BASE/BAKED_MP4_MAX_BYTES (raised to 40 MiB, QA-6.0.0 Pass A §8-12).
export const VISUAL_SIZE_QA_BASE_MAX_BYTES = 40 * 1024 * 1024;
export const VISUAL_SIZE_QA_BAKED_MAX_BYTES = 40 * 1024 * 1024;

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function evaluateArtifact(label, artifact, maxBytes) {
  const failures = [];
  if (!Number.isFinite(artifact.sizeBytes) || artifact.sizeBytes < VISUAL_SIZE_QA_MIN_BYTES) {
    failures.push(`${label} artifact is empty or structurally too small.`);
  } else if (artifact.sizeBytes > maxBytes) {
    failures.push(
      `${label} artifact is ${round(artifact.sizeBytes / 1024 / 1024)} MiB; `
      + `limit is ${round(maxBytes / 1024 / 1024)} MiB.`,
    );
  }

  if (
    !Number.isFinite(artifact.durationSeconds)
    || artifact.durationSeconds < VISUAL_SIZE_QA_MIN_DURATION_SECONDS
    || artifact.durationSeconds > VISUAL_SIZE_QA_MAX_DURATION_SECONDS
  ) {
    failures.push(
      `${label} duration is ${round(artifact.durationSeconds)} s; `
      + `the long-capture gate requires ${VISUAL_SIZE_QA_MIN_DURATION_SECONDS}–`
      + `${VISUAL_SIZE_QA_MAX_DURATION_SECONDS} s.`,
    );
  }

  return {
    label,
    path: artifact.path,
    sizeBytes: artifact.sizeBytes,
    sizeMiB: round(artifact.sizeBytes / 1024 / 1024),
    maxBytes,
    maxMiB: round(maxBytes / 1024 / 1024),
    headroomBytes: maxBytes - artifact.sizeBytes,
    headroomMiB: round((maxBytes - artifact.sizeBytes) / 1024 / 1024),
    durationSeconds: round(artifact.durationSeconds, 3),
    passed: failures.length === 0,
    failures,
  };
}

export function evaluateVisualSizeQa({ preset, base, baked }) {
  const baseResult = evaluateArtifact('Base', base, VISUAL_SIZE_QA_BASE_MAX_BYTES);
  const bakedResult = evaluateArtifact('Baked', baked, VISUAL_SIZE_QA_BAKED_MAX_BYTES);
  const failures = [...baseResult.failures, ...bakedResult.failures];
  const durationDriftSeconds = Math.abs(base.durationSeconds - baked.durationSeconds);
  if (
    Number.isFinite(durationDriftSeconds)
    && durationDriftSeconds > VISUAL_SIZE_QA_MAX_DURATION_DRIFT_SECONDS
  ) {
    failures.push(
      `Base/baked duration drift is ${round(durationDriftSeconds, 3)} s; `
      + `limit is ${VISUAL_SIZE_QA_MAX_DURATION_DRIFT_SECONDS} s.`,
    );
  }

  if (typeof preset !== 'string' || preset.trim().length === 0) {
    failures.push('Preset label/id is required for an auditable QA result.');
  }

  return {
    schemaVersion: 1,
    preset: typeof preset === 'string' ? preset.trim() : '',
    expectedDurationSeconds: VISUAL_SIZE_QA_EXPECTED_DURATION_SECONDS,
    passed: failures.length === 0,
    durationDriftSeconds: round(durationDriftSeconds, 3),
    artifacts: { base: baseResult, baked: bakedResult },
    failures,
  };
}

export function formatVisualSizeQaReport(report) {
  const status = report.passed ? 'PASS' : 'FAIL';
  const lines = [`Visual size QA — ${report.preset || '(unnamed preset)'} — ${status}`];
  for (const artifact of [report.artifacts.base, report.artifacts.baked]) {
    lines.push(
      `${artifact.label}: ${artifact.sizeMiB} / ${artifact.maxMiB} MiB `
      + `(headroom ${artifact.headroomMiB} MiB), ${artifact.durationSeconds} s`,
    );
  }
  lines.push(`Duration drift: ${report.durationDriftSeconds} s`);
  for (const failure of report.failures) lines.push(`- ${failure}`);
  return lines.join('\n');
}
