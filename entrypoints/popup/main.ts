import './style.css';

const manifest = browser.runtime.getManifest();

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="popup">
    <header class="popup__header">
      <h1 class="popup__title">Reddit Voice Notes</h1>
      <p class="popup__version">v${manifest.version}</p>
    </header>
    <p class="popup__hint">
      Open a Reddit comment box with video comments enabled, then use the microphone
      button injected next to the video icon.
    </p>
    <button id="reload-extension" type="button" class="popup__button">
      Reload extension
    </button>
  </main>
`;

document.querySelector<HTMLButtonElement>('#reload-extension')!.addEventListener('click', () => {
  browser.runtime.reload();
});