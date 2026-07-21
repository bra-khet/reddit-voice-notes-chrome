import {
  normalizeUserBackgroundLayout,
  userBackgroundLayoutFromAppearance,
} from '@/src/theme/background-layout';
import type {
  NormalizedUserBackgroundLayout,
  UserBackgroundLayout,
} from '@/src/theme/types';

export interface RecorderBackgroundAppearance {
  customBackgroundId?: string | null;
  backgroundScaleMode?: UserBackgroundLayout['scaleMode'];
  backgroundPosition?: UserBackgroundLayout['position'];
  backgroundLayout?: Partial<UserBackgroundLayout>;
}

export interface RecorderBackgroundOverride {
  customBackgroundId?: string | null;
  layout?: UserBackgroundLayout;
}

export interface ResolvedRecorderBackgroundState {
  customBackgroundId: string | null;
  layout: NormalizedUserBackgroundLayout;
}

export function resolveRecorderBackgroundState(
  appearance: RecorderBackgroundAppearance,
  localOverride: RecorderBackgroundOverride,
): ResolvedRecorderBackgroundState {
  // BUG FIX: live background position briefly reverted during an open recorder session
  // Fix: Studio-owned hot adjustments outrank asynchronously delivered persisted prefs for that session.
  // Sync: voice-recorder.ts; waveform.ts; scripts/test-recorder-background-state.mjs
  const hasBackgroundIdOverride = Object.prototype.hasOwnProperty.call(
    localOverride,
    'customBackgroundId',
  );
  return {
    customBackgroundId: hasBackgroundIdOverride
      ? localOverride.customBackgroundId ?? null
      : appearance.customBackgroundId ?? null,
    layout: localOverride.layout
      ? normalizeUserBackgroundLayout(localOverride.layout)
      : userBackgroundLayoutFromAppearance(appearance),
  };
}
