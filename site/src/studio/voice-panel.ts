/**
 * Static Voice Studio — the voice authoring panel.
 *
 * Mirrors the extension's `voice-controls.ts` panel (enable, character chips,
 * intensity/Turbo, the composer, live summary) over the verbatim-ported voice
 * model, minus the extension-only bits (profile persistence, IDB recording
 * source). Audition (Phase 3) and copy/paste transfer (Phase 4) mount into the
 * exposed slots, and read live state via the returned handle — so this module
 * stays the single owner of the draft VoiceEffectConfig.
 */
import {
  buildStylizedGraph,
  CHARACTER_PRESETS,
  resolveVoiceGraph,
  type StylizedGraph,
} from '@/src/voice/dsp';
import {
  DEFAULT_VOICE_EFFECT_CONFIG,
  normalizeVoiceEffectConfig,
  VOICE_INTENSITY_MAX,
  VOICE_INTENSITY_MIN,
  VOICE_INTENSITY_TURBO,
  type VoiceEffectConfig,
} from '@/src/voice/types';
import { formatVoiceEffectSummary } from '@/src/voice/voice-summary';
import { mountComposer, type ComposerHandle } from './composer';

export interface VoicePanelHandle {
  /** Live, normalized config with the enable/intensity/Turbo toggles merged in. */
  getConfig(): VoiceEffectConfig;
  /** Apply a config to the panel (e.g. a pasted voice) like a manual edit. */
  setConfig(config: VoiceEffectConfig): void;
  /** Observe live config changes; returns an unsubscribe fn. */
  subscribe(listener: (config: VoiceEffectConfig) => void): () => void;
  /** Container Phase 4 (copy/paste) mounts into. */
  transferSlot: HTMLElement;
  /** Container Phase 3 (audition) mounts into. */
  auditionSlot: HTMLElement;
  dispose(): void;
}

