import { formatRecordingCapClock } from '@/src/utils/constants';
import { loadLastRecording, type LastRecordingSnapshot } from '@/src/storage/last-recording-db';
import {
  LAST_RECORDING_READY_KEY,
  loadUserPreferences,
  saveVoiceEffectPreferences,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';
import { mountRadialKnob } from '@/src/ui/design-studio/radial-knob';
import { getVoiceEffectPreset, VOICE_EFFECT_PRESETS } from '@/src/voice/presets';
import { CHARACTER_PRESETS, resolveVoiceGraph, stylizedGraphIsActive } from '@/src/voice/dsp';
import { createVoicePreviewPlayer } from '@/src/voice/preview-chain';
import { resolveVoiceEffectConfig } from '@/src/voice/resolve-config';
import {
  DEFAULT_VOICE_EFFECT_CONFIG,
  normalizeVoiceEffectConfig,
  VOICE_INTENSITY_MAX,
  VOICE_INTENSITY_MIN,
  VOICE_INTENSITY_TURBO,
  VOICE_SEMITONE_MAX,
  VOICE_SEMITONE_MIN,
  type VoiceEffectConfig,
  type VoiceEffectPresetId,
} from '@/src/voice/types';

export interface VoiceControlsHandle {
  dispose(): void;
  getDraftConfig(): VoiceEffectConfig;
  syncFromPreferences(prefs: UserPreferencesV1): void;
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
      <label class="popup__field studio__field--compact">
        <span class="popup__field-label">Voice preset</span>
        <select class="popup__select" data-voice-preset aria-label="Voice preset"></select>
      </label>
      <p class="studio__voice-preset-tip popup__field-desc" data-voice-preset-tip hidden></p>
      <label class="popup__field studio__field--compact">
        <span class="popup__field-label">Character voice (v5)</span>
        <select class="popup__select" data-character-preset aria-label="Character voice preset"></select>
      </label>
      <p class="studio__voice-preset-desc popup__field-desc" data-character-note hidden>
        Character voice overrides the preset above on bake. Use “Test character voice” to hear
        the real rendered result; “Play preview” is a quick legacy approximation only.
      </p>
      <p class="studio__voice-preset-hint popup__field-desc">
        Presets include special SFX — intensity modulates the selected preset.
        The pitch knob switches to Custom for manual pitch only.
      </p>
      <label class="popup__field studio__field--compact studio__voice-intensity">
        <span class="popup__field-label">
          Intensity <span data-voice-intensity-value>10/10</span>
        </span>
        <input
          class="popup__range"
          type="range"
          min="${VOICE_INTENSITY_MIN}"
          max="${VOICE_INTENSITY_MAX}"
          step="1"
          value="10"
          data-voice-intensity
          aria-label="Voice effect intensity"
        />
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
      <div class="studio__voice-pitch">
        <div class="studio__knob-host" data-voice-pitch-mount></div>
      </div>
      <div class="studio__voice-actions">
        <button type="button" class="popup__profile-btn popup__profile-btn--save" data-voice-test>
          Test character voice
        </button>
        <button type="button" class="popup__button popup__button--secondary" data-voice-play>
          Play preview
        </button>
        <button type="button" class="popup__button popup__button--secondary" data-voice-stop hidden>
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

export function mountVoiceControls(
  root: HTMLElement,
  onDraftChange?: () => void,
): VoiceControlsHandle {
  const panel = root.querySelector<HTMLElement>('[data-voice-controls]')!;
  const sourceEl = panel.querySelector<HTMLElement>('[data-voice-source]')!;
  const enabledInput = panel.querySelector<HTMLInputElement>('[data-voice-enabled]')!;
  const presetSelect = panel.querySelector<HTMLSelectElement>('[data-voice-preset]')!;
  const presetTipEl = panel.querySelector<HTMLElement>('[data-voice-preset-tip]')!;
  const characterSelect = panel.querySelector<HTMLSelectElement>('[data-character-preset]')!;
  const characterNote = panel.querySelector<HTMLElement>('[data-character-note]')!;
  const pitchMount = panel.querySelector<HTMLElement>('[data-voice-pitch-mount]')!;
  const intensityInput = panel.querySelector<HTMLInputElement>('[data-voice-intensity]')!;
  const intensityValueEl = panel.querySelector<HTMLElement>('[data-voice-intensity-value]')!;
  const turboInput = panel.querySelector<HTMLInputElement>('[data-voice-turbo]')!;
  const testBtn = panel.querySelector<HTMLButtonElement>('[data-voice-test]')!;
  const playBtn = panel.querySelector<HTMLButtonElement>('[data-voice-play]')!;
  const stopBtn = panel.querySelector<HTMLButtonElement>('[data-voice-stop]')!;
  const statusEl = panel.querySelector<HTMLElement>('[data-voice-status]')!;

  let draftConfig: VoiceEffectConfig = normalizeVoiceEffectConfig(DEFAULT_VOICE_EFFECT_CONFIG);
  let lastRecording: LastRecordingSnapshot | null = null;
  let loadedSavedAt = 0;
  let syncing = false;
  let rendering = false;
  let saveTimer = 0;

  const preview = createVoicePreviewPlayer();

  for (const preset of VOICE_EFFECT_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    presetSelect.appendChild(option);
  }

  const characterNone = document.createElement('option');
  characterNone.value = '';
  characterNone.textContent = '— None (use preset above) —';
  characterSelect.appendChild(characterNone);
  for (const preset of CHARACTER_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    option.title = preset.blurb;
    characterSelect.appendChild(option);
  }

  const pitchKnob = mountRadialKnob(pitchMount, {
    min: VOICE_SEMITONE_MIN,
    max: VOICE_SEMITONE_MAX,
    value: 0,
    label: 'Pitch',
    ariaLabel: 'Pitch shift in semitones',
    onChange: (semitones) => {
      if (syncing) return;
      const resolved = resolveVoiceEffectConfig({
        ...draftConfig,
        enabled: enabledInput.checked,
      });
      // BUG FIX: pitch knob should fork to Custom without dropping preset SFX snapshot
      // Fix: resolve active preset first, then override pitch and mark custom
      draftConfig = normalizeVoiceEffectConfig({
        ...resolved,
        enabled: enabledInput.checked,
        presetId: 'custom',
        pitchShift: {
          semitones,
          preserveDuration: true,
          exaggerateNatural: resolved.pitchShift?.exaggerateNatural ?? false,
        },
      });
      presetSelect.value = 'custom';
      schedulePersist();
      notifyDraftChange();
      setStatus('');
    },
  });

  function setStatus(message: string): void {
    statusEl.textContent = message;
  }

  function updatePresetTip(): void {
    const presetId = (draftConfig.presetId ?? 'custom') as VoiceEffectPresetId;
    const hint = getVoiceEffectPreset(presetId).usageHint;
    if (hint) {
      presetTipEl.textContent = hint;
      presetTipEl.hidden = false;
      return;
    }
    presetTipEl.textContent = '';
    presetTipEl.hidden = true;
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

  function persistNow(): void {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
    }
    draftConfig.enabled = enabledInput.checked;
    void saveVoiceEffectPreferences(draftConfig).catch((error: unknown) => {
      console.warn('[Reddit Voice Notes] Voice prefs save failed', error);
    });
  }

  function updateIntensityUi(): void {
    const turbo = draftConfig.turbo === true;
    const intensity = turbo
      ? VOICE_INTENSITY_TURBO
      : (draftConfig.intensity ?? VOICE_INTENSITY_MAX);
    intensityInput.disabled = turbo;
    intensityInput.value = String(
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
        : clampIntensity(Number(intensityInput.value)),
      turbo: turboInput.checked,
    });
  }

  function resolvedDraft(): VoiceEffectConfig {
    return resolveVoiceEffectConfig(mergeLiveToggles(draftConfig));
  }

  function syncControlsFromDraft(): void {
    syncing = true;
    enabledInput.checked = draftConfig.enabled;
    presetSelect.value = draftConfig.presetId ?? 'custom';
    characterSelect.value = draftConfig.characterPresetId ?? '';
    characterNote.hidden = !draftConfig.characterPresetId;
    pitchKnob.setValue(resolvedDraft().pitchShift?.semitones ?? 0, true);
    updateIntensityUi();
    updatePresetTip();
    updatePlayAvailability();
    notifyDraftChange();
    syncing = false;
  }

  function updateSourceCopy(): void {
    if (!lastRecording) {
      sourceEl.textContent = `No recording yet — record a voice note (up to ${formatRecordingCapClock()}), then reopen Design Studio.`;
      return;
    }

    const { meta } = lastRecording;
    const kb = Math.round(meta.byteLength / 1024);
    sourceEl.textContent = `Last recording: ${formatDuration(meta.durationSeconds)} · ${kb} KB · ${formatSavedAt(meta.savedAt)}`;
  }

  function refreshPlayStopUi(): void {
    const isPlaying = preview.isPlaying();
    playBtn.hidden = isPlaying;
    stopBtn.hidden = !isPlaying;
  }

  function setRendering(active: boolean): void {
    rendering = active;
    testBtn.disabled = active;
    testBtn.textContent = active ? 'Rendering…' : 'Test character voice';
  }

  // 3.3 edge case: the real-time Web Audio chain (legacy pitch/EQ/compressor only) cannot
  // reproduce a v5 character graph — its renderer ignores characterPresetId. So when a
  // character voice is active, steer the user to the authoritative one-shot Test instead of
  // letting "Play preview" play a misleading near-raw approximation.
  function updatePlayAvailability(): void {
    const characterActive = Boolean(draftConfig.characterPresetId);
    playBtn.disabled = characterActive;
    playBtn.title = characterActive
      ? 'Live preview can’t reproduce v5 character voices — use “Test character voice”.'
      : '';
  }

  async function loadRecordingSource(): Promise<void> {
    const snapshot = await loadLastRecording();
    const savedAt = snapshot?.meta.savedAt ?? 0;
    if (snapshot && savedAt <= loadedSavedAt && lastRecording) {
      return;
    }

    if (preview.isPlaying()) {
      preview.stop();
      refreshPlayStopUi();
    }

    lastRecording = snapshot;
    loadedSavedAt = savedAt;

    if (lastRecording) {
      try {
        await preview.setSource(lastRecording.blob);
        setStatus('Recording loaded — choose a preset and play preview.');
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus(`Could not load last recording: ${detail}`);
      }
    } else {
      loadedSavedAt = 0;
      setStatus('');
    }
    updateSourceCopy();
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

  intensityInput.addEventListener('input', () => {
    if (syncing || turboInput.checked) return;
    // BUG FIX: intensity slider latched to Custom preset
    // Fix: keep active bundled presetId — intensity only modulates its SFX at preview/export
    draftConfig = normalizeVoiceEffectConfig({
      ...draftConfig,
      enabled: enabledInput.checked,
      intensity: clampIntensity(Number(intensityInput.value)),
      turbo: false,
    });
    intensityValueEl.textContent = `${draftConfig.intensity ?? VOICE_INTENSITY_MAX}/${VOICE_INTENSITY_MAX}`;
    schedulePersist();
    notifyDraftChange();
    setStatus('');
  });

  turboInput.addEventListener('change', () => {
    if (syncing) return;
    const turbo = turboInput.checked;
    draftConfig = normalizeVoiceEffectConfig({
      ...draftConfig,
      enabled: enabledInput.checked,
      turbo,
      intensity: turbo ? VOICE_INTENSITY_TURBO : clampIntensity(Number(intensityInput.value)),
    });
    updateIntensityUi();
    schedulePersist();
    notifyDraftChange();
    setStatus('');
  });

  presetSelect.addEventListener('change', () => {
    if (syncing) return;
    const presetId = presetSelect.value as VoiceEffectPresetId;
    draftConfig = mergeLiveToggles({
      enabled: enabledInput.checked,
      presetId,
      intensity: clampIntensity(Number(intensityInput.value)),
      turbo: turboInput.checked,
    });
    syncControlsFromDraft();
    schedulePersist();
    setStatus('');
  });

  characterSelect.addEventListener('change', () => {
    if (syncing) return;
    const id = characterSelect.value || undefined;
    draftConfig = normalizeVoiceEffectConfig({
      ...draftConfig,
      enabled: id ? true : draftConfig.enabled,
      characterPresetId: id,
      intensity: clampIntensity(Number(intensityInput.value)),
      turbo: turboInput.checked,
    });
    syncControlsFromDraft();
    schedulePersist();
    setStatus(id ? 'Character voice set — bake to hear it.' : '');
  });

  // Dulcet II (v5) one-shot preview: render the ACTIVE graph (character preset or migrated
  // legacy config) through ffmpeg.wasm on the last recording, then play it dry. Uses the same
  // resolveVoiceGraph() as the live export, so what you hear here is what bakes.
  testBtn.addEventListener('click', () => {
    if (rendering) return;
    void (async () => {
      if (!lastRecording) {
        setStatus('Record a voice note first, then reopen Design Studio to test.');
        return;
      }

      const config = mergeLiveToggles(draftConfig);
      const graph = resolveVoiceGraph(config);
      if (!stylizedGraphIsActive(graph)) {
        setStatus('No active effect to test — enable voice effects or pick a character voice.');
        return;
      }

      preview.stop();
      refreshPlayStopUi();
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
        refreshPlayStopUi();

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

  playBtn.addEventListener('click', () => {
    void (async () => {
      if (!preview.hasSource()) {
        setStatus('Record a voice note first, then reopen Design Studio to preview.');
        return;
      }

      if (draftConfig.characterPresetId) {
        setStatus('Live preview can’t reproduce v5 character voices — use “Test character voice”.');
        return;
      }

      const config = resolveVoiceEffectConfig(mergeLiveToggles(draftConfig));
      try {
        setStatus(config.enabled ? 'Playing with voice effects…' : 'Playing original audio…');
        await preview.play(config);
        refreshPlayStopUi();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus(`Preview failed: ${detail}`);
        refreshPlayStopUi();
      }
    })();
  });

  stopBtn.addEventListener('click', () => {
    preview.stop();
    refreshPlayStopUi();
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
    syncControlsFromDraft();
  });

  void loadRecordingSource();

  const playPoll = window.setInterval(() => {
    refreshPlayStopUi();
  }, 200);

  return {
    getDraftConfig() {
      return normalizeVoiceEffectConfig(mergeLiveToggles(draftConfig));
    },
    syncFromPreferences(prefs) {
      syncing = true;
      draftConfig = normalizeVoiceEffectConfig(prefs.voiceEffect);
      syncControlsFromDraft();
      syncing = false;
    },
    dispose() {
      window.clearInterval(playPoll);
      window.clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      browser.storage.onChanged.removeListener(onRecordingReady);
      if (saveTimer) window.clearTimeout(saveTimer);
      persistNow();
      preview.dispose();
    },
  };
}