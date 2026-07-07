/**
 * Cue-editor clip source resolution (v5.4+ TakeManager / H6).
 *
 * The segment editor's OOB badges and per-cue audio preview must track the
 * authoritative current take, not blindly trust rvnLastRecording — the store is
 * single-slot and a newer capture (or a failed cap-stop relay) can leave a
 * short stale WebM while take.meta still describes the real ~2:00 session.
 *
 * Sync: subtitle-segment-editor.ts (consumer), take-manager.ts
 *       (takeArtifactMatchesStore + resolveTakeClipDurationSeconds),
 *       studio-take-recovery.ts (same stamp contract).
 */

import {
  resolveTakeClipDurationSeconds,
  takeArtifactMatchesStore,
  type ArtifactStoreMeta,
  type CurrentTake,
  type TakeArtifactKind,
} from '@/src/session/take-manager';
import { loadLastBaseMp4, type LastBaseMp4Snapshot } from '@/src/storage/last-base-mp4-db';
import { loadLastRecording, type LastRecordingSnapshot } from '@/src/storage/last-recording-db';

export type SegmentEditorAudioSourceKind = 'baseMp4' | 'baseRecording';

export interface SegmentEditorAudioSource {
  blob: Blob;
  metaDurationSeconds: number;
  sourceKind: SegmentEditorAudioSourceKind;
  savedAt: number;
}

interface StoreMetaSlice {
  savedAt: number;
  byteLength?: number;
  durationSeconds?: number;
}

function sliceRecordingMeta(snapshot: LastRecordingSnapshot): StoreMetaSlice {
  return {
    savedAt: snapshot.meta.savedAt,
    byteLength: snapshot.meta.byteLength,
    durationSeconds: snapshot.meta.durationSeconds,
  };
}

function sliceBaseMp4Meta(snapshot: LastBaseMp4Snapshot): StoreMetaSlice {
  return {
    savedAt: snapshot.meta.savedAt,
    byteLength: snapshot.meta.byteLength,
    durationSeconds: snapshot.meta.durationSeconds,
  };
}

function metaDurationFromTakeAndStore(
  take: CurrentTake | null,
  storeMeta: StoreMetaSlice,
): number {
  return resolveTakeClipDurationSeconds(take) ?? storeMeta.durationSeconds ?? 0;
}

/**
 * Pick which single-slot store blob matches the current take (H6). Returns null
 * when stamps disagree — callers must not adopt a stale blob in that case.
 */
export function selectSegmentEditorAudioSourceKind(
  take: CurrentTake | null,
  baseMp4Meta: ArtifactStoreMeta | null | undefined,
  recordingMeta: ArtifactStoreMeta | null | undefined,
): SegmentEditorAudioSourceKind | null {
  if (
    take?.artifacts.baseMp4 &&
    baseMp4Meta &&
    takeArtifactMatchesStore(take.artifacts.baseMp4, baseMp4Meta)
  ) {
    return 'baseMp4';
  }
  if (
    take?.artifacts.baseRecording &&
    recordingMeta &&
    takeArtifactMatchesStore(take.artifacts.baseRecording, recordingMeta)
  ) {
    return 'baseRecording';
  }
  return null;
}

function buildSource(
  kind: SegmentEditorAudioSourceKind,
  blob: Blob,
  take: CurrentTake | null,
  storeMeta: StoreMetaSlice,
): SegmentEditorAudioSource {
  return {
    blob,
    sourceKind: kind,
    savedAt: storeMeta.savedAt,
    metaDurationSeconds: metaDurationFromTakeAndStore(take, storeMeta),
  };
}

/** Cache key for loadSegmentEditorAudioSource reload deduplication. */
export function segmentEditorAudioSourceCacheKey(
  take: CurrentTake | null,
  source: SegmentEditorAudioSource | null,
): string {
  const takePart = take ? `${take.id}:${take.lastUpdated}` : 'no-take';
  const sourcePart = source ? `${source.sourceKind}:${source.savedAt}` : 'no-source';
  return `${takePart}|${sourcePart}`;
}

/**
 * Load the clip blob the cue editor should preview, verified against the
 * current take. Prefers base MP4 (post-transcode, matches bake) over WebM.
 * Returns null when no stamp-verified blob exists — OOB can still use
 * resolveTakeClipDurationSeconds(take) without a preview source.
 */
export async function loadSegmentEditorAudioSource(
  take: CurrentTake | null,
): Promise<SegmentEditorAudioSource | null> {
  const [baseMp4, recording] = await Promise.all([loadLastBaseMp4(), loadLastRecording()]);

  const kind = selectSegmentEditorAudioSourceKind(
    take,
    baseMp4?.meta ?? null,
    recording?.meta ?? null,
  );

  if (kind === 'baseMp4' && baseMp4) {
    return buildSource('baseMp4', baseMp4.blob, take, sliceBaseMp4Meta(baseMp4));
  }
  if (kind === 'baseRecording' && recording) {
    return buildSource('baseRecording', recording.blob, take, sliceRecordingMeta(recording));
  }

  // Pre-TakeManager / no stamp: fall back to whichever store has data.
  if (!take) {
    if (recording?.blob && recording.blob.size >= 256) {
      return buildSource('baseRecording', recording.blob, null, sliceRecordingMeta(recording));
    }
    if (baseMp4?.blob && baseMp4.blob.size >= 256) {
      return buildSource('baseMp4', baseMp4.blob, null, sliceBaseMp4Meta(baseMp4));
    }
  }

  return null;
}

/** Artifact kind that would back the selected preview source (for diagnostics). */
export function segmentEditorAudioArtifactKind(
  kind: SegmentEditorAudioSourceKind | null,
): TakeArtifactKind | null {
  if (kind === 'baseMp4') return 'baseMp4';
  if (kind === 'baseRecording') return 'baseRecording';
  return null;
}