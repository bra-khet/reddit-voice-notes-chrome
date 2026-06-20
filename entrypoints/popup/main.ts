import './style.css';
import { mountClipAppearanceSection } from '@/src/ui/popup/clip-appearance';

const manifest = browser.runtime.getManifest();

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="popup">
    <header class="popup__header">
      <h1 class="popup__title">Reddit Voice Notes</h1>
      <p class="popup__version">v${manifest.version} · Pretty</p>
    </header>
    <p class="popup__hint">
      Open a Reddit comment box with video comments enabled, then click the microphone
      button next to the video icon.
    </p>
    <div data-clip-appearance></div>
    <p class="popup__micro popup__micro--note">
      Keyboard shortcut is disabled for now (Reddit input / shadow DOM conflicts).
    </p>
    <button id="reload-extension" type="button" class="popup__button popup__button--secondary">
      Reload extension
    </button>
  </main>
`;

const clipRoot = document.querySelector<HTMLElement>('[data-clip-appearance]')!;
const unmountClipAppearance = mountClipAppearanceSection(clipRoot);

document.querySelector<HTMLButtonElement>('#reload-extension')!.addEventListener('click', () => {
  browser.runtime.reload();
});

window.addEventListener('unload', () => {
  unmountClipAppearance();
});