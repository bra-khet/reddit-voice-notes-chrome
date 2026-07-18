import {
  DEFAULT_VISUALIZER_PARAMS,
  MAX_STACKABLE_EFFECTS,
  OVERLAY_PRESET_IDS,
  SPECTRUM_PRESET_IDS,
  STACKABLE_EFFECT_IDS,
  getAudioVisualDefinition,
  getStackableEffectDefinition,
  resolveVisualizerParams,
  type LayoutMode,
  type OverlayPresetId,
  type SpectrumPresetId,
  type StackableEffectId,
  type VisualizerParams,
} from '@/src/theme/audio-reactive';
import { evaluateVisualPerformance } from '@/src/theme/audio-reactive/performance-governor';
import { registerCoreOverlayVisuals, VOID_INFERNO_LABEL } from '@/src/theme/audio-reactive/overlays';
import { registerCoreSpectrumVisuals } from '@/src/theme/audio-reactive/spectra';
import { registerCoreStackableEffects } from '@/src/theme/audio-reactive/stackables';
import type { DesignOverrides } from '@/src/theme/design-overrides';
import type { WaveformTheme } from '@/src/theme/types';
import {
  renderPhysicalSliderHtml,
  setPhysicalSliderValue,
  wirePhysicalSliders,
} from '@/src/ui/design-studio/physical-slider';

// CHANGED: the Style surface discovers every production visual through the same registries as capture.
// WHY: a hand-maintained picker list would drift from the allowlisted preference and renderer catalogs.
registerCoreSpectrumVisuals();
registerCoreOverlayVisuals();
registerCoreStackableEffects();

const CLASSIC_SPECTRUM_ID: SpectrumPresetId = 'classic-neon';
const spectrumCapabilityCache = new Map<SpectrumPresetId, {
  layouts: readonly LayoutMode[];
  supportsAfterimage: boolean;
}>();

const SPECTRUM_COPY: Record<SpectrumPresetId, { mode: string; description: string }> = {
  oscilloscope: { mode: 'Trace', description: 'A triggered voltage trace shaped by your voice.' },
  minimal: { mode: 'Signal', description: 'A restrained, contrast-first level meter.' },
  'classic-neon': { mode: 'Bars', description: 'The familiar luminous 32-band spectrum.' },
  phosphor: { mode: 'CRT', description: 'Segmented phosphor cells with analog persistence.' },
  'radial-spectrum': { mode: 'Orbit', description: 'A mirrored spectrum wrapped around a ring.' },
  'central-pulse': { mode: 'Pulse', description: 'An organic voice-driven contour and echo.' },
};

const OVERLAY_COPY: Record<OverlayPresetId, { mode: string; description: string }> = {
  sparkle: { mode: 'Air', description: 'Fine twinkles and voice-lit motes.' },
  bokeh: { mode: 'Depth', description: 'Soft parallax bubbles behind the signal.' },
  'forest-spirits': { mode: 'Flow', description: 'Three linked wisps that fracture on attacks.' },
  'digital-rain': { mode: 'Grid', description: 'Audio-propagated glyph streams.' },
  inferno: { mode: 'Heat', description: 'Flow-field flame, smoke, and sparks.' },
  aurora: { mode: 'Veil', description: 'Band-shaped ribbons with luminous folds.' },
  glitch: { mode: 'Fault', description: 'Scanlines, RGB ghosts, and bounded tears.' },
};

const STACKABLE_COPY: Record<StackableEffectId, string> = {
  ember: 'Cinders lift through the scene.',
  'electric-arc': 'Short corona streamers seek conductors.',
  lightning: 'One sustained channel reroutes on attacks.',
  conway: 'A voice-seeded living circuit lattice.',
  smoke: 'Layered plumes add depth and drift.',
  'neon-glow': 'Continuous light tubes reshape with bands.',
  'particle-burst': 'Onsets launch compact kinetic blooms.',
};

