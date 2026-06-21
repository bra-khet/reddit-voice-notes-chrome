import { formatRecordingCapClock } from '@/src/utils/constants';
import { loadLastRecording, type LastRecordingSnapshot } from '@/src/storage/last-recording-db';
import { loadUserPreferences, saveVoiceEffectPreferences } from '@/src/settings/user-preferences';
import { mountRadialKnob } from '@/src/ui/design-studio/radial-knob';
import { VOICE_EFFECT_PRESETS, voiceConfigFromPreset } from '@/src/voice/presets';
import { createVoicePreviewPlayer } from '@/src/voice/preview-chain';
import {
  DEFAULT_VOICE_EFFECT_CONFIG,
  normalizeVoiceEffectConfig,
  VOICE_SEMITONE_MAX,
  VOICE_SEMITONE_MIN,
  type VoiceEffectConfig,
  type VoiceEffectPresetId,
} from '@/src/voice/types';

export interface VoiceControlsHandle {
  dispose(): void;
  getDraftConfig(): VoiceEffectConfig;
}

const VOICE_SAVE_DEBOUNCE_MS = 250;

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
      <p class="studio__voice-preset-hint popup__field-desc">
        Presets include special SFX — not just pitch. The knob is for custom pitch only.
      </p>
      <div class="studio__voice-pitch">
        <div class="studio__knob-host" data-voice-pitch-mount></div>
      </div>
      <div class="studio__voice-actions">
        <button type="button" class="popup__profile-btn popup__profile-btn--save" data-voice-play>
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

export function mountVoiceControls(root: HTMLElement): VoiceControlsHandle {
  const panel = root.querySelector<HTMLElement>('[data-voice-controls]')!;
  const sourceEl = panel.querySelector<HTMLElement>('[data-voice-source]')!;
  const enabledInput = panel.querySelector<HTMLInputElement>('[data-voice-enabled]')!;
  const presetSelect = panel.querySelector<HTMLSelectElement>('[data-voice-preset]')!;
  const pitchMount = panel.querySelector<HTMLElement>('[data-voice-pitch-mount]')!;
  const playBtn = panel.querySelector<HTMLButtonElement>('[data-voice-play]')!;
  const stopBtn = panel.querySelector<HTMLButtonElement>('[data-voice-stop]')!;
  const statusEl = panel.querySelector<HTMLElement>('[data-voice-status]')!;

  let draftConfig: VoiceEffectConfig = normalizeVoiceEffectConfig(DEFAULT_VOICE_EFFECT_CONFIG);
  let lastRecording: LastRecordingSnapshot | null = null;
  let syncing = false;
  let saveTimer = 0;

  const preview = createVoicePreviewPlayer();

  for (const preset of VOICE_EFFECT_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    presetSelect.appendChild(option);
  }

  const pitchKnob = mountRadialKnob(pitchMount, {
    min: VOICE_SEMITONE_MIN,
    max: VOICE_SEMITONE_MAX,
    value: 0,
    label: 'Pitch',
    ariaLabel: 'Pitch shift in semitones',
    onChange: (semitones) => {
      if (syncing) return;
      draftConfig = normalizeVoiceEffectConfig({
        ...draftConfig,
        enabled: enabledInput.checked,
        presetId: 'custom',
        pitchShift: {
          semitones,
          preserveDuration: true,
          exaggerateNatural: draftConfig.pitchShift?.exaggerateNatural ?? false,
        },
      });
      presetSelect.value = 'custom';
      schedulePersist();
      setStatus('');
    },
  });

  function setStatus(message: string): void {
    statusEl.textContent = message;
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

  function syncControlsFromDraft(): void {
    syncing = true;
    enabledInput.checked = draftConfig.enabled;
    presetSelect.value = draftConfig.presetId ?? 'custom';
    pitchKnob.setValue(draftConfig.pitchShift?.semitones ?? 0, true);
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

  async function loadRecordingSource(): Promise<void> {
    lastRecording = await loadLastRecording();
    if (lastRecording) {
      try {
        await preview.setSource(lastRecording.blob);
        setStatus('Recording loaded — choose a preset and play preview.');
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus(`Could not load last recording: ${detail}`);
      }
    } else {
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
  });

  presetSelect.addEventListener('change', () => {
    if (syncing) return;
    const presetId = presetSelect.value as VoiceEffectPresetId;
    draftConfig = voiceConfigFromPreset(presetId);
    draftConfig.enabled = enabledInput.checked;
    syncControlsFromDraft();
    schedulePersist();
    setStatus('');
  });

  playBtn.addEventListener('click', () => {
    void (async () => {
      if (!preview.hasSource()) {
        setStatus('Record a voice note first, then reopen Design Studio to preview.');
        return;
      }

      draftConfig.enabled = enabledInput.checked;
      const config = normalizeVoiceEffectConfig(draftConfig);
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
      return normalizeVoiceEffectConfig({
        ...draftConfig,
        enabled: enabledInput.checked,
      });
    },
    dispose() {
      window.clearInterval(playPoll);
      document.removeEventListener('visibilitychange', onVisibility);
      if (saveTimer) window.clearTimeout(saveTimer);
      persistNow();
      preview.dispose();
    },
  };
}