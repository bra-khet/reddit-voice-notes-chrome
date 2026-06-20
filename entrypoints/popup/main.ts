import './style.css';
import { loadSettings, resetSettings, saveShortcut } from '@/src/settings/storage';
import { formatShortcut, shortcutFromKeyboardEvent } from '@/src/settings/shortcut';
import { DEFAULT_SHORTCUT } from '@/src/settings/types';

const manifest = browser.runtime.getManifest();

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="popup">
    <header class="popup__header">
      <h1 class="popup__title">Reddit Voice Notes</h1>
      <p class="popup__version">v${manifest.version}</p>
    </header>
    <p class="popup__hint">
      Open a Reddit comment box with video comments enabled, then use the microphone
      button or your keyboard shortcut.
    </p>
    <section class="popup__section">
      <h2 class="popup__section-title">Keyboard shortcut</h2>
      <button id="shortcut-capture" type="button" class="popup__shortcut" aria-label="Change keyboard shortcut">
        <span id="shortcut-label">Ctrl+Shift+X</span>
      </button>
      <p id="shortcut-hint" class="popup__micro">Click above, then press your preferred key combo.</p>
      <button id="shortcut-reset" type="button" class="popup__link">Reset to Ctrl+Shift+X</button>
    </section>
    <button id="reload-extension" type="button" class="popup__button">
      Reload extension
    </button>
  </main>
`;

const shortcutBtn = document.querySelector<HTMLButtonElement>('#shortcut-capture')!;
const shortcutLabel = document.querySelector<HTMLSpanElement>('#shortcut-label')!;
const shortcutHint = document.querySelector<HTMLParagraphElement>('#shortcut-hint')!;
const shortcutReset = document.querySelector<HTMLButtonElement>('#shortcut-reset')!;

let capturing = false;

async function refreshShortcutLabel(): Promise<void> {
  const settings = await loadSettings();
  shortcutLabel.textContent = formatShortcut(settings.shortcut);
}

function setCapturing(active: boolean): void {
  capturing = active;
  shortcutBtn.classList.toggle('popup__shortcut--capture', active);
  shortcutHint.textContent = active
    ? 'Press a key combination now… (Esc to cancel)'
    : 'Click above, then press your preferred key combo.';
}

shortcutBtn.addEventListener('click', () => {
  setCapturing(true);
  shortcutBtn.focus();
});

shortcutBtn.addEventListener('keydown', async (event) => {
  if (!capturing) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    setCapturing(false);
    return;
  }

  const binding = shortcutFromKeyboardEvent(event);
  if (!binding) return;

  event.preventDefault();
  event.stopPropagation();
  await saveShortcut(binding);
  shortcutLabel.textContent = formatShortcut(binding);
  setCapturing(false);
});

shortcutReset.addEventListener('click', async () => {
  await resetSettings();
  shortcutLabel.textContent = formatShortcut(DEFAULT_SHORTCUT);
  setCapturing(false);
});

document.querySelector<HTMLButtonElement>('#reload-extension')!.addEventListener('click', () => {
  browser.runtime.reload();
});

void refreshShortcutLabel();