const PALETTES = {
  cividis: ['#00204d', '#565c6c', '#a69c75', '#ffea46'],
  ember: ['#3b0805', '#ed4b0b', '#ff9f0a', '#fff1b8'],
  prism: ['#38bdf8', '#6c63ff', '#d946ef', '#fef08a'],
} as const;

type NumericParam =
  | 'sensitivity'
  | 'intensity'
  | 'smoothing'
  | 'density'
  | 'bassWeight'
  | 'midWeight'
  | 'trebleWeight'
  | 'afterimageStrength';

export interface StyleControlsHandle {
  sync(overrides: DesignOverrides | null | undefined, theme: WaveformTheme): void;
  dispose(): void;
}

function colorsFromDefinition(kind: 'spectrum' | 'overlay', id: string): readonly string[] {
  const color = getAudioVisualDefinition(kind, id)?.defaultParams?.color;
  if (typeof color === 'string') return [color];
  if (Array.isArray(color) && color.length > 0) return color;
  return ['#8f93e6', '#ffd54f'];
}

function spectrumCapabilities(id: SpectrumPresetId): {
  layouts: readonly LayoutMode[];
  supportsAfterimage: boolean;
} {
  const cached = spectrumCapabilityCache.get(id);
  if (cached) return cached;
  const visual = getAudioVisualDefinition('spectrum', id)?.create();
  // CHANGED: runtime-only discovery is cached once per spectrum instead of allocating on every slider tick.
  // WHY: the Style panel should not create simulation garbage while it advertises capture performance.
  const capabilities = Object.freeze({
    layouts: visual?.supportedLayouts ?? Object.freeze(['linear'] as const),
    supportsAfterimage: visual?.supportsAfterimage === true,
  });
  spectrumCapabilityCache.set(id, capabilities);
  return capabilities;
}

function paletteStyle(colors: readonly string[]): string {
  const first = colors[0] ?? '#8f93e6';
  const middle = colors[Math.floor(colors.length / 2)] ?? first;
  const last = colors[colors.length - 1] ?? middle;
  return `--style-color-a:${first};--style-color-b:${middle};--style-color-c:${last}`;
}

function renderSpectrumChoices(): string {
  return SPECTRUM_PRESET_IDS.map((id) => {
    const definition = getAudioVisualDefinition('spectrum', id);
    const copy = SPECTRUM_COPY[id];
    return `
      <button type="button" class="studio__visual-choice" data-style-spectrum="${id}" aria-pressed="false">
        <span class="studio__visual-thumb" data-visual-id="${id}" style="${paletteStyle(colorsFromDefinition('spectrum', id))}" aria-hidden="true">
          <span class="studio__visual-thumb-plot"></span>
        </span>
        <span class="studio__visual-choice-copy">
          <strong>${definition?.label ?? id}</strong>
          <span>${copy.description}</span>
        </span>
        <span class="studio__visual-mode">${copy.mode}</span>
      </button>`;
  }).join('');
}

function renderOverlayChoices(): string {
  const none = `
    <button type="button" class="studio__visual-choice" data-style-overlay="none" aria-pressed="false">
      <span class="studio__visual-thumb studio__visual-thumb--none" aria-hidden="true"><span class="studio__visual-thumb-plot"></span></span>
      <span class="studio__visual-choice-copy"><strong>Clean stage</strong><span>No atmosphere layer.</span></span>
      <span class="studio__visual-mode">None</span>
    </button>`;
  return none + OVERLAY_PRESET_IDS.map((id) => {
    const definition = getAudioVisualDefinition('overlay', id);
    const copy = OVERLAY_COPY[id];
    return `
      <button type="button" class="studio__visual-choice" data-style-overlay="${id}" aria-pressed="false">
        <span class="studio__visual-thumb" data-visual-id="${id}" style="${paletteStyle(colorsFromDefinition('overlay', id))}" aria-hidden="true">
          <span class="studio__visual-thumb-plot"></span>
        </span>
        <span class="studio__visual-choice-copy"><strong>${definition?.label ?? id}</strong><span>${copy.description}</span></span>
        <span class="studio__visual-mode">${copy.mode}</span>
      </button>`;
  }).join('');
}

