import {
  getThemeById,
  listThemePresets,
  renderThemePreview,
  type BarAlignment,
} from '@/src/theme';
import {
  loadUserPreferences,
  onUserPreferencesChanged,
  saveAppearancePreferences,
} from '@/src/settings/user-preferences';

const ALIGNMENT_OPTIONS: { value: BarAlignment; label: string }[] = [
  { value: 'center', label: 'Center (mirrored)' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'top', label: 'Top' },
];

export function mountClipAppearanceSection(root: HTMLElement): () => void {
  root.innerHTML = `
    <section class="popup__section" aria-labelledby="clip-appearance-title">
      <h2 class="popup__section-title" id="clip-appearance-title">Clip appearance</h2>
      <div class="popup__preview-wrap">
        <canvas
          class="popup__preview-canvas"
          data-preview-canvas
          width="640"
          height="360"
          aria-label="Clip style preview"
          role="img"
        ></canvas>
      </div>
      <label class="popup__field">
        <span class="popup__field-label">Clip style</span>
        <select class="popup__select" data-theme-select aria-label="Clip style"></select>
      </label>
      <label class="popup__field">
        <span class="popup__field-label">Bar alignment</span>
        <select class="popup__select" data-alignment-select aria-label="Bar alignment"></select>
      </label>
      <p class="popup__micro">Preview matches your recorded clip — background and bars draw live to the canvas.</p>
    </section>
  `;

  const previewCanvas = root.querySelector<HTMLCanvasElement>('[data-preview-canvas]')!;
  const themeSelect = root.querySelector<HTMLSelectElement>('[data-theme-select]')!;
  const alignmentSelect = root.querySelector<HTMLSelectElement>('[data-alignment-select]')!;

  for (const preset of listThemePresets()) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    themeSelect.append(option);
  }

  for (const option of ALIGNMENT_OPTIONS) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    alignmentSelect.append(el);
  }

  let activeThemeId = '';
  let activeAlignment: BarAlignment = 'center';
  let renderGeneration = 0;

  async function refreshPreview(): Promise<void> {
    const generation = ++renderGeneration;
    const theme = getThemeById(activeThemeId);
    await renderThemePreview(previewCanvas, theme, activeAlignment);
    if (generation !== renderGeneration) return;
  }

  function applyPrefs(themeId: string, alignment: BarAlignment): void {
    activeThemeId = themeId;
    activeAlignment = alignment;
    themeSelect.value = themeId;
    alignmentSelect.value = alignment;
    void refreshPreview();
  }

  themeSelect.addEventListener('change', () => {
    void saveAppearancePreferences({ activeThemeId: themeSelect.value }).then((prefs) => {
      applyPrefs(prefs.appearance.activeThemeId, prefs.appearance.barAlignment ?? 'center');
    });
  });

  alignmentSelect.addEventListener('change', () => {
    const alignment = alignmentSelect.value as BarAlignment;
    void saveAppearancePreferences({ barAlignment: alignment }).then((prefs) => {
      applyPrefs(prefs.appearance.activeThemeId, prefs.appearance.barAlignment ?? 'center');
    });
  });

  void loadUserPreferences().then((prefs) => {
    applyPrefs(prefs.appearance.activeThemeId, prefs.appearance.barAlignment ?? 'center');
  });

  const unsubscribe = onUserPreferencesChanged((prefs) => {
    applyPrefs(prefs.appearance.activeThemeId, prefs.appearance.barAlignment ?? 'center');
  });

  return unsubscribe;
}