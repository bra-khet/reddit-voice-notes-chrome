import '../../../entrypoints/popup/style.css';
import '../../../entrypoints/design-studio/studio-palette.css';
import '../../../entrypoints/design-studio/studio-v4-chrome.css';
import '../../../entrypoints/design-studio/studio-v4-layout.css';
import '../../../entrypoints/design-studio/studio-v4-buttons.css';
import '../../../entrypoints/design-studio/style.css';
import '../../../entrypoints/design-studio/studio-v4-controls.css';
import '../../../entrypoints/design-studio/style-control-center.css';
import './harness.css';
import type { DesignOverrides } from '@/src/theme/design-overrides';
import type { WaveformTheme } from '@/src/theme/types';
import {
  mountStyleControlCenter,
  renderStyleControlCenterFields,
  type StyleControlsHandle,
} from '@/src/ui/design-studio/style-controls';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main class="style-qa studio-v4">
    <header class="style-qa__masthead">
      <div><p>Design Studio · Phase 4 fixture</p><h1>Style Control Center</h1></div>
      <aside>Production registry, controls, responsive CSS, and governor policy. Changes remain inside this disposable QA page.</aside>
    </header>
    <section class="style-qa__panel">
      <div class="studio__panel-body">
        <div class="style-qa__foundation">
          <label class="popup__field studio__field--compact">
            <span class="popup__field-label">Style collection</span>
            <select class="popup__select" aria-label="Style collection"><option>Midnight Cividis</option></select>
          </label>
          <label class="popup__field studio__field--compact">
            <span class="popup__field-label">Spectrum anchor</span>
            <select class="popup__select" aria-label="Spectrum anchor"><option>Center</option></select>
          </label>
        </div>
        ${renderStyleControlCenterFields()}
      </div>
    </section>
  </main>`;

const theme: WaveformTheme = {
  id: 'style-control-center-qa',
  name: 'Midnight Cividis',
  bars: { width: 12, spacing: 5, cornerRadius: 4, glow: 18 },
  colors: { bar: '#8f93e6', glow: '#b7baff', bg: '#070b18' },
  background: { type: 'solid', value: '#070b18' },
};

let overrides: DesignOverrides = {
  barColor: '#8f93e6',
  barGlow: 'boosted',
  spectrumPreset: 'phosphor',
  overlayPreset: 'aurora',
  stackables: ['ember', 'conway', 'particle-burst'],
  visualizerParams: {
    sensitivity: 0.64,
    intensity: 0.78,
    smoothing: 0.42,
    density: 0.78,
    bassWeight: 1.2,
    midWeight: 1.05,
    trebleWeight: 1.35,
    afterimageStrength: 0.35,
    color: ['#00204d', '#565c6c', '#a69c75', '#ffea46'],
    layoutMode: 'radial',
    highContrast: false,
    subtitleSafeDim: true,
  },
};

let controls!: StyleControlsHandle;
controls = mountStyleControlCenter(app, (patch) => {
  // CHANGED: fixture interactions keep a complete in-memory style and re-sync production controls.
  // WHY: visual QA needs real max-three, contextual, and governor transitions without persistence writes.
  overrides = {
    ...overrides,
    ...patch,
    barColor: patch.barColor ?? overrides.barColor,
    visualizerParams: patch.visualizerParams ?? overrides.visualizerParams,
  };
  queueMicrotask(() => controls.sync(overrides, theme));
});
controls.sync(overrides, theme);