function renderStackableChoices(): string {
  return STACKABLE_EFFECT_IDS.map((id) => {
    const definition = getStackableEffectDefinition(id);
    const cost = definition?.maxElements ?? 0;
    const costBand = cost > 500 ? 'heavy' : cost > 220 ? 'medium' : 'light';
    return `
      <button type="button" class="studio__accent-choice" data-style-stackable="${id}" aria-pressed="false">
        <span class="studio__accent-led" aria-hidden="true"></span>
        <span class="studio__accent-choice-copy"><strong>${definition?.label ?? id}</strong><span>${STACKABLE_COPY[id]}</span></span>
        <span class="studio__accent-cost studio__accent-cost--${costBand}">${costBand}</span>
        <span class="studio__accent-paused" data-style-stackable-paused hidden>Paused</span>
      </button>`;
  }).join('');
}

function renderParamSlider(
  label: string,
  key: NumericParam,
  value: number,
  description: string,
  max = 100,
): string {
  return `
    <label class="studio__style-slider-row">
      <span class="studio__style-slider-copy"><strong>${label}</strong><span>${description}</span></span>
      <span class="studio__style-slider-control">
        ${renderPhysicalSliderHtml({
          min: 0,
          max,
          step: 1,
          value,
          ariaLabel: label,
          dataAttrs: { 'style-param': key },
        })}
        <output class="studio__style-readout" data-style-param-value="${key}">${value}</output>
      </span>
    </label>`;
}

function renderPaletteChoice(id: 'preset' | 'clip' | keyof typeof PALETTES, label: string): string {
  const colors = id === 'preset'
    ? ['#241a4a', '#8f93e6', '#ffd54f']
    : id === 'clip'
      ? ['#8f93e6']
      : PALETTES[id];
  return `
    <button type="button" class="studio__palette-choice" data-style-palette="${id}" aria-pressed="false">
      <span class="studio__palette-swatch" style="${paletteStyle(colors)}" aria-hidden="true"></span>
      <span>${label}</span>
    </button>`;
}

