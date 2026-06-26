import type { UserPreferencesV1 } from '@/src/settings/user-preferences';
import { clipProfileMatchesLiveState, getClipProfileById } from '@/src/settings/clip-profiles';
import { isCustomStyleDirty } from '@/src/settings/custom-styles';
import { isPresetProfileId } from '@/src/settings/preset-profiles';
import { isStylePanelVisible } from '@/src/ui/style-select';
import type { TranscriptDeliveryStatus } from '@/src/ui/design-studio/subtitle-segment-editor';
import { STUDIO_V4_ASSETS, studioV4AssetUrl } from '@/src/ui/design-studio/studio-v4-assets';
import type { TranscriptConfig } from '@/src/transcription/types';
import type { VoiceEffectConfig } from '@/src/voice/types';

export type StudioStatusStripInput = {
  prefs: UserPreferencesV1;
  transcriptForMatch: TranscriptConfig;
  /** Live voice draft for dirty-match — falls back to prefs.voiceEffect when absent. */
  voiceForMatch?: VoiceEffectConfig;
  transcriptDirty: boolean;
  transcriptDelivery: TranscriptDeliveryStatus;
  hasSessionRecording: boolean;
  hasTranscriptCues: boolean;
  bakedForSession: boolean;
};

export type SubtitlesStatusState =
  | 'disabled'
  | 'no-recording'
  | 'incoming'
  | 'error'
  | 'no-speech'
  | 'edits-pending'
  | 'baked'
  | 'transcribed';

export type ProfileStatusSnapshot = {
  subtitles: {
    state: SubtitlesStatusState;
    icon: string;
    label: string;
    showOpenPanel: boolean;
  };
  ready: {
    yes: boolean;
    icon: string;
    label: string;
    hint?: string;
  };
  advisories: Array<{ icon: string; text: string }>;
};

// DEFERRED: RECORDED? row — in-studio recording is out of scope for v4 UI refresh (docs/design-studio.md §10.1).
// Future: YES | NO | ERROR from recorder session bridge.

function profileDirty(
  prefs: UserPreferencesV1,
  transcriptForMatch: TranscriptConfig,
  voiceForMatch: VoiceEffectConfig | undefined,
): boolean {
  const profileId = prefs.appearance.activeProfileId;
  if (!profileId || isPresetProfileId(profileId)) return false;
  const profile = getClipProfileById(prefs, profileId);
  if (!profile) return false;
  return !clipProfileMatchesLiveState(
    prefs.appearance,
    voiceForMatch ?? prefs.voiceEffect,
    transcriptForMatch,
    profile,
  );
}

