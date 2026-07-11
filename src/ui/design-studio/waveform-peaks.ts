/**
 * v5.8.0 — Waveform peaks (pure).
 *
 * Min/max peak binning for the timeline's audio-reference lane (design §16.5).
 * The editor already holds the take's decoded AudioBuffer (segment-cue-player
 * buffer mode); this module reduces a channel's Float32 samples to per-bin
 * min/max pairs the canvas painter can draw at any zoom:
 *  - computeRangePeaks — exact peaks over an arbitrary sample range (the
 *    deep-zoom path: the window is small there, so the pass stays cheap);
 *  - computeWaveformPyramid — one fixed-resolution full-clip pass (~50 bins/s),
 *    computed once per source;
 *  - resamplePeaks — extrema-preserving downsample of a (fractional) pyramid
 *    slice to canvas pixels (the low-zoom path).
 *
 * Bins are TIME-ALIGNED to the requested range: a range extending past the
 * available samples yields silent (0,0) bins, never stretched audio — the lane
 * must stay honest against the ruler when cues run past the clip end.
 *
 * Pure logic — no DOM, no browser globals (Float32Array only). Node-tested
 * (scripts/test-waveform-peaks.mjs). Leaf: zero imports.
 *
 * Sync: subtitle-timeline-editor.ts (painter), segment-cue-player.ts
 *       (getDecodedBuffer source), docs/v5.8.0-trim-ui-visual-subtitle-editor.md §16.5
 */

export interface WaveformPeaks {
  min: Float32Array;
  max: Float32Array;
}

/** Pyramid resolution — one full-clip pass at this density covers all low zooms. */
export const WAVEFORM_PYRAMID_PEAKS_PER_SECOND = 50;

function emptyPeaks(binCount: number): WaveformPeaks {
  const n = Math.max(1, Math.floor(binCount));
  return { min: new Float32Array(n), max: new Float32Array(n) };
}

/**
 * Min/max peaks over [startSample, endSample), binned into `binCount` bins.
 * The range may extend outside the data — out-of-range bins are (0, 0).
 */
export function computeRangePeaks(
  channelData: Float32Array,
  startSample: number,
  endSample: number,
  binCount: number,
): WaveformPeaks {
  const n = Math.max(1, Math.floor(binCount));
  const peaks = emptyPeaks(n);
  const span = endSample - startSample;
  if (!Number.isFinite(span) || span <= 0 || channelData.length === 0) return peaks;

  for (let bin = 0; bin < n; bin += 1) {
    const fromF = startSample + (bin * span) / n;
    const toF = startSample + ((bin + 1) * span) / n;
    const lo = Math.max(0, Math.floor(fromF));
    const hi = Math.min(channelData.length, Math.max(Math.ceil(toF), Math.floor(fromF) + 1));
    if (hi <= lo) continue; // bin lies outside the data — stays silent
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = lo; i < hi; i += 1) {
      const v = channelData[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    peaks.min[bin] = mn;
    peaks.max[bin] = mx;
  }
  return peaks;
}

/** One fixed-resolution full-clip pass (~peaksPerSecond bins/s), done once per source. */
export function computeWaveformPyramid(
  channelData: Float32Array,
  sampleRate: number,
  peaksPerSecond = WAVEFORM_PYRAMID_PEAKS_PER_SECOND,
): WaveformPeaks {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || channelData.length === 0) {
    return emptyPeaks(1);
  }
  const durationSeconds = channelData.length / sampleRate;
  const binCount = Math.max(1, Math.ceil(durationSeconds * peaksPerSecond));
  return computeRangePeaks(channelData, 0, channelData.length, binCount);
}

/**
 * Extrema-preserving resample of pyramid bins [startBin, endBin) (fractional
 * allowed) into `binCount` output bins. Out-of-range input bins are silent —
 * same time-alignment contract as computeRangePeaks.
 */
export function resamplePeaks(
  peaks: WaveformPeaks,
  startBin: number,
  endBin: number,
  binCount: number,
): WaveformPeaks {
  const n = Math.max(1, Math.floor(binCount));
  const out = emptyPeaks(n);
  const len = Math.min(peaks.min.length, peaks.max.length);
  const span = endBin - startBin;
  if (!Number.isFinite(span) || span <= 0 || len === 0) return out;

  for (let bin = 0; bin < n; bin += 1) {
    const fromF = startBin + (bin * span) / n;
    const toF = startBin + ((bin + 1) * span) / n;
    const lo = Math.max(0, Math.floor(fromF));
    const hi = Math.min(len, Math.max(Math.ceil(toF), Math.floor(fromF) + 1));
    if (hi <= lo) continue;
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = lo; i < hi; i += 1) {
      if (peaks.min[i] < mn) mn = peaks.min[i];
      if (peaks.max[i] > mx) mx = peaks.max[i];
    }
    out.min[bin] = mn;
    out.max[bin] = mx;
  }
  return out;
}