/** Render the registry-driven portion of the Style sub-panel. */
export function renderStyleControlCenterFields(): string {
  return `
    <div class="studio__style-control-center" data-style-control-center data-performance-level="comfortable">
      <section class="studio__signal-chain" aria-labelledby="style-signal-chain-title">
        <div class="studio__style-section-heading">
          <div><p class="studio__style-eyebrow">Visual signal chain</p><h3 id="style-signal-chain-title">Voice in. Scene out.</h3></div>
          <span class="studio__style-live-badge">Live hot-swap</span>
        </div>
        <div class="studio__signal-flow" aria-label="Render order">
          <span><small>Atmosphere</small><strong data-style-signal-overlay>Clean</strong></span>
          <i aria-hidden="true">›</i>
          <span><small>Accents</small><strong data-style-signal-stackables>None</strong></span>
          <i aria-hidden="true">›</i>
          <span><small>Spectrum</small><strong data-style-signal-spectrum>Classic</strong></span>
          <i aria-hidden="true">›</i>
          <span class="studio__signal-flow-output"><small>Captions</small><strong>Above</strong></span>
        </div>
        <p class="studio__style-note">The Studio demonstrates representative motion. Your recording reacts to the real voice signal.</p>
      </section>

      <section class="studio__style-bay" aria-labelledby="style-spectrum-title">
        <div class="studio__style-section-heading"><div><p class="studio__style-eyebrow">Lead voice</p><h3 id="style-spectrum-title">Spectrum</h3></div><span>Choose one</span></div>
        <div class="studio__visual-choice-row" role="group" aria-label="Spectrum preset">${renderSpectrumChoices()}</div>
      </section>

      <section class="studio__style-bay" aria-labelledby="style-overlay-title">
        <div class="studio__style-section-heading"><div><p class="studio__style-eyebrow">Underlay</p><h3 id="style-overlay-title">Atmosphere</h3></div><span>Choose one</span></div>
        <div class="studio__visual-choice-row" role="group" aria-label="Atmosphere preset">${renderOverlayChoices()}</div>
      </section>

      <section class="studio__style-bay" aria-labelledby="style-accents-title">
        <div class="studio__style-section-heading"><div><p class="studio__style-eyebrow">Ordered layer</p><h3 id="style-accents-title">Accents</h3></div><span data-style-stack-count>0 / ${MAX_STACKABLE_EFFECTS}</span></div>
        <div class="studio__accent-grid" role="group" aria-label="Stackable accents">${renderStackableChoices()}</div>
        <p class="studio__style-note" data-style-stack-limit>Choose up to three. They paint in the order selected.</p>
      </section>

      <section class="studio__style-bay studio__style-bay--tuning" aria-labelledby="style-tuning-title">
        <div class="studio__style-section-heading"><div><p class="studio__style-eyebrow">Shared response</p><h3 id="style-tuning-title">Tuning</h3></div><span>Across the scene</span></div>
        <div class="studio__style-slider-stack">
          ${renderParamSlider('Intensity', 'intensity', 50, 'Visual strength and scale.')}
          ${renderParamSlider('Sensitivity', 'sensitivity', 50, 'How quickly voice energy wakes the scene.')}
          ${renderParamSlider('Smoothing', 'smoothing', 50, 'Attack, decay, and motion continuity.')}
        </div>
        <div class="studio__palette-block">
          <span class="studio__palette-label">Color language</span>
          <div class="studio__palette-row" role="group" aria-label="Visual color language">
            ${renderPaletteChoice('preset', 'Preset')}
            ${renderPaletteChoice('clip', 'Clip color')}
            ${renderPaletteChoice('cividis', 'Cividis')}
            ${renderPaletteChoice('ember', 'Ember')}
            ${renderPaletteChoice('prism', 'Prism')}
          </div>
        </div>
      </section>

      <section class="studio__style-bay" aria-labelledby="style-bands-title">
        <div class="studio__style-section-heading"><div><p class="studio__style-eyebrow">Frequency mix</p><h3 id="style-bands-title">Band response</h3></div><span>0–2×</span></div>
        <div class="studio__band-grid">
          ${renderParamSlider('Bass', 'bassWeight', 100, 'Body and lift.', 200)}
          ${renderParamSlider('Mid', 'midWeight', 100, 'Speech motion.', 200)}
          ${renderParamSlider('Treble', 'trebleWeight', 100, 'Edges and attacks.', 200)}
        </div>
      </section>

      <section class="studio__style-bay" aria-labelledby="style-shape-title">
        <div class="studio__style-section-heading"><div><p class="studio__style-eyebrow">Scene behavior</p><h3 id="style-shape-title">Shape &amp; readability</h3></div><span>Contextual</span></div>
        <div class="studio__layout-control" data-style-layout-control>
          <span>Scene geometry</span>
          <div class="studio__layout-segments" role="group" aria-label="Scene geometry">
            <button type="button" data-style-layout="linear" aria-pressed="false">Linear</button>
            <button type="button" data-style-layout="centered" aria-pressed="false">Centered</button>
            <button type="button" data-style-layout="radial" aria-pressed="false">Radial</button>
          </div>
          <small data-style-layout-note></small>
        </div>
        <div class="studio__style-slider-stack" data-style-afterimage-row hidden>
          ${renderParamSlider('Afterimage', 'afterimageStrength', 0, 'Bounded history or echo strength.')}
        </div>
        <label class="popup__toggle-row studio__style-toggle">
          <span class="popup__toggle-copy"><span class="popup__toggle-label">High contrast</span><p class="popup__field-desc">Remove soft glow and harden important edges.</p></span>
          <input class="popup__toggle-input" type="checkbox" data-style-high-contrast aria-label="High contrast visuals" />
        </label>
        <label class="popup__toggle-row studio__style-toggle" data-style-inferno-only hidden>
          <span class="popup__toggle-copy"><span class="popup__toggle-label">${VOID_INFERNO_LABEL} variant</span><p class="popup__field-desc">Render Inferno as its dark Void treatment. Linked to High contrast.</p></span>
          <input class="popup__toggle-input" type="checkbox" data-style-void-variant aria-label="Void Inferno variant" />
        </label>
        <label class="popup__toggle-row studio__style-toggle" data-style-classic-only>
          <span class="popup__toggle-copy"><span class="popup__toggle-label">Boost Classic halo</span><p class="popup__field-desc">Preserve the legacy extra-neon treatment for Classic bars.</p></span>
          <input class="popup__toggle-input" type="checkbox" data-style-bar-glow aria-label="Boost Classic halo" />
        </label>
        <label class="popup__toggle-row studio__style-toggle">
          <span class="popup__toggle-copy"><span class="popup__toggle-label">Caption-safe dim</span><p class="popup__field-desc">Reserve a calm lower-center reading zone beneath captions.</p></span>
          <input class="popup__toggle-input" type="checkbox" data-style-subtitle-safe-dim aria-label="Caption-safe dim" />
        </label>
      </section>

      <section class="studio__style-governor" aria-labelledby="style-governor-title" aria-live="polite">
        <div class="studio__style-section-heading"><div><p class="studio__style-eyebrow">Capture budget</p><h3 id="style-governor-title">Performance governor</h3></div><output data-style-cost>0 passes</output></div>
        ${renderParamSlider('Detail', 'density', 50, 'Element count, simulation detail, and encoded motion.')}
        <div class="studio__governor-status" data-style-governor-status>
          <span class="studio__governor-indicator" aria-hidden="true"></span>
          <span><strong data-style-governor-title>Comfortable</strong><small data-style-governor-copy>Good headroom for smooth capture.</small></span>
        </div>
        <p class="studio__governor-guard" data-style-governor-guard hidden></p>
        <p class="studio__style-note">Cost estimates bounded Canvas 2D paint passes. Long-take size still requires the 120-second artifact gate.</p>
      </section>
    </div>`;
}

function valuesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function mountStyleControlCenter(
  root: HTMLElement,
  onDesignChange: (patch: Partial<DesignOverrides>) => void,
): StyleControlsHandle {
  const host = root.querySelector<HTMLElement>('[data-style-control-center]')!;
  let overrides: DesignOverrides | null = null;
  let theme: WaveformTheme | null = null;

  function selectedSpectrum(): SpectrumPresetId {
    return overrides?.spectrumPreset
      ?? theme?.designEffects?.spectrumPreset
      ?? CLASSIC_SPECTRUM_ID;
  }

  function selectedOverlay(): OverlayPresetId | null {
    if (overrides?.overlayPreset !== undefined) return overrides.overlayPreset;
    return theme?.designEffects?.overlayPreset
      ?? theme?.designEffects?.backgroundOverlay
      ?? null;
  }

  function selectedStackables(): readonly StackableEffectId[] {
    return overrides?.stackables ?? theme?.designEffects?.stackables ?? [];
  }

  function rawParams(): Partial<VisualizerParams> {
    return overrides?.visualizerParams ?? theme?.designEffects?.visualizerParams ?? {};
  }

  function effectiveParams(): VisualizerParams {
    const definition = getAudioVisualDefinition('spectrum', selectedSpectrum());
    return resolveVisualizerParams(definition?.defaultParams, rawParams());
  }

  function commit(patch: Partial<DesignOverrides>): void {
    const fallbackColor = overrides?.barColor ?? theme?.colors.bar ?? '#8f93e6';
    overrides = {
      ...(overrides ?? { barColor: fallbackColor }),
      ...patch,
      barColor: patch.barColor ?? fallbackColor,
    };
    onDesignChange(patch);
    syncDom();
  }

  function commitParam(key: NumericParam, value: number): void {
    commit({ visualizerParams: { ...rawParams(), [key]: value / 100 } });
  }

  function setButtonState(selector: string, selectedValue: string | null): void {
    for (const button of host.querySelectorAll<HTMLButtonElement>(selector)) {
      const value = button.dataset.styleSpectrum
        ?? button.dataset.styleOverlay
        ?? button.dataset.styleLayout
        ?? '';
      const pressed = value === selectedValue;
      button.setAttribute('aria-pressed', String(pressed));
      button.classList.toggle('is-selected', pressed);
    }
  }

  function syncSliders(params: VisualizerParams): void {
    for (const slider of host.querySelectorAll<HTMLElement>('[data-style-param]')) {
      const key = slider.dataset.styleParam as NumericParam | undefined;
      if (!key) continue;
      const raw = params[key];
      const value = typeof raw === 'number'
        ? Math.round(raw * 100)
        : Math.round((DEFAULT_VISUALIZER_PARAMS[key] as number | undefined ?? 0) * 100);
      setPhysicalSliderValue(slider, value);
      const output = host.querySelector<HTMLOutputElement>(`[data-style-param-value="${key}"]`);
      if (output) output.value = key.endsWith('Weight') ? `${(value / 100).toFixed(2)}×` : `${value}`;
    }
  }

  function syncLayout(params: VisualizerParams): void {
    const spectrum = selectedSpectrum();
    const nativeLayouts = spectrumCapabilities(spectrum).layouts;
    const effectsUseSceneGeometry = Boolean(selectedOverlay() || selectedStackables().length);
    const available = effectsUseSceneGeometry
      ? new Set<LayoutMode>(['linear', 'centered', 'radial'])
      : new Set<LayoutMode>(nativeLayouts);
    const selected = params.layoutMode ?? nativeLayouts[0] ?? 'linear';

    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-style-layout]')) {
      const layout = button.dataset.styleLayout as LayoutMode;
      const allowed = available.has(layout);
      button.disabled = !allowed;
      button.setAttribute('aria-pressed', String(layout === selected));
      button.classList.toggle('is-selected', layout === selected);
    }
    const note = host.querySelector<HTMLElement>('[data-style-layout-note]');
    if (note) {
      note.textContent = effectsUseSceneGeometry
        ? 'Atmosphere and accents follow this geometry; the lead keeps its native shape when needed.'
        : `${getAudioVisualDefinition('spectrum', spectrum)?.label ?? 'This spectrum'} supports ${nativeLayouts.join(' / ')}.`;
    }
  }

  function syncPalette(params: VisualizerParams): void {
    const savedColor = rawParams().color;
    let selected = 'preset';
    if (typeof savedColor === 'string') selected = 'clip';
    else if (Array.isArray(savedColor)) {
      for (const [id, colors] of Object.entries(PALETTES)) {
        if (valuesEqual(savedColor, colors)) selected = id;
      }
    }
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-style-palette]')) {
      const pressed = button.dataset.stylePalette === selected;
      button.setAttribute('aria-pressed', String(pressed));
      button.classList.toggle('is-selected', pressed);
      if (button.dataset.stylePalette === 'clip') {
        const swatch = button.querySelector<HTMLElement>('.studio__palette-swatch');
        const color = overrides?.barColor ?? theme?.colors.bar ?? '#8f93e6';
        if (swatch) swatch.style.cssText = paletteStyle([color]);
      }
    }
    void params;
  }

  function syncPerformance(params: VisualizerParams): void {
    const snapshot = evaluateVisualPerformance({
      spectrumPreset: selectedSpectrum(),
      overlayPreset: selectedOverlay(),
      stackables: selectedStackables(),
      density: params.density,
    });
    host.dataset.performanceLevel = snapshot.level;
    const cost = host.querySelector<HTMLOutputElement>('[data-style-cost]');
    if (cost) cost.value = `${snapshot.estimatedCost} passes`;
    const title = host.querySelector<HTMLElement>('[data-style-governor-title]');
    const copy = host.querySelector<HTMLElement>('[data-style-governor-copy]');
    const guard = host.querySelector<HTMLElement>('[data-style-governor-guard]');
    const wording = snapshot.level === 'comfortable'
      ? ['Comfortable', 'Good headroom for smooth capture.']
      : snapshot.level === 'elevated'
        ? ['Elevated', 'Long clips may grow and slower devices may drop frames.']
        : snapshot.suspendedStackableId
          ? ['Guarded', 'The costliest accent is paused in preview and capture.']
          : ['Guarded', 'Lower Detail to recover smooth-capture headroom.'];
    if (title) title.textContent = wording[0];
    if (copy) copy.textContent = wording[1];
    if (guard) {
      guard.hidden = !snapshot.suspendedStackableId;
      guard.textContent = snapshot.suspendedStackableLabel
        ? `${snapshot.suspendedStackableLabel} is paused at this Detail level. Lower Detail or remove another accent to restore it.`
        : '';
    }

    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-style-stackable]')) {
      const id = button.dataset.styleStackable as StackableEffectId;
      const paused = id === snapshot.suspendedStackableId;
      button.classList.toggle('is-suspended', paused);
      const pausedLabel = button.querySelector<HTMLElement>('[data-style-stackable-paused]');
      if (pausedLabel) pausedLabel.hidden = !paused;
    }
  }

  function syncDom(): void {
    if (!theme) return;
    const spectrum = selectedSpectrum();
    const overlay = selectedOverlay();
    const stackables = [...selectedStackables()];
    const params = effectiveParams();

    setButtonState('[data-style-spectrum]', spectrum);
    setButtonState('[data-style-overlay]', overlay ?? 'none');
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-style-stackable]')) {
      const id = button.dataset.styleStackable as StackableEffectId;
      const pressed = stackables.includes(id);
      button.setAttribute('aria-pressed', String(pressed));
      button.classList.toggle('is-selected', pressed);
      button.disabled = !pressed && stackables.length >= MAX_STACKABLE_EFFECTS;
    }

    const count = host.querySelector<HTMLElement>('[data-style-stack-count]');
    if (count) count.textContent = `${stackables.length} / ${MAX_STACKABLE_EFFECTS}`;
    const limit = host.querySelector<HTMLElement>('[data-style-stack-limit]');
    if (limit) limit.textContent = stackables.length >= MAX_STACKABLE_EFFECTS
      ? 'Three accents selected. Remove one to audition another.'
      : 'Choose up to three. They paint in the order selected.';

    const spectrumSignal = host.querySelector<HTMLElement>('[data-style-signal-spectrum]');
    const overlaySignal = host.querySelector<HTMLElement>('[data-style-signal-overlay]');
    const stackSignal = host.querySelector<HTMLElement>('[data-style-signal-stackables]');
    if (spectrumSignal) spectrumSignal.textContent = getAudioVisualDefinition('spectrum', spectrum)?.label ?? spectrum;
    if (overlaySignal) overlaySignal.textContent = overlay
      ? getAudioVisualDefinition('overlay', overlay)?.label ?? overlay
      : 'Clean';
    if (stackSignal) stackSignal.textContent = stackables.length > 0 ? `${stackables.length} active` : 'None';

    syncSliders(params);
    syncLayout(params);
    syncPalette(params);
    const afterimageRow = host.querySelector<HTMLElement>('[data-style-afterimage-row]');
    if (afterimageRow) afterimageRow.hidden = !spectrumCapabilities(spectrum).supportsAfterimage;
    const classicOnly = host.querySelector<HTMLElement>('[data-style-classic-only]');
    if (classicOnly) classicOnly.hidden = spectrum !== CLASSIC_SPECTRUM_ID;
    const highContrast = host.querySelector<HTMLInputElement>('[data-style-high-contrast]');
    const barGlow = host.querySelector<HTMLInputElement>('[data-style-bar-glow]');
    const safeDim = host.querySelector<HTMLInputElement>('[data-style-subtitle-safe-dim]');
    if (highContrast) highContrast.checked = params.highContrast === true;
    // CHANGED: Inferno's Void treatment is surfaced as a named, semantically-linked toggle.
    // WHY: QA found the High Contrast pathway to the Void variant undiscoverable (§3e).
    const infernoOnly = host.querySelector<HTMLElement>('[data-style-inferno-only]');
    if (infernoOnly) infernoOnly.hidden = overlay !== 'inferno';
    const voidVariant = host.querySelector<HTMLInputElement>('[data-style-void-variant]');
    if (voidVariant) voidVariant.checked = params.highContrast === true;
    if (barGlow) barGlow.checked = overrides?.barGlow === 'boosted';
    if (safeDim) safeDim.checked = params.subtitleSafeDim === true;
    syncPerformance(params);
  }

  function onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const spectrumButton = target.closest<HTMLButtonElement>('[data-style-spectrum]');
    if (spectrumButton) {
      commit({ spectrumPreset: spectrumButton.dataset.styleSpectrum as SpectrumPresetId });
      return;
    }
    const overlayButton = target.closest<HTMLButtonElement>('[data-style-overlay]');
    if (overlayButton) {
      const value = overlayButton.dataset.styleOverlay;
      const overlayPreset = value === 'none' ? null : value as OverlayPresetId;
      commit({
        overlayPreset,
        backgroundEffect: overlayPreset === 'bokeh' || overlayPreset === 'sparkle'
          ? overlayPreset
          : 'none',
      });
      return;
    }
    const stackableButton = target.closest<HTMLButtonElement>('[data-style-stackable]');
    if (stackableButton && !stackableButton.disabled) {
      const id = stackableButton.dataset.styleStackable as StackableEffectId;
      const current = [...selectedStackables()];
      const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
      commit({ stackables: next });
      return;
    }
    const layoutButton = target.closest<HTMLButtonElement>('[data-style-layout]');
    if (layoutButton && !layoutButton.disabled) {
      commit({ visualizerParams: { ...rawParams(), layoutMode: layoutButton.dataset.styleLayout as LayoutMode } });
      return;
    }
    const paletteButton = target.closest<HTMLButtonElement>('[data-style-palette]');
    if (paletteButton) {
      const id = paletteButton.dataset.stylePalette as 'preset' | 'clip' | keyof typeof PALETTES;
      const next = { ...rawParams() };
      if (id === 'preset') delete next.color;
      else if (id === 'clip') next.color = overrides?.barColor ?? theme?.colors.bar ?? '#8f93e6';
      else next.color = [...PALETTES[id]];
      commit({ visualizerParams: next });
    }
  }

  function onChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.matches('[data-style-high-contrast]') || target.matches('[data-style-void-variant]')) {
      commit({ visualizerParams: { ...rawParams(), highContrast: target.checked } });
    } else if (target.matches('[data-style-subtitle-safe-dim]')) {
      commit({ visualizerParams: { ...rawParams(), subtitleSafeDim: target.checked } });
    } else if (target.matches('[data-style-bar-glow]')) {
      commit({ barGlow: target.checked ? 'boosted' : 'default' });
    }
  }

  host.addEventListener('click', onClick);
  host.addEventListener('change', onChange);
  const disposeSliders = wirePhysicalSliders(host, {
    onValueChange: (slider, value) => {
      const key = slider.dataset.styleParam as NumericParam | undefined;
      if (!key) return;
      commitParam(key, value);
    },
  });

  return {
    sync(nextOverrides, nextTheme): void {
      overrides = nextOverrides ? structuredClone(nextOverrides) : null;
      theme = nextTheme;
      syncDom();
    },
    dispose(): void {
      disposeSliders();
      host.removeEventListener('click', onClick);
      host.removeEventListener('change', onChange);
    },
  };
}
