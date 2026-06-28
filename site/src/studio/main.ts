/* Voice Studio entry. Mounts the themed nav banner + the voice authoring panel,
 * the copy/paste transfer block (Phase 4), and session restore. Audition
 * (Phase 3) mounts into the panel's audition slot. */
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/nav-banner.css';
import '../styles/voice-panel.css';
import '../styles/transfer.css';
import '../styles/audition.css';
import { mountNavBanner } from './nav-banner';
import { mountVoicePanel } from './voice-panel';
import { mountTransfer } from './transfer';
import { mountAudition } from './audition';
import { loadLastVoice, saveLastVoice } from './session-store';

const navHost = document.querySelector<HTMLElement>('[data-nav-banner]');
if (navHost) mountNavBanner(navHost);

const panelHost = document.querySelector<HTMLElement>('[data-voice-panel]');
if (panelHost) {
  const panel = mountVoicePanel(panelHost);

  // Restore the last in-memory session (demo convenience; never touches extension storage).
  const restored = loadLastVoice();
  if (restored) panel.setConfig(restored);

  // Copy / Paste voice transfer (rvn-voice-character-v1).
  mountTransfer(panel.transferSlot, panel);

  // Audition: render the active voice via ffmpeg.wasm (mic test + upload).
  mountAudition(panel.auditionSlot, panel);

  // Persist the live voice locally (debounced) so a refresh keeps your work.
  let saveTimer = 0;
  panel.subscribe((config) => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveLastVoice(config), 300);
  });
}
