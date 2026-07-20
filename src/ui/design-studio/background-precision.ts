import { normalizeUserBackgroundLayout } from '@/src/theme/background-layout';
import type { NormalizedUserBackgroundLayout } from '@/src/theme/types';

export type BackgroundPositionAxis = 'x' | 'y';

export const BACKGROUND_POSITION_FINE_STEP = 0.01;
export const BACKGROUND_POSITION_COARSE_STEP = 0.05;

export function nudgeBackgroundPosition(
  layout: NormalizedUserBackgroundLayout,
  axis: BackgroundPositionAxis,
  delta: number,
): NormalizedUserBackgroundLayout {
  // CHANGED: numeric nudges reuse the canonical layout normalizer for their [0,1] boundary.
  // WHY: widget buttons, hero drag, persisted prefs, and the canvas painter need one clamp contract.
  return normalizeUserBackgroundLayout({
    ...layout,
    customPosition: {
      ...layout.customPosition,
      [axis]: layout.customPosition[axis] + delta,
    },
  });
}
