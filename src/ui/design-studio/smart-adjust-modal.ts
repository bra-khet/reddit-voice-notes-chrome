/**
 * Smart Adjust modal — Mode A minimal fixes + Mode B re-splice (Phase 1).
 */

import type { SmartAdjustProposal } from '@/src/transcription/smart-adjust';

export interface SmartAdjustModalHandle {
  open(options: {
    manualEditCount: number;
    proposals: SmartAdjustProposal[];
    onApply: (proposal: SmartAdjustProposal) => void;
  }): void;
  close(): void;
  dispose(): void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderSmartAdjustModalMarkup(): string {
  return `
    <div class="studio__transcript-modal studio__smart-adjust-modal" data-smart-adjust-modal hidden>
      <div class="studio__transcript-dialog studio__smart-adjust-dialog" role="dialog" aria-labelledby="smart-adjust-title">
        <header class="studio__transcript-dialog-header">
          <h3 class="studio__transcript-dialog-title" id="smart-adjust-title">Smart Adjust</h3>
          <button type="button" class="studio__transcript-close" data-smart-adjust-close aria-label="Close Smart Adjust">×</button>
        </header>
        <p class="studio__transcript-dialog-copy popup__field-desc">
          Proposals are previews only — nothing changes until you accept one. Re-splice uses the original Vosk transcript as source of truth.
        </p>
        <p class="studio__smart-adjust-manual-note popup__field-desc" data-smart-adjust-manual-note hidden></p>
        <div class="studio__smart-adjust-proposals" data-smart-adjust-proposals></div>
        <p class="studio__smart-adjust-empty popup__field-desc" data-smart-adjust-empty hidden>
          No automatic fixes found for the current overflow cues. Try ✂ Split on individual cues, or lower font size in Subtitle style.
        </p>
        <div class="studio__transcript-dialog-actions studio-v4__guard-actions">
          <button type="button" class="popup__button popup__button--secondary studio-v4__guard-cancel" data-smart-adjust-cancel>
            Close
          </button>
        </div>
      </div>
    </div>
  `;
}

export function mountSmartAdjustModal(root: HTMLElement): SmartAdjustModalHandle {
  const host = root.querySelector<HTMLElement>('[data-transcript-editor]') ?? root;
  if (!host.querySelector('[data-smart-adjust-modal]')) {
    host.insertAdjacentHTML('beforeend', renderSmartAdjustModalMarkup());
  }

  const modalEl = host.querySelector<HTMLElement>('[data-smart-adjust-modal]')!;
  const listEl = host.querySelector<HTMLElement>('[data-smart-adjust-proposals]')!;
  const emptyEl = host.querySelector<HTMLElement>('[data-smart-adjust-empty]')!;
  const manualNoteEl = host.querySelector<HTMLElement>('[data-smart-adjust-manual-note]')!;
  const closeBtn = host.querySelector<HTMLButtonElement>('[data-smart-adjust-close]')!;
  const cancelBtn = host.querySelector<HTMLButtonElement>('[data-smart-adjust-cancel]')!;

  function close(): void {
    modalEl.hidden = true;
    listEl.innerHTML = '';
  }

  function renderProposals(
    proposals: SmartAdjustProposal[],
    onApply: (proposal: SmartAdjustProposal) => void,
  ): void {
    listEl.innerHTML = proposals
      .map(
        (proposal) => `
          <article class="studio__smart-adjust-card${proposal.recommended ? ' studio__smart-adjust-card--recommended' : ''}">
            <div class="studio__smart-adjust-card-head">
              <strong>${escapeHtml(proposal.title)}</strong>
              ${proposal.recommended ? '<span class="studio__smart-adjust-recommended-tag">Recommended</span>' : ''}
              ${proposal.isGlobal ? '<span class="studio__smart-adjust-global-tag">Global</span>' : ''}
            </div>
            <p class="popup__field-desc">${escapeHtml(proposal.description)}</p>
            <button type="button" class="popup__profile-btn popup__profile-btn--save studio__smart-adjust-apply${proposal.recommended ? ' popup__profile-btn--amber' : ''}">
              ${proposal.recommended ? 'Auto-fix' : 'Accept proposal'}
            </button>
          </article>
        `,
      )
      .join('');

    emptyEl.hidden = proposals.length > 0;

    const cards = listEl.querySelectorAll<HTMLElement>('.studio__smart-adjust-card');
    cards.forEach((card, index) => {
      const proposal = proposals[index];
      const btn = card.querySelector<HTMLButtonElement>('.studio__smart-adjust-apply');
      btn?.addEventListener('click', () => {
        onApply(proposal);
        close();
      });
    });
  }

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  modalEl.addEventListener('click', (event) => {
    if (event.target === modalEl) close();
  });

  return {
    open(options) {
      if (options.manualEditCount > 0) {
        manualNoteEl.hidden = false;
        manualNoteEl.textContent = `${options.manualEditCount} cue(s) have hand-edited text. Re-splice can preserve them or reset everything.`;
      } else {
        manualNoteEl.hidden = true;
      }
      renderProposals(options.proposals, options.onApply);
      modalEl.hidden = false;
    },
    close,
    dispose() {
      close();
    },
  };
}