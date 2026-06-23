import type { UserPreferencesV1 } from '@/src/settings/user-preferences';
import { clipProfileMatchesLiveState, getClipProfileById } from '@/src/settings/clip-profiles';
import { isCustomStyleDirty } from '@/src/settings/custom-styles';
import { isPresetProfileId } from '@/src/settings/preset-profiles';
import { isStylePanelVisible } from '@/src/ui/style-select';
import type { TranscriptDeliveryStatus } from '@/src/ui/design-studio/subtitle-segment-editor';
import { STUDIO_V4_ASSETS, studioV4AssetUrl } from '@/src/ui/design-studio/studio-v4-assets';
import type { TranscriptConfig } from '@/src/transcription/types';

export type StudioStatusStripInput = {
  prefs: UserPreferencesV1;
  transcriptForMatch: TranscriptConfig;
  transcriptDirty: boolean;
  transcriptDelivery: TranscriptDeliveryStatus;
};

type StatusRow = {
  icon: string;
  text: string;
};

function profileDirty(prefs: UserPreferencesV1, transcriptForMatch: TranscriptConfig): boolean {
  const profileId = prefs.appearance.activeProfileId;
  if (!profileId || isPresetProfileId(profileId)) return false;
  const profile = getClipProfileById(prefs, profileId);
  if (!profile) return false;
  return !clipProfileMatchesLiveState(
    prefs.appearance,
    prefs.voiceEffect,
    transcriptForMatch,
    profile,
  );
}

function buildRows(input: StudioStatusStripInput): StatusRow[] {
  const rows: StatusRow[] = [];
  const { prefs, transcriptForMatch, transcriptDirty, transcriptDelivery } = input;

  if (profileDirty(prefs, transcriptForMatch)) {
    rows.push({
      icon: STUDIO_V4_ASSETS.status.warning,
      text: 'Profile has unsaved changes',
    });
  }

  if (isStylePanelVisible(prefs) && isCustomStyleDirty(prefs.appearance)) {
    rows.push({
      icon: STUDIO_V4_ASSETS.status.warning,
      text: 'Custom style has unsaved changes',
    });
  }

  if (transcriptDelivery === 'pending') {
    rows.push({
      icon: STUDIO_V4_ASSETS.status.pending,
      text: 'Transcript in progress',
    });
  } else if (transcriptDelivery === 'timeout') {
    rows.push({
      icon: STUDIO_V4_ASSETS.status.warning,
      text: 'Transcript timed out — record again',
    });
  } else if (transcriptDirty) {
    rows.push({
      icon: STUDIO_V4_ASSETS.status.warning,
      text: 'Transcript edits not confirmed',
    });
  } else if (transcriptDelivery === 'ready' && transcriptForMatch.transcriptionEnabled) {
    rows.push({
      icon: STUDIO_V4_ASSETS.status.complete,
      text: 'Transcript ready',
    });
  }

  if (rows.length === 0) {
    rows.push({
      icon: STUDIO_V4_ASSETS.status.info,
      text: 'Changes apply live to the recorder',
    });
  }

  return rows;
}

export function syncStudioStatusStrip(root: HTMLElement, input: StudioStatusStripInput): void {
  const strip = root.querySelector<HTMLElement>('[data-studio-status-strip]');
  if (!strip) return;

  const rows = buildRows(input);
  strip.innerHTML = rows
    .map(
      (row) => `
        <p class="studio-v4__status-row studio__status-strip-line">
          <img class="studio-v4__icon studio-v4__icon--16" src="${studioV4AssetUrl(row.icon)}" alt="" width="16" height="16" />
          <span>${row.text}</span>
        </p>
      `,
    )
    .join('');
}