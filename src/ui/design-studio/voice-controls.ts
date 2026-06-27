import { formatRecordingCapClock } from '@/src/utils/constants';
import { loadLastRecording, type LastRecordingSnapshot } from '@/src/storage/last-recording-db';
import {
  LAST_RECORDING_READY_KEY,
  loadUserPreferences,
  saveVoiceEffectPreferences,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';
import { mountVoiceComposer } from '@/src/ui/design-studio/voice-composer';
import {
  renderPhysicalSliderHtml,
  setPhysicalSliderValue,
  wirePhysicalSliders,
} from '@/src/ui/design-studio/physical-slider';
import { getClipProfileById } from '@/src/settings/clip-profiles';
import { isPresetProfileId } from '@/src/settings/preset-profiles';
import {
  CHARACTER_PRESETS,
  resolveVoiceGraph,
  stylizedGraphIsActive,
  type StylizedGraph,
} from '@/src/voice/dsp';
import { createVoicePreviewPlayer } from '@/src/voice/preview-chain';
import {
  DEFAULT_VOICE_EFFECT_CONFIG,
  normalizeVoiceEffectConfig,
  VOICE_INTENSITY_MAX,
  VOICE_INTENSITY_MIN,
  VOICE_INTENSITY_TURBO,
  type VoiceEffectConfig,
} from '@/src/voice/types';
import { showToast } from '@/src/ui/toast';
import { STUDIO_V4_ASSETS, studioV4AssetUrl } from '@/src/ui/design-studio/studio-v4-assets';
import {
  guardVoiceCharacterSwitch,
  isVoiceCharacterLocked,
  LOCK_GUARD_CUSTOM_REASON,
  resetVoiceCharacterLock,
  setVoiceCharacterLock,
} from '@/src/ui/design-studio/voice-character-lock';
import {
  copyVoiceCharacterToClipboard,
  pasteVoiceCharacterFromClipboard,
} from '@/src/settings/clipboard-backup';
import {
  startMicTestCapture,
  MicTestCaptureError,
  MIC_TEST_DEFAULT_MAX_MS,
  type MicTestCaptureController,
  type MicTestCaptureErrorCode,
} from '@/src/voice/mic-test-capture';
import { acquireMicStream } from '@/src/recorder/mic-constraints';
import type { AudioPreferences } from '@/src/settings/user-preferences';

export interface VoiceControlsHandle {
  dispose(): void;
  getDraftConfig(): VoiceEffectConfig;
  syncFromPreferences(prefs: UserPreferencesV1): void;
  /**
   * Flush the debounced voice draft to global prefs *now* and resolve when the
   * write completes. Profile save / studio exit must await this so a profile
   * snapshot can't capture a stale voice (mirrors subtitleControls.flushPersist).
   */
  flushPersist(): Promise<void>;
}

const VOICE_SAVE_DEBOUNCE_MS = 250;
/** Poll extension IDB while studio is open — mirrors subtitle-controls transcript poll. */
const RECORDING_POLL_MS = 2000;
/**
 * Cap the one-shot preview render so long recordings audition quickly (Branch 3 §3.2).
 * Shorter clips render in full and stay byte-identical to the bake; only longer ones trim.
 */
const PREVIEW_MAX_SECONDS = 30;

// V4 NOTE: Voice section may become its own panel/tab when Studio sections are segmented.

export function renderVoiceControlFields(): string {
  const copyIconUrl = studioV4AssetUrl(STUDIO_V4_ASSETS.icons.copy16);
  const pasteIconUrl = studioV4AssetUrl(STUDIO_V4_ASSETS.icons.paste16);
  const padlockOpenUrl = studioV4AssetUrl(STUDIO_V4_ASSETS.icons.padlockOpen16);
  return `
    <div class="studio__voice" data-voice-controls>
      <p class="studio__voice-source" data-voice-source>
        Loading last recording…
      </p>
      <label class="popup__toggle-row studio__voice-toggle">
        <span class="popup__toggle-copy">
          <span class="popup__toggle-label">Voice effects</span>
          <p class="popup__field-desc">Applies on your next recording when enabled.</p>
        </span>
        <input
          class="popup__toggle-input"
          type="checkbox"
          data-voice-enabled
          aria-label="Enable voice effects"
        />
      </label>
      <div class="studio__char-section">
        <span class="popup__field-label studio__char-label">Character voice</span>
        <p class="studio__char-help popup__field-desc">
          Each profile carries one voice. Pick a character to start, then tweak it
          below into a custom voice — your changes save with this profile.
        </p>
        <div class="studio__char-chips" data-char-chips></div>
        <div class="studio__char-pill-row">
          <span class="studio__char-status" data-char-status hidden></span>
          <div class="studio__char-actions" data-voice-char-actions>
            <button
              type="button"
              class="studio__icon-btn studio__lock-btn"
              data-voice-lock
              hidden
              aria-pressed="false"
              title="Lock this custom voice character to prevent switching"
              aria-label="Lock this custom voice character to prevent switching"
            >
              <img src="${padlockOpenUrl}" alt="" width="16" height="16" data-voice-lock-img />
            </button>
            <button
              type="button"
              class="studio__icon-btn"
              data-voice-copy
              title="Copy this voice character to the clipboard"
              aria-label="Copy this voice character to the clipboard"
            >
              <img src="${copyIconUrl}" alt="" width="16" height="16" />
            </button>
            <button
              type="button"
              class="studio__icon-btn"
              data-voice-paste
              title="Paste a voice character from the clipboard"
              aria-label="Paste a voice character from the clipboard"
            >
              <img src="${pasteIconUrl}" alt="" width="16" height="16" />
            </button>
          </div>
        </div>
        <p class="studio__char-note popup__field-desc" data-char-note></p>
      </div>
      <label class="popup__field studio__field--compact studio__voice-intensity">
        <span class="popup__field-label">
          Intensity <span data-voice-intensity-value>10/10</span>
        </span>
        ${renderPhysicalSliderHtml({
          min: VOICE_INTENSITY_MIN,
          max: VOICE_INTENSITY_MAX,
          step: 1,
          value: VOICE_INTENSITY_MAX,
          ariaLabel: 'Voice effect intensity',
          dataAttrs: { 'voice-intensity': '' },
        })}
      </label>
      <label class="popup__toggle-row studio__voice-toggle">
        <span class="popup__toggle-copy">
          <span class="popup__toggle-label">Turbo</span>
          <p class="popup__field-desc">Extra punch — maps to magic intensity ${VOICE_INTENSITY_TURBO}.</p>
        </span>
        <input
          class="popup__toggle-input"
          type="checkbox"
          data-voice-turbo
          aria-label="Turbo voice effect boost"
        />
      </label>
      <div class="studio__voice-composer" data-voice-composer></div>
      <div class="studio__voice-actions studio__voice-tests">
        <div class="studio__voice-test-group" data-voice-test-group>
          <button
            type="button"
            class="popup__profile-btn popup__profile-btn--save"
            data-voice-test
            aria-label="Test the current voice character on your last recording from Reddit"
          >
            Last Voice Note
          </button>
          <p class="studio__voice-test-cap" data-voice-test-cap>Stored recording from Reddit</p>
        </div>
        <!-- Shared voice glyph: visual cue that both buttons audition the same voice.
             Inlined (not <img>) so stroke="currentColor" inherits the panel color. -->
        <svg
          class="studio__voice-test-icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        <div class="studio__voice-test-group" data-voice-mic-test-group>
          <button
            type="button"
            class="popup__profile-btn popup__profile-btn--save studio__mic-test-btn"
            data-voice-mic-test
            aria-label="Record a one-time test with your microphone and hear the current voice character"
          >
            One-Time Test
          </button>
          <p class="studio__voice-test-cap" data-voice-test-cap>Test recording — not stored</p>
        </div>
      </div>
      <div class="studio__voice-mic" data-voice-mic-panel hidden>
        <div
          class="studio__voice-meter"
          data-voice-meter
          role="meter"
          aria-label="Microphone input level"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span class="studio__voice-meter-fill" data-voice-meter-fill></span>
        </div>
      </div>
      <div class="studio__voice-stoprow">
        <button type="button" class="popup__profile-btn popup__profile-btn--delete" data-voice-stop hidden>
          Stop
        </button>
      </div>
      <p class="studio__voice-status popup__field-desc" data-voice-status aria-live="polite"></p>
    </div>
  `;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatSavedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return 'recent session';
  }
}