export function buildProfileStatusSnapshot(input: StudioStatusStripInput): ProfileStatusSnapshot {
  const {
    prefs,
    transcriptForMatch,
    transcriptDirty,
    transcriptDelivery,
    hasSessionRecording,
    hasTranscriptCues,
    bakedForSession,
  } = input;
  const subtitlesEnabled = transcriptForMatch.transcriptionEnabled;
  const hasCues = hasTranscriptCues;
  const unsavedProfile = profileDirty(prefs, transcriptForMatch, input.voiceForMatch);
  const unsavedStyle = isStylePanelVisible(prefs) && isCustomStyleDirty(prefs.appearance);

  let subtitlesState: SubtitlesStatusState;
  let subtitlesLabel: string;
  let subtitlesIcon: string;
  let showOpenPanel = false;

  if (!subtitlesEnabled) {
    subtitlesState = 'disabled';
    subtitlesLabel = 'Disabled';
    subtitlesIcon = STUDIO_V4_ASSETS.status.info;
  } else if (!hasSessionRecording) {
    subtitlesState = 'no-recording';
    subtitlesLabel = 'No recording — record on Reddit first';
    subtitlesIcon = STUDIO_V4_ASSETS.status.info;
  } else if (transcriptDelivery === 'pending') {
    subtitlesState = 'incoming';
    subtitlesLabel = 'Incoming…';
    subtitlesIcon = STUDIO_V4_ASSETS.status.pending;
  } else if (transcriptDirty) {
    // CHANGED: active editing wins over the terminal failure/timeout alarms (v5.3
    // Phase 3) — every failure now yields an editable scaffold, so once the user
    // types, "confirm edits" is the right call to action, not "no speech".
    subtitlesState = 'edits-pending';
    subtitlesLabel = 'Confirm edits in Subtitles panel';
    subtitlesIcon = STUDIO_V4_ASSETS.status.warning;
    showOpenPanel = true;
  } else if (transcriptDelivery === 'timeout') {
    subtitlesState = 'error';
    subtitlesLabel = 'Timed out — timecode template ready for manual entry';
    subtitlesIcon = STUDIO_V4_ASSETS.status.failure;
    showOpenPanel = true;
  } else if (transcriptDelivery === 'no-speech') {
    // CHANGED: graceful no-speech → red failure + scaffolding affordance (v5.3 Phase 3).
    subtitlesState = 'no-speech';
    subtitlesLabel = 'No speech detected — scaffolding ready for manual entry';
    subtitlesIcon = STUDIO_V4_ASSETS.status.failure;
    showOpenPanel = true;
  } else if (transcriptDelivery === 'failed') {
    subtitlesState = 'error';
    subtitlesLabel = 'Transcription failed — timecode template generated';
    subtitlesIcon = STUDIO_V4_ASSETS.status.failure;
    showOpenPanel = true;
  } else if (transcriptDelivery === 'scaffolded') {
    // Success-path scaffold (manual generate, Phase 5) — neutral, not an alarm.
    subtitlesState = 'no-speech';
    subtitlesLabel = 'Scaffolding ready — type your subtitles';
    subtitlesIcon = STUDIO_V4_ASSETS.status.info;
    showOpenPanel = true;
  } else if (transcriptDelivery === 'ready' && !hasCues) {
    subtitlesState = 'no-speech';
    subtitlesLabel = 'No speech — check audio or add subs manually';
    subtitlesIcon = STUDIO_V4_ASSETS.status.failure;
    showOpenPanel = true;
  } else if (bakedForSession) {
    subtitlesState = 'baked';
    subtitlesLabel = 'Baked';
    subtitlesIcon = STUDIO_V4_ASSETS.status.complete;
  } else if (transcriptDelivery === 'ready' && hasCues) {
    subtitlesState = 'transcribed';
    subtitlesLabel = 'Transcribed';
    subtitlesIcon = STUDIO_V4_ASSETS.status.complete;
    showOpenPanel = true;
  } else {
    subtitlesState = 'incoming';
    subtitlesLabel = 'Incoming…';
    subtitlesIcon = STUDIO_V4_ASSETS.status.pending;
  }

  const blockers: string[] = [];
  if (unsavedProfile) blockers.push('Save profile changes');
  if (unsavedStyle) blockers.push('Save custom style');
  if (subtitlesEnabled) {
    if (!hasSessionRecording) blockers.push('Record a clip on Reddit');
    else if (transcriptDelivery === 'pending') blockers.push('Wait for subtitles');
    else if (transcriptDirty) blockers.push('Confirm subtitle edits');
    else if (transcriptDelivery === 'timeout') blockers.push('Type subtitles into the template, then bake');
    else if (transcriptDelivery === 'no-speech') blockers.push('No speech — type subtitles into the scaffold');
    else if (transcriptDelivery === 'failed') blockers.push('Transcription failed — type subtitles into the scaffold');
    else if (transcriptDelivery === 'scaffolded') blockers.push('Type your subtitles into the scaffold');
    else if (transcriptDelivery === 'ready' && !hasCues) blockers.push('No speech — check audio or add subs manually');
    else if (!bakedForSession) blockers.push('Bake subtitles into MP4');
  }

  const readyYes = blockers.length === 0;
  const readyHint = readyYes
    ? subtitlesEnabled
      ? 'Subtitles baked — attach from Reddit recorder'
      : 'Profile ready — changes apply live to the recorder'
    : blockers[0];

  const advisories: ProfileStatusSnapshot['advisories'] = [];
  if (unsavedProfile) {
    advisories.push({
      icon: STUDIO_V4_ASSETS.status.warning,
      text: 'Profile has unsaved changes',
    });
  }
  if (unsavedStyle) {
    advisories.push({
      icon: STUDIO_V4_ASSETS.status.warning,
      text: 'Custom style has unsaved changes',
    });
  }

  return {
    subtitles: {
      state: subtitlesState,
      icon: subtitlesIcon,
      label: subtitlesLabel,
      showOpenPanel,
    },
    ready: {
      yes: readyYes,
      icon: readyYes ? STUDIO_V4_ASSETS.status.complete : STUDIO_V4_ASSETS.status.warning,
      label: readyYes ? 'Yes' : 'No',
      hint: readyHint,
    },
    advisories,
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function syncStudioStatusStrip(root: HTMLElement, input: StudioStatusStripInput): void {
  const strip = root.querySelector<HTMLElement>('[data-studio-status-strip]');
  if (!strip) return;

  const snapshot = buildProfileStatusSnapshot(input);
  const subtitlesIconUrl = studioV4AssetUrl(STUDIO_V4_ASSETS.icons.subtitles16);
  const openPanelBtn = snapshot.subtitles.showOpenPanel
    ? `<button type="button" class="studio-v4__status-link" data-studio-panel-open="subtitles" aria-label="Open Subtitles panel">
         Open panel ↓
       </button>`
    : '';

  const advisoryRows = snapshot.advisories
    .map(
      (row) => `
        <p class="studio-v4__status-advisory studio__status-strip-line">
          <img class="studio-v4__icon studio-v4__icon--16" src="${studioV4AssetUrl(row.icon)}" alt="" width="16" height="16" />
          <span>${escapeHtml(row.text)}</span>
        </p>
      `,
    )
    .join('');

  strip.innerHTML = `
    <div class="studio-v4__status-grid" role="group" aria-label="Session status">
      <div class="studio-v4__status-row">
        <span class="studio-v4__status-label">
          <img class="studio-v4__icon studio-v4__icon--16" src="${subtitlesIconUrl}" alt="" width="16" height="16" />
          Subtitles:
        </span>
        <span class="studio-v4__status-value studio-v4__status-value--${snapshot.subtitles.state}">
          <img class="studio-v4__icon studio-v4__icon--16" src="${studioV4AssetUrl(snapshot.subtitles.icon)}" alt="" width="16" height="16" />
          <span>${escapeHtml(snapshot.subtitles.label)}</span>
          ${openPanelBtn}
        </span>
      </div>
      <div class="studio-v4__status-row studio-v4__status-row--ready${snapshot.ready.yes ? '' : ' studio-v4__status-row--not-ready'}">
        <span class="studio-v4__status-label">Ready?</span>
        <span class="studio-v4__status-value studio-v4__status-value--${snapshot.ready.yes ? 'yes' : 'no'}">
          <img class="studio-v4__icon studio-v4__icon--16" src="${studioV4AssetUrl(snapshot.ready.icon)}" alt="" width="16" height="16" />
          <span class="studio-v4__status-ready-label">${escapeHtml(snapshot.ready.label)}</span>
        </span>
      </div>
      ${
        snapshot.ready.hint
          ? `<p class="studio-v4__status-hint${snapshot.ready.yes ? '' : ' studio-v4__status-hint--not-ready'}">${escapeHtml(snapshot.ready.hint)}</p>`
          : ''
      }
    </div>
    ${advisoryRows}
  `;
}