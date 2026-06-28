/* Copy / Paste voice transfer — the headline interop with the extension.
 *
 * Uses the verbatim-ported clipboard-backup.ts, so the JSON envelope is exactly
 * the extension's `rvn-voice-character-v1` and round-trips losslessly: copy here →
 * paste in the extension's Voice panel (or vice-versa) yields identical behaviour.
 */
import {
  copyVoiceCharacterToClipboard,
  pasteVoiceCharacterFromClipboard,
} from '@/src/settings/clipboard-backup';
import { showToast } from './toast';
import type { VoicePanelHandle } from './voice-panel';

export function mountTransfer(slot: HTMLElement, panel: VoicePanelHandle): void {
  slot.classList.add('transfer');
  slot.innerHTML = `
    <span class="transfer__label">Transfer voice</span>
    <div class="transfer__btns">
      <button type="button" class="transfer__btn" data-copy>Copy voice JSON</button>
      <button type="button" class="transfer__btn" data-paste>Paste voice JSON</button>
    </div>
    <p class="transfer__hint">Round-trips with the extension's Voice panel
      (<code>rvn-voice-character-v1</code>).</p>
  `;

  slot.querySelector<HTMLButtonElement>('[data-copy]')!.addEventListener('click', () => {
    void copyVoiceCharacterToClipboard(panel.getConfig()).then((result) => {
      showToast(result.message ?? '', result.success ? 'info' : 'error');
    });
  });

  slot.querySelector<HTMLButtonElement>('[data-paste]')!.addEventListener('click', () => {
    void pasteVoiceCharacterFromClipboard().then((result) => {
      if (!result.success || !result.config) {
        showToast(result.message ?? 'Nothing usable on the clipboard', 'info');
        return;
      }
      panel.setConfig(result.config);
      showToast(result.message ?? '', 'info');
    });
  });
}