function clampIntensity(value: number): number {
  return Math.min(VOICE_INTENSITY_MAX, Math.max(VOICE_INTENSITY_MIN, Math.round(value)));
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function mountVoicePanel(host: HTMLElement): VoicePanelHandle {
  let draft = normalizeVoiceEffectConfig(DEFAULT_VOICE_EFFECT_CONFIG);
  let syncing = false;
  const listeners = new Set<(config: VoiceEffectConfig) => void>();

  const chipButtons = CHARACTER_PRESETS.map(
    (preset) =>
      `<button type="button" class="voice-panel__chip" data-char-id="${escapeAttr(preset.id)}"
         title="${escapeAttr(preset.blurb)}">${escapeAttr(preset.label)}</button>`,
  ).join('');

  host.classList.add('voice-panel');
  host.innerHTML = `
    <div class="voice-panel__head">
      <h2 class="voice-panel__title">Voice</h2>
      <span class="voice-panel__summary" data-summary aria-live="polite">Off</span>
    </div>

    <label class="voice-panel__toggle">
      <span>
        <span class="voice-panel__toggle-label">Voice effects</span>
        <span class="voice-panel__desc">Master switch — what bakes when enabled.</span>
      </span>
      <input type="checkbox" data-enabled aria-label="Enable voice effects" />
    </label>

    <section class="voice-panel__chars">
      <span class="voice-panel__field-label">Character voice</span>
      <p class="voice-panel__desc">Pick a character to start, then tweak it below into a custom voice.</p>
      <div class="voice-panel__chips" data-chips>${chipButtons}</div>
      <span class="voice-panel__status" data-char-status hidden></span>
      <p class="voice-panel__desc" data-char-note></p>
    </section>

    <div class="voice-panel__transfer" data-transfer-slot></div>

    <label class="voice-panel__field">
      <span class="voice-panel__field-label">Intensity <span data-intensity-value>10/10</span></span>
      <input type="range" class="voice-panel__intensity" data-intensity
        min="${VOICE_INTENSITY_MIN}" max="${VOICE_INTENSITY_MAX}" step="1" value="${VOICE_INTENSITY_MAX}"
        aria-label="Voice effect intensity" />
    </label>

    <label class="voice-panel__toggle">
      <span>
        <span class="voice-panel__toggle-label">Turbo</span>
        <span class="voice-panel__desc">Extra punch — maps to magic intensity ${VOICE_INTENSITY_TURBO}.</span>
      </span>
      <input type="checkbox" data-turbo aria-label="Turbo voice effect boost" />
    </label>

    <div class="voice-panel__composer" data-composer></div>

    <div class="voice-panel__audition" data-audition-slot></div>

    <details class="voice-panel__graph">
      <summary>FFmpeg filter graph — <em>what bakes</em></summary>
      <pre class="voice-panel__graph-pre" data-filter-graph aria-live="polite"></pre>
    </details>
  `;

  const enabledInput = host.querySelector<HTMLInputElement>('[data-enabled]')!;
  const chipsHost = host.querySelector<HTMLElement>('[data-chips]')!;
  const charStatusEl = host.querySelector<HTMLElement>('[data-char-status]')!;
  const charNoteEl = host.querySelector<HTMLElement>('[data-char-note]')!;
  const intensityInput = host.querySelector<HTMLInputElement>('[data-intensity]')!;
  const intensityValueEl = host.querySelector<HTMLElement>('[data-intensity-value]')!;
  const turboInput = host.querySelector<HTMLInputElement>('[data-turbo]')!;
  const composerHost = host.querySelector<HTMLElement>('[data-composer]')!;
  const summaryEl = host.querySelector<HTMLElement>('[data-summary]')!;
  const filterGraphEl = host.querySelector<HTMLElement>('[data-filter-graph]')!;
  const transferSlot = host.querySelector<HTMLElement>('[data-transfer-slot]')!;
  const auditionSlot = host.querySelector<HTMLElement>('[data-audition-slot]')!;

  function mergeLiveToggles(config: VoiceEffectConfig): VoiceEffectConfig {
    return normalizeVoiceEffectConfig({
      ...config,
      enabled: enabledInput.checked,
      intensity: turboInput.checked ? VOICE_INTENSITY_TURBO : clampIntensity(Number(intensityInput.value)),
      turbo: turboInput.checked,
    });
  }

  const resolvedDraft = (): VoiceEffectConfig => mergeLiveToggles(draft);

  function notify(): void {
    const config = resolvedDraft();
    for (const listener of listeners) listener(config);
  }

  function updateSummary(): void {
    summaryEl.textContent = formatVoiceEffectSummary(resolvedDraft());
  }

  function updateFilterGraph(): void {
    const result = buildStylizedGraph(resolveVoiceGraph(resolvedDraft()));
    if (result.mode === 'none') {
      filterGraphEl.textContent = '# voice off — no FFmpeg pass runs';
    } else if (result.mode === 'af') {
      filterGraphEl.textContent = `# linear chain\nffmpeg -i in -af "${result.af}" out`;
    } else {
      const aux = result.auxInputs.length;
      filterGraphEl.textContent =
        `# parallel graph (${aux} generated aux input${aux === 1 ? '' : 's'}: procedural reverb IR / carriers)\n` +
        `-filter_complex "${result.filterComplex}"\n-map "[${result.outputLabel}]"`;
    }
  }

  function updateIntensityUi(): void {
    const turbo = draft.turbo === true;
    intensityInput.disabled = turbo;
    intensityInput.value = String(turbo ? VOICE_INTENSITY_MAX : clampIntensity(draft.intensity ?? VOICE_INTENSITY_MAX));
    intensityValueEl.textContent = turbo
      ? `Turbo (${VOICE_INTENSITY_TURBO})`
      : `${clampIntensity(draft.intensity ?? VOICE_INTENSITY_MAX)}/${VOICE_INTENSITY_MAX}`;
    turboInput.checked = turbo;
  }

  function updateIdentity(): void {
    const characterId = draft.characterPresetId;
    const isCustomGraph = !characterId && (draft.graph?.fragments.length ?? 0) > 0;
    for (const chip of chipsHost.querySelectorAll<HTMLElement>('.voice-panel__chip')) {
      chip.classList.toggle('is-selected', characterId !== undefined && chip.dataset.charId === characterId);
    }
    if (isCustomGraph) {
      charStatusEl.textContent = '★ Custom voice';
      charStatusEl.hidden = false;
    } else {
      charStatusEl.textContent = '';
      charStatusEl.hidden = true;
    }
    charNoteEl.textContent = characterId
      ? 'Editing any effect below makes this a custom voice.'
      : '';
  }

  function refreshDerived(): void {
    updateIdentity();
    updateSummary();
    updateFilterGraph();
  }

  // Seed-then-tweak fork: the first composer edit materializes draft.graph and
  // clears characterPresetId (custom graph then wins in resolveVoiceGraph).
  function onComposerChange(nextGraph: StylizedGraph): void {
    if (syncing) return;
    const hasFragments = nextGraph.fragments.length > 0;
    draft = normalizeVoiceEffectConfig({
      ...mergeLiveToggles(draft),
      characterPresetId: undefined,
      graph: nextGraph,
      enabled: hasFragments ? true : enabledInput.checked,
    });
    enabledInput.checked = draft.enabled;
    refreshDerived();
    notify();
  }

  const composer: ComposerHandle = mountComposer(composerHost, {
    initialGraph: resolveVoiceGraph(resolvedDraft()),
    onChange: onComposerChange,
  });

  function syncControlsFromDraft(): void {
    syncing = true;
    enabledInput.checked = draft.enabled;
    composer.setGraph(resolveVoiceGraph(resolvedDraft()));
    updateIntensityUi();
    refreshDerived();
    syncing = false;
  }

  enabledInput.addEventListener('change', () => {
    if (syncing) return;
    draft = normalizeVoiceEffectConfig({ ...draft, enabled: enabledInput.checked });
    updateSummary();
    updateFilterGraph();
    notify();
  });

  intensityInput.addEventListener('input', () => {
    if (syncing || turboInput.checked) return;
    draft = normalizeVoiceEffectConfig({
      ...draft,
      enabled: enabledInput.checked,
      intensity: clampIntensity(Number(intensityInput.value)),
      turbo: false,
    });
    intensityValueEl.textContent = `${draft.intensity ?? VOICE_INTENSITY_MAX}/${VOICE_INTENSITY_MAX}`;
    updateSummary();
    updateFilterGraph();
    notify();
  });

  turboInput.addEventListener('change', () => {
    if (syncing) return;
    const turbo = turboInput.checked;
    draft = normalizeVoiceEffectConfig({
      ...draft,
      enabled: enabledInput.checked,
      turbo,
      intensity: turbo ? VOICE_INTENSITY_TURBO : clampIntensity(Number(intensityInput.value)),
    });
    updateIntensityUi();
    updateSummary();
    updateFilterGraph();
    notify();
  });

  chipsHost.addEventListener('click', (event) => {
    if (syncing) return;
    const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-char-id]');
    if (!chip) return;
    const id = chip.dataset.charId!;
    draft = normalizeVoiceEffectConfig({
      ...mergeLiveToggles(draft),
      characterPresetId: id,
      graph: undefined,
      enabled: true,
    });
    syncControlsFromDraft();
    notify();
  });

  refreshDerived();

  return {
    getConfig: () => resolvedDraft(),
    setConfig(config: VoiceEffectConfig) {
      draft = normalizeVoiceEffectConfig(config);
      syncControlsFromDraft();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    transferSlot,
    auditionSlot,
    dispose() {
      composer.dispose();
      listeners.clear();
      host.innerHTML = '';
      host.classList.remove('voice-panel');
    },
  };
}
