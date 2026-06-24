import type { TranscriptDeliveryStatus } from '@/src/ui/design-studio/subtitle-segment-editor';
import {
  activateRedditTab,
  onWorkflowPhaseChanged,
  setWorkflowPhase,
  type WorkflowPhase,
} from '@/src/workflow/workflow-state';

export interface WorkflowBannerStatus {
  hasSessionRecording: boolean;
  hasTranscriptCues: boolean;
  bakedForSession: boolean;
  transcriptDelivery: TranscriptDeliveryStatus;
}

export interface WorkflowBannerHandle {
  update(status: WorkflowBannerStatus): void;
  dispose(): void;
}

const PHASE_LABELS: Record<WorkflowPhase, string> = {
  design: 'Design',
  capture: 'Capture',
  polish: 'Polish & Bake',
};

const PHASE_ORDER: Record<WorkflowPhase, number> = { design: 0, capture: 1, polish: 2 };

// Promote stored phase to 'polish' if a recording already exists.
function effectivePhase(stored: WorkflowPhase, status: WorkflowBannerStatus): WorkflowPhase {
  if (status.hasSessionRecording) return 'polish';
  return stored;
}

function ctaText(phase: WorkflowPhase, status: WorkflowBannerStatus): string {
  const eff = effectivePhase(phase, status);
  if (eff === 'polish') {
    if (status.bakedForSession) {
      return 'Captioned MP4 ready — return to Reddit to attach your comment.';
    }
    if (status.transcriptDelivery === 'pending') {
      return 'Recording ready — subtitles are loading. Edit & bake once they arrive.';
    }
    if (status.transcriptDelivery === 'timeout') {
      return 'Recording ready — subtitles timed out. Poor audio? Add captions manually in the Subtitles panel, or record again.';
    }
    if (status.hasTranscriptCues) {
      return 'Recording ready — review subtitles in the Subtitles panel, then Bake.';
    }
    return 'Recording ready — open the Subtitles panel to add captions, then Bake.';
  }
  if (eff === 'capture') {
    return 'Design saved — switch to your Reddit tab and hit Record.';
  }
  return 'Design your clip style, then switch to Reddit to record your voice comment.';
}

function ctaButtonLabel(phase: WorkflowPhase, status: WorkflowBannerStatus): string | null {
  const eff = effectivePhase(phase, status);
  if (eff === 'polish' && status.bakedForSession) return 'Switch to Reddit to attach';
  if (eff === 'polish') return null; // Primary CTA is the Bake button in Subtitles panel
  return 'Switch to Reddit';
}

function stepperHtml(eff: WorkflowPhase): string {
  const phases: WorkflowPhase[] = ['design', 'capture', 'polish'];
  const activeOrder = PHASE_ORDER[eff];

  const steps = phases.map((phase, i) => {
    const ord = PHASE_ORDER[phase];
    const isDone = ord < activeOrder;
    const isActive = phase === eff;
    const modifiers = isDone ? 'wf-step--done' : isActive ? 'wf-step--active' : 'wf-step--future';
    const dot = isDone
      ? `<span class="wf-step__check" aria-hidden="true">✓</span>`
      : `<span class="wf-step__num" aria-hidden="true">${i + 1}</span>`;
    const connector =
      phase !== 'polish'
        ? `<div class="wf-step__connector${isDone ? ' wf-step__connector--done' : ''}" aria-hidden="true"></div>`
        : '';
    const ariaLabel = isDone
      ? `${PHASE_LABELS[phase]} — complete`
      : isActive
        ? `${PHASE_LABELS[phase]} — current step`
        : PHASE_LABELS[phase];
    return `
      <div class="wf-step ${modifiers}" role="listitem" aria-label="${ariaLabel}">
        <div class="wf-step__dot">${dot}</div>
        <span class="wf-step__label">${PHASE_LABELS[phase]}</span>
      </div>${connector}`;
  });

  return `<div class="wf-stepper" role="list" aria-label="3-phase workflow progress">${steps.join('')}</div>`;
}

function bannerHtml(phase: WorkflowPhase, status: WorkflowBannerStatus, isSwitching: boolean): string {
  const eff = effectivePhase(phase, status);
  const text = ctaText(phase, status);
  const btnLabel = ctaButtonLabel(phase, status);
  let btnHtml = '';
  if (btnLabel) {
    const disabledAttr = isSwitching ? ' disabled aria-busy="true"' : '';
    const loadingClass = isSwitching ? ' wf-cta__btn--loading' : '';
    const btnText = isSwitching ? 'Switching…' : `${btnLabel} →`;
    btnHtml = `<button type="button" class="wf-cta__btn${loadingClass}" data-wf-switch-reddit${disabledAttr}>${btnText}</button>`;
  }

  return `
    <div class="wf-banner" data-wf-effective="${eff}">
      ${stepperHtml(eff)}
      <div class="wf-cta">
        <p class="wf-cta__text">${text}</p>
        ${btnHtml}
      </div>
      <details class="wf-why">
        <summary class="wf-why__summary">Why the tab switch?</summary>
        <p class="wf-why__body">Recording happens inside Reddit for a native feel — your voice appears directly in your comment. Design and post-production (including subtitle editing and baking) happen here in the Studio, where there's space for full controls and a real-time WYSIWYG preview.</p>
      </details>
    </div>`;
}

export function mountWorkflowBanner(
  root: HTMLElement,
  initialPhase: WorkflowPhase,
  initialStatus: WorkflowBannerStatus,
): WorkflowBannerHandle {
  const el = root.querySelector<HTMLElement>('[data-workflow-banner]');
  if (!el) return { update: () => {}, dispose: () => {} };

  // Persistent ARIA live region — must survive innerHTML re-renders to announce phase changes.
  // Kept as a sibling rather than inside the banner so it isn't blown away by innerHTML =.
  const announcer = document.createElement('div');
  announcer.className = 'wf-sr-announcer';
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  el.insertAdjacentElement('beforebegin', announcer);

  let phase = initialPhase;
  let status = initialStatus;
  let isSwitching = false;

  function render(): void {
    // BUG FIX: wf-why auto-close
    // Fix: bannerHtml() rebuilds via innerHTML, destroying the open attribute; capture and restore it.
    const wasWhyOpen = el!.querySelector<HTMLDetailsElement>('.wf-why')?.open ?? false;
    el!.innerHTML = bannerHtml(phase, status, isSwitching);
    const whyEl = el!.querySelector<HTMLDetailsElement>('.wf-why');
    if (whyEl && wasWhyOpen) whyEl.open = true;
    // Update the persistent live region so screen readers announce guidance changes.
    announcer.textContent = ctaText(effectivePhase(phase, status), status);

    const switchBtn = el!.querySelector<HTMLButtonElement>('[data-wf-switch-reddit]');
    if (switchBtn) {
      switchBtn.addEventListener('click', () => {
        if (isSwitching) return;
        isSwitching = true;
        render();
        void setWorkflowPhase('capture')
          .then(() => activateRedditTab())
          .finally(() => {
            isSwitching = false;
            render();
          });
      });
    }
  }

  render();

  const unsubPhase = onWorkflowPhaseChanged((newPhase) => {
    phase = newPhase;
    render();
  });

  return {
    update(newStatus) {
      status = newStatus;
      render();
    },
    dispose() {
      unsubPhase();
      announcer.remove();
    },
  };
}