/** Active saved-profile name for the custom-voice status pill (undefined in custom/no-profile mode). */
function activeProfileNameFrom(prefs: UserPreferencesV1): string | undefined {
  const profileId = prefs.appearance.activeProfileId;
  if (!profileId || isPresetProfileId(profileId)) return undefined;
  return getClipProfileById(prefs, profileId)?.name;
}

export function mountVoiceControls(
  root: HTMLElement,
  onDraftChange?: () => void,
): VoiceControlsHandle {
  const panel = root.querySelector<HTMLElement>('[data-voice-controls]')!;
  const sourceEl = panel.querySelector<HTMLElement>('[data-voice-source]')!;
  const enabledInput = panel.querySelector<HTMLInputElement>('[data-voice-enabled]')!;
  const chipsHost = panel.querySelector<HTMLElement>('[data-char-chips]')!;
  const charStatusEl = panel.querySelector<HTMLElement>('[data-char-status]')!;
  const charNoteEl = panel.querySelector<HTMLElement>('[data-char-note]')!;
  const copyBtn = panel.querySelector<HTMLButtonElement>('[data-voice-copy]')!;
  const pasteBtn = panel.querySelector<HTMLButtonElement>('[data-voice-paste]')!;
  const lockBtn = panel.querySelector<HTMLButtonElement>('[data-voice-lock]')!;
  const lockImg = panel.querySelector<HTMLImageElement>('[data-voice-lock-img]')!;
  const composerHost = panel.querySelector<HTMLElement>('[data-voice-composer]')!;
  const intensitySlider = panel.querySelector<HTMLElement>('[data-voice-intensity]')!;
  const intensityValueEl = panel.querySelector<HTMLElement>('[data-voice-intensity-value]')!;
  const turboInput = panel.querySelector<HTMLInputElement>('[data-voice-turbo]')!;
  const testBtn = panel.querySelector<HTMLButtonElement>('[data-voice-test]')!;
  const testGroup = panel.querySelector<HTMLElement>('[data-voice-test-group]')!;
  const micTestBtn = panel.querySelector<HTMLButtonElement>('[data-voice-mic-test]')!;
  const micTestGroup = panel.querySelector<HTMLElement>('[data-voice-mic-test-group]')!;
  const micPanel = panel.querySelector<HTMLElement>('[data-voice-mic-panel]')!;
  const meterEl = panel.querySelector<HTMLElement>('[data-voice-meter]')!;
  const meterFill = panel.querySelector<HTMLElement>('[data-voice-meter-fill]')!;
  const stopBtn = panel.querySelector<HTMLButtonElement>('[data-voice-stop]')!;
  const statusEl = panel.querySelector<HTMLElement>('[data-voice-status]')!;

  let draftConfig: VoiceEffectConfig = normalizeVoiceEffectConfig(DEFAULT_VOICE_EFFECT_CONFIG);
  let currentProfileName: string | undefined;
  let lastRecording: LastRecordingSnapshot | null = null;
  let loadedSavedAt = 0;
  let syncing = false;
  let rendering = false;
  let capturing = false;
  let capture: MicTestCaptureController | null = null;
  // Mic-capture prefs (raw/enhanced) so the One-Time Test uses the SAME constraints as the
  // real recorder — keeps the audition faithful to the eventual bake. Null until prefs load.
  let audioPrefs: AudioPreferences | null = null;
  let saveTimer = 0;

  const preview = createVoicePreviewPlayer();

  const PADLOCK_OPEN_URL = studioV4AssetUrl(STUDIO_V4_ASSETS.icons.padlockOpen16);
  const PADLOCK_CLOSED_URL = studioV4AssetUrl(STUDIO_V4_ASSETS.icons.padlockClosed16);
  // Transient guard (spec §2): each studio open starts unlocked even if a prior
  // mount in the same page left the module flag armed.
  resetVoiceCharacterLock();

  for (const preset of CHARACTER_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'studio__char-chip';
    btn.dataset.charId = preset.id;
    btn.textContent = preset.label;
    btn.title = preset.blurb;
    chipsHost.appendChild(btn);
  }

  /**
   * Reflect the active voice identity in the chip row:
   *  - highlight the selected character chip (when a character is picked), and
   *  - light a non-interactive status pill named after the active profile when
   *    the voice is a *custom* graph (no character) — the "you're on a custom
   *    voice for this profile" indicator. Profile names are user text, so the
   *    label is set via textContent (never innerHTML) — no escape hazards.
   */
  function updateVoiceIdentity(): void {
    const characterId = draftConfig.characterPresetId;
    const isCustomGraph =
      !characterId && (draftConfig.graph?.fragments.length ?? 0) > 0;

    for (const chip of chipsHost.querySelectorAll<HTMLElement>('.studio__char-chip')) {
      chip.classList.toggle(
        'is-selected',
        characterId !== undefined && chip.dataset.charId === characterId,
      );
    }

    if (isCustomGraph) {
      const name = currentProfileName?.trim();
      charStatusEl.textContent = name ? `★ ${name} — custom voice` : '★ Custom voice';
      charStatusEl.hidden = false;
    } else {
      charStatusEl.textContent = '';
      charStatusEl.hidden = true;
    }

    // Lock guard is a custom-voice-only affordance: presets are always restorable
    // from preset-graphs.ts, so the padlock only surfaces for a custom graph.
    if (isCustomGraph) {
      const locked = isVoiceCharacterLocked();
      lockBtn.hidden = false;
      lockImg.src = locked ? PADLOCK_CLOSED_URL : PADLOCK_OPEN_URL;
      lockBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
      const lockLabel = locked
        ? 'Unlock voice character switching'
        : 'Lock this custom voice character to prevent switching';
      lockBtn.title = lockLabel;
      lockBtn.setAttribute('aria-label', lockLabel);
    } else {
      // Leaving custom mode must not strand an armed lock (e.g. blank-slate reset).
      if (isVoiceCharacterLocked()) setVoiceCharacterLock(false);
      lockBtn.hidden = true;
      lockImg.src = PADLOCK_OPEN_URL;
      lockBtn.setAttribute('aria-pressed', 'false');
    }

    charNoteEl.textContent = characterId
      ? 'Editing any effect below makes this a custom voice for this profile.'
      : '';
  }

  // Branch 4: the Custom composer is the single editor of the active StylizedGraph.
  // Seed-then-tweak — picking a character seeds it for display; the first edit
  // materializes draftConfig.graph and forks the voice to a Custom graph.
  function onComposerChange(nextGraph: StylizedGraph): void {
    const hasFragments = nextGraph.fragments.length > 0;
    draftConfig = normalizeVoiceEffectConfig({
      ...mergeLiveToggles(draftConfig),
      characterPresetId: undefined,
      graph: nextGraph,
      enabled: hasFragments ? true : enabledInput.checked,
    });
    updateVoiceIdentity();
    enabledInput.checked = draftConfig.enabled;
    schedulePersist();
    notifyDraftChange();
    setStatus(
      hasFragments
        ? 'Custom voice — Test to hear the rendered result.'
        : 'Blank slate — toggle effects below to build a voice.',
    );
  }

  const composer = mountVoiceComposer(composerHost, {
    initialGraph: resolveVoiceGraph(resolvedDraft()),
    onChange: onComposerChange,
  });

  function setStatus(message: string): void {
    statusEl.textContent = message;
  }

  function notifyDraftChange(): void {
    onDraftChange?.();
  }

  function schedulePersist(): void {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      void saveVoiceEffectPreferences(draftConfig).catch((error: unknown) => {
        console.warn('[Reddit Voice Notes] Voice prefs save failed', error);
      });
    }, VOICE_SAVE_DEBOUNCE_MS);
  }

  /** Write the current draft to global prefs immediately; returns the save promise. */
  function writeDraftNow(): Promise<void> {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
    }
    draftConfig.enabled = enabledInput.checked;
    return saveVoiceEffectPreferences(draftConfig)
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn('[Reddit Voice Notes] Voice prefs save failed', error);
      });
  }

  function persistNow(): void {
    void writeDraftNow();
  }

  function updateIntensityUi(): void {
    const turbo = draftConfig.turbo === true;
    const intensity = turbo
      ? VOICE_INTENSITY_TURBO
      : (draftConfig.intensity ?? VOICE_INTENSITY_MAX);
    intensitySlider.classList.toggle('is-disabled', turbo);
    setPhysicalSliderValue(
      intensitySlider,
      turbo ? VOICE_INTENSITY_MAX : clampIntensity(intensity),
    );
    intensityValueEl.textContent = turbo
      ? `Turbo (${VOICE_INTENSITY_TURBO})`
      : `${clampIntensity(intensity)}/${VOICE_INTENSITY_MAX}`;
    turboInput.checked = turbo;
  }

  function clampIntensity(value: number): number {
    return Math.min(VOICE_INTENSITY_MAX, Math.max(VOICE_INTENSITY_MIN, Math.round(value)));
  }

  function mergeLiveToggles(config: VoiceEffectConfig): VoiceEffectConfig {
    return normalizeVoiceEffectConfig({
      ...config,
      enabled: enabledInput.checked,
      intensity: draftConfig.turbo
        ? VOICE_INTENSITY_TURBO
        : clampIntensity(Number(intensitySlider.dataset.value)),
      turbo: turboInput.checked,
    });
  }

  function resolvedDraft(): VoiceEffectConfig {
    // mergeLiveToggles already normalizes; resolveVoiceGraph does the graph/character
    // resolution itself, so no separate legacy resolve step is needed.
    return mergeLiveToggles(draftConfig);
  }

  function syncControlsFromDraft(): void {
    syncing = true;
    enabledInput.checked = draftConfig.enabled;
    updateVoiceIdentity();
    // Seed the composer with whatever the voice currently resolves to (a stored
    // graph or a character preset's makeup) for display.
    composer.setGraph(resolveVoiceGraph(resolvedDraft()));
    updateIntensityUi();
    notifyDraftChange();
    syncing = false;
  }

  function updateSourceCopy(): void {
    if (!lastRecording) {
      // The storage-safety rule (no mic capture is ever stored) pinches hardest for
      // newcomers with no saved take — so frame it as a path forward, not a dead end.
      sourceEl.textContent = `No saved recording yet — record a voice note on Reddit (up to ${formatRecordingCapClock()}) to use “Last Voice Note”, or try “One-Time Test” to audition with your mic right now.`;
      return;
    }

    const { meta } = lastRecording;
    const kb = Math.round(meta.byteLength / 1024);
    sourceEl.textContent = `Last recording: ${formatDuration(meta.durationSeconds)} · ${kb} KB · ${formatSavedAt(meta.savedAt)}`;
  }

  /**
   * One shared Stop button governs both audition modes (only one can run at a time):
   *  - while capturing → "Stop & render" (flush the mic clip and render it),
   *  - while playing back → "Stop" (halt the rendered clip).
   * It lives in its own row so the test buttons never reflow as it appears/disappears.
   */
  function refreshStopUi(): void {
    if (capturing) {
      stopBtn.hidden = false;
      stopBtn.textContent = 'Stop & render';
    } else if (preview.isPlaying()) {
      stopBtn.hidden = false;
      stopBtn.textContent = 'Stop';
    } else {
      stopBtn.hidden = true;
    }
  }

  /**
   * With no saved recording, "Last Voice Note" can't do anything useful — de-emphasize it
   * and pull the eye to "One-Time Test", which works immediately from the mic.
   */
  function refreshTestEmphasis(): void {
    const hasRecording = Boolean(lastRecording);
    testGroup.classList.toggle('is-deemphasized', !hasRecording);
    micTestGroup.classList.toggle('is-emphasized', !hasRecording);
  }

  /** Both test buttons are unavailable whenever a capture or a render is in flight. */
  function refreshActionAvailability(): void {
    const busy = rendering || capturing;
    testBtn.disabled = busy;
    micTestBtn.disabled = busy;
  }

  function setRendering(active: boolean, source: 'last-note' | 'mic' = 'last-note'): void {
    rendering = active;
    refreshActionAvailability();
    // Show "Rendering…" only on the button that initiated the render.
    testBtn.textContent = active && source === 'last-note' ? 'Rendering…' : 'Last Voice Note';
    micTestBtn.textContent = active && source === 'mic' ? 'Rendering…' : 'One-Time Test';
  }

  function setCapturing(active: boolean): void {
    capturing = active;
    micPanel.hidden = !active;
    micTestBtn.classList.toggle('is-capturing', active);
    if (!active) setMeter(0);
    refreshActionAvailability();
    refreshStopUi();
  }

  function setMeter(level: number): void {
    const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
    meterFill.style.width = `${pct}%`;
    meterEl.setAttribute('aria-valuenow', String(pct));
  }

  /** Map a capture-error code to a user-facing message (aborted is silent-ish). */
  function captureErrorMessage(code: MicTestCaptureErrorCode): string {
    const messages: Record<MicTestCaptureErrorCode, string> = {
      'permission-denied':
        'Microphone blocked. Allow mic access for this extension in your browser settings, then try again.',
      unsupported: 'Live mic test isn’t supported in this browser context.',
      'no-audio': 'No audio captured — check your microphone and try again.',
      'aborted-empty': 'Mic test cancelled.',
      'capture-failed': 'Could not capture audio — please try again.',
    };
    return messages[code];
  }

  // v5.3.1: render an ALREADY-captured mic blob through the SAME path as the "Last Voice
  // Note" button (resolveVoiceGraph → processAudioWithGraph → the shared single preview
  // player), so the live-mic audition is byte-identical to the bake.
  async function renderCaptured(blob: Blob, graph: StylizedGraph): Promise<void> {
    setRendering(true, 'mic');
    setStatus('Rendering your voice… (one-shot, a few seconds)');
    try {
      const { processAudioWithGraph } = await import('@/src/voice/process-audio');
      const result = await processAudioWithGraph(
        blob,
        graph,
        (ratio) => {
          setStatus(`Rendering your voice… ${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`);
        },
        { maxDurationSeconds: PREVIEW_MAX_SECONDS },
      );
      await preview.playProcessed(result.blob);
      refreshStopUi();
      setStatus(
        result.applied
          ? 'Playing your voice with the character effect — this is what bakes.'
          : 'Played your voice unprocessed — no effect was applied (check console).',
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatus(`Mic test failed: ${detail}`);
    } finally {
      setRendering(false);
    }
  }

  async function loadRecordingSource(): Promise<void> {
    const snapshot = await loadLastRecording();
    const savedAt = snapshot?.meta.savedAt ?? 0;
    if (snapshot && savedAt <= loadedSavedAt && lastRecording) {
      return;
    }

    if (preview.isPlaying()) {
      preview.stop();
      refreshStopUi();
    }

    lastRecording = snapshot;
    loadedSavedAt = savedAt;

    if (lastRecording) {
      try {
        await preview.setSource(lastRecording.blob);
        setStatus('Recording loaded — pick a character, then Last Voice Note to hear it.');
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus(`Could not load last recording: ${detail}`);
      }
    } else {
      loadedSavedAt = 0;
      setStatus('');
    }
    updateSourceCopy();
    refreshTestEmphasis();
  }

  enabledInput.addEventListener('change', () => {
    if (syncing) return;
    draftConfig = normalizeVoiceEffectConfig({
      ...draftConfig,
      enabled: enabledInput.checked,
    });
    schedulePersist();
    notifyDraftChange();
  });

  const unwireIntensitySlider = wirePhysicalSliders(intensitySlider, {
    isDisabled: () => turboInput.checked,
    onValueChange(_slider, value, prev) {
      if (syncing || turboInput.checked || value === prev) return;
      // BUG FIX: intensity slider latched to Custom preset
      // Fix: keep active bundled presetId — intensity only modulates its SFX at preview/export
      draftConfig = normalizeVoiceEffectConfig({
        ...draftConfig,
        enabled: enabledInput.checked,
        intensity: clampIntensity(value),
        turbo: false,
      });
      intensityValueEl.textContent = `${draftConfig.intensity ?? VOICE_INTENSITY_MAX}/${VOICE_INTENSITY_MAX}`;
      schedulePersist();
      notifyDraftChange();
      setStatus('');
    },
  });

  turboInput.addEventListener('change', () => {
    if (syncing) return;
    const turbo = turboInput.checked;
    draftConfig = normalizeVoiceEffectConfig({
      ...draftConfig,
      enabled: enabledInput.checked,
      turbo,
      intensity: turbo ? VOICE_INTENSITY_TURBO : clampIntensity(Number(intensitySlider.dataset.value)),
    });
    updateIntensityUi();
    schedulePersist();
    notifyDraftChange();
    setStatus('');
  });

  chipsHost.addEventListener('click', (event) => {
    if (syncing) return;
    const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-char-id]');
    if (!chip) return;
    const id = chip.dataset.charId!;
    // Voice Character Lock: while locked on a custom voice, block switching to a
    // preset chip (it would overwrite the tuned graph) and remind via toast. Fires
    // on every guarded click — the shared toast dedupes identical repeats itself.
    const guard = guardVoiceCharacterSwitch(
      isVoiceCharacterLocked(),
      { characterPresetId: draftConfig.characterPresetId },
      { characterPresetId: id },
    );
    if (!guard.allowed) {
      showToast(guard.reason ?? LOCK_GUARD_CUSTOM_REASON, 'info');
      return;
    }
    // Explicitly clear graph so the character takes precedence in resolveVoiceGraph.
    draftConfig = normalizeVoiceEffectConfig({
      ...mergeLiveToggles(draftConfig),
      characterPresetId: id,
      graph: undefined,
      enabled: true,
    });
    syncControlsFromDraft();
    schedulePersist();
    setStatus('Character voice set — Test to hear the rendered result.');
  });

  // Voice Character Lock — toggle the transient guard (custom voice only).
  lockBtn.addEventListener('click', () => {
    setVoiceCharacterLock(!isVoiceCharacterLocked());
    updateVoiceIdentity();
  });

  // Clipboard Voice Character Backup — copy the live voice character as versioned JSON.
  copyBtn.addEventListener('click', () => {
    const config = normalizeVoiceEffectConfig(mergeLiveToggles(draftConfig));
    void copyVoiceCharacterToClipboard(config).then((result) => {
      showToast(result.message ?? '', result.success ? 'info' : 'error');
    });
  });

  // Paste a voice character → apply to the live draft exactly like a manual edit so
  // the existing dirty/save pathway (Update / Save to new) lights up. Never auto-saves.
  pasteBtn.addEventListener('click', () => {
    void pasteVoiceCharacterFromClipboard().then((result) => {
      if (!result.success || !result.config) {
        showToast(result.message ?? 'Nothing usable on the clipboard', 'info');
        return;
      }
      draftConfig = result.config;
      syncControlsFromDraft();
      schedulePersist();
      showToast(result.message ?? '', 'info');
    });
  });

  // Dulcet II (v5) one-shot preview: render the ACTIVE graph (character preset or migrated
  // legacy config) through ffmpeg.wasm on the last recording, then play it dry. Uses the same
  // resolveVoiceGraph() as the live export, so what you hear here is what bakes.
  testBtn.addEventListener('click', () => {
    if (rendering) return;
    void (async () => {
      if (!lastRecording) {
        setStatus('No saved recording yet — record a voice note on Reddit, or use One-Time Test to audition with your mic now.');
        return;
      }

      const config = mergeLiveToggles(draftConfig);
      const graph = resolveVoiceGraph(config);
      if (!stylizedGraphIsActive(graph)) {
        setStatus('No active effect to test — enable voice effects or pick a character voice.');
        return;
      }

      preview.stop();
      refreshStopUi();
      setRendering(true);
      setStatus('Rendering character voice… (one-shot, a few seconds)');

      try {
        // Lazy chunk: keeps ffmpeg.wasm glue out of the Studio's initial load.
        const { processAudioWithGraph } = await import('@/src/voice/process-audio');
        const result = await processAudioWithGraph(
          lastRecording.blob,
          graph,
          (ratio) => {
            setStatus(`Rendering character voice… ${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`);
          },
          { maxDurationSeconds: PREVIEW_MAX_SECONDS },
        );
        await preview.playProcessed(result.blob);
        refreshStopUi();

        const trimmed = (lastRecording.meta.durationSeconds ?? 0) > PREVIEW_MAX_SECONDS;
        const baseMsg = result.applied
          ? 'Playing rendered character voice — this is what bakes.'
          : 'Played original — no effect was applied (check console).';
        setStatus(
          trimmed
            ? `${baseMsg} (Preview limited to first ${PREVIEW_MAX_SECONDS}s; the bake processes the full recording.)`
            : baseMsg,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus(`Test failed: ${detail}`);
      } finally {
        setRendering(false);
      }
    })();
  });

  // v5.3.1 live-mic preview: capture the user's OWN voice, then render it through the
  // exact same path as the character test above (resolveVoiceGraph → processAudioWithGraph
  // → shared single preview). The capture never persists — mic-test-capture.ts imports no
  // storage, so the last recording in browser memory is untouched.
  micTestBtn.addEventListener('click', () => {
    if (rendering || capturing) return;

    const config = mergeLiveToggles(draftConfig);
    const graph = resolveVoiceGraph(config);
    if (!stylizedGraphIsActive(graph)) {
      setStatus('No active effect to test — enable voice effects or pick a character voice.');
      return;
    }

    preview.stop();
    refreshStopUi();
    setCapturing(true);
    setStatus('Requesting microphone…');

    const prefsForCapture = audioPrefs;
    const session = startMicTestCapture({
      maxDurationMs: MIC_TEST_DEFAULT_MAX_MS,
      // Match the real recorder's mic constraints when prefs are loaded (raw/enhanced +
      // fallback ladder); otherwise the capture util's plain default applies.
      acquireStream: prefsForCapture ? () => acquireMicStream(prefsForCapture) : undefined,
      onStart: () => setStatus('Recording… speak now, then “Stop & render”.'),
      onAutoStop: () => setStatus('Reached the time limit — rendering…'),
      onLevel: (level) => setMeter(level),
    });
    capture = session;

    session.done.then(
      (blob) => {
        if (capture === session) capture = null;
        setCapturing(false);
        void renderCaptured(blob, graph);
      },
      (error: unknown) => {
        if (capture === session) capture = null;
        setCapturing(false);
        const code = error instanceof MicTestCaptureError ? error.code : 'capture-failed';
        const message = captureErrorMessage(code);
        setStatus(message);
        if (code !== 'aborted-empty') {
          showToast(message, code === 'permission-denied' ? 'error' : 'info');
        }
      },
    );
  });

  // One shared Stop button for both modes (only one runs at a time): while capturing it
  // flushes the mic clip (→ render); otherwise it halts the rendered playback.
  stopBtn.addEventListener('click', () => {
    if (capturing) {
      capture?.stop();
      return;
    }
    preview.stop();
    refreshStopUi();
    setStatus('Preview stopped.');
  });

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      void loadRecordingSource();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);

  // CHANGED: poll + storage signal while studio stays open after a Reddit recording.
  // WHY: last WebM lands via background relay; visibilitychange alone missed in-tab updates.
  const pollTimer = window.setInterval(() => {
    void loadRecordingSource();
  }, RECORDING_POLL_MS);

  const onRecordingReady = (changes: Record<string, unknown>, area: string): void => {
    if (area !== 'local' || !(LAST_RECORDING_READY_KEY in changes)) return;
    void loadRecordingSource();
  };
  browser.storage.onChanged.addListener(onRecordingReady);

  void loadUserPreferences().then((prefs) => {
    draftConfig = normalizeVoiceEffectConfig(prefs.voiceEffect);
    currentProfileName = activeProfileNameFrom(prefs);
    audioPrefs = prefs.audio;
    syncControlsFromDraft();
  });

  refreshTestEmphasis();
  void loadRecordingSource();

  const playPoll = window.setInterval(() => {
    refreshStopUi();
  }, 200);

  return {
    getDraftConfig() {
      return normalizeVoiceEffectConfig(mergeLiveToggles(draftConfig));
    },
    syncFromPreferences(prefs) {
      syncing = true;
      draftConfig = normalizeVoiceEffectConfig(prefs.voiceEffect);
      currentProfileName = activeProfileNameFrom(prefs);
      audioPrefs = prefs.audio;
      syncControlsFromDraft();
      syncing = false;
    },
    flushPersist() {
      return writeDraftNow();
    },
    dispose() {
      window.clearInterval(playPoll);
      window.clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      browser.storage.onChanged.removeListener(onRecordingReady);
      if (saveTimer) window.clearTimeout(saveTimer);
      unwireIntensitySlider();
      persistNow();
      // Stop any in-flight mic capture (stops tracks + closes the meter AudioContext).
      capture?.cancel();
      capture = null;
      composer.dispose();
      preview.dispose();
    },
  };
}