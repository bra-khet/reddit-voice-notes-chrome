/**
 * v5.4.0 Phase 1 — Current Take deck (roadmap §4 Phase 1).
 *
 * The always-visible headline card on the main Design Studio screen: one
 * glance answers "what state is my take in, and what can I do right now?".
 * Reactive via getTakeManager().subscribe() wired in mount-clip-studio.ts.
 *
 * Primary CTA: Download MP4 — the fastest universal export (baked MP4 when
 * available, base MP4 otherwise; both read directly from extension-origin
 * IDB, no relay needed on the Studio page).
 * Secondary: Record — Phase 1 routes to the Reddit recorder (workflow
 * 'capture' phase); Phase 2 replaces this with Studio-native capture.
 */

import { getTakeManager, type CurrentTake } from '@/src/session/take-manager';
import { loadLastBakedMp4 } from '@/src/storage/last-baked-mp4-db';
import { loadLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import { buildVoiceNoteFilename, downloadBlob } from '@/src/utils/download';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { STUDIO_V4_ASSETS, studioV4AssetUrl } from '@/src/ui/design-studio/studio-v4-assets';
import { renderStudioAudition } from '@/src/ui/design-studio/studio-recorder';

export function renderCurrentTakeDeck(): string {
  return `
    <section class="studio-v4__take-deck" data-current-take-deck aria-label="Current take" aria-live="polite">
      <div class="studio-v4__take-head">
        <img class="studio-v4__icon studio-v4__icon--16" data-take-icon alt="" width="16" height="16" />
        <h2 class="studio-v4__take-title">Current Take</h2>
        <span class="studio-v4__take-badges" data-take-badges></span>
      </div>
      <p class="studio-v4__take-state" data-take-state>Checking session…</p>
      <p class="studio-v4__take-hint" data-take-hint hidden></p>
      <div class="studio-v4__take-actions">
        <button type="button" class="studio-v4__bake-btn studio-v4__bake-btn--unavailable studio-v4__take-download" data-take-download disabled>
          Download MP4
        </button>
        <div class="studio-v4__take-secondary">
          <button type="button" class="popup__profile-btn popup__profile-btn--save studio-v4__take-record" data-take-record>
            Record new take
          </button>
          <button type="button" class="studio-v4__take-clear" data-take-clear hidden>
            Discard take
          </button>
        </div>
      </div>
      ${renderStudioAudition()}
    </section>
  `;
}

type TakeDeckModel = {
  icon: string;
  stateText: string;
  hint: string | null;
  badges: Array<{ label: string; tone: 'amber' | 'ready' | 'warning' | 'muted' }>;
  download: {
    enabled: boolean;
    label: string;
    /** Which store the click should read — resolved again at click time. */
    prefer: 'baked' | 'base' | null;
  };
  recordLabel: string;
  showClear: boolean;
  /** Pulse the deck while a live session is running elsewhere. */
  live: boolean;
};

function formatClock(durationSeconds: number | undefined): string | null {
  if (typeof durationSeconds !== 'number' || durationSeconds <= 0) return null;
  const total = Math.round(durationSeconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/** Pure model derivation — mirrors roadmap §3.6 "best available state". */
export function deriveTakeDeckModel(take: CurrentTake | null): TakeDeckModel {
  const status = STUDIO_V4_ASSETS.status;

  if (!take) {
    return {
      icon: status.info,
      stateText: 'No take yet',
      hint: 'Record a take — the Studio keeps it safe and exportable from here.',
      badges: [],
      download: { enabled: false, label: 'Download MP4', prefer: null },
      recordLabel: 'Record new take',
      showClear: false,
      live: false,
    };
  }

  const clock = formatClock(
    take.meta.durationSeconds ??
      take.artifacts.bakedMp4?.durationSeconds ??
      take.artifacts.baseMp4?.durationSeconds,
  );
  const badges: TakeDeckModel['badges'] = [];
  if (clock) badges.push({ label: clock, tone: 'amber' });

  const hasBaked = Boolean(take.artifacts.bakedMp4);
  const hasBase = Boolean(take.artifacts.baseMp4);
  const prefer = hasBaked ? 'baked' : hasBase ? 'base' : null;
  const downloadLabel = hasBaked ? 'Download MP4 · captioned' : 'Download MP4';

  switch (take.status) {
    case 'recording':
      return {
        icon: status.pending,
        stateText: 'Recording in progress…',
        hint:
          take.source === 'reddit'
            ? 'Live on the Reddit recorder — it lands here when you stop.'
            : 'Live in the Studio recorder.',
        badges,
        download: { enabled: false, label: 'Download MP4', prefer: null },
        recordLabel: 'Record new take',
        showClear: false,
        live: true,
      };
    case 'processing':
      return {
        icon: status.pending,
        stateText: 'Processing your take…',
        hint: 'Converting to MP4 — this take appears here the moment it is ready.',
        badges,
        download: { enabled: false, label: 'Processing…', prefer: null },
        recordLabel: 'Record new take',
        showClear: false,
        live: true,
      };
    case 'ready':
      if (take.meta.subtitlesEnabled && !hasBaked) {
        badges.push({ label: 'SUBS PENDING', tone: 'warning' });
      }
      return {
        icon: status.complete,
        stateText: 'Take ready',
        hint: hasBase
          ? null
          : 'MP4 export not found yet — it may still be relaying from the recorder.',
        badges,
        download: { enabled: prefer !== null, label: downloadLabel, prefer },
        recordLabel: 'Re-record take',
        showClear: true,
        live: false,
      };
    case 'baked':
      badges.push({ label: 'BAKED', tone: 'ready' });
      return {
        icon: status.complete,
        stateText: 'Take baked & ready',
        hint: null,
        badges,
        download: { enabled: prefer !== null, label: downloadLabel, prefer },
        recordLabel: 'Re-record take',
        showClear: true,
        live: false,
      };
    case 'error':
      return {
        icon: status.failure,
        stateText: 'Last session failed',
        hint: take.meta.note ?? 'Something went wrong — record a fresh take.',
        badges,
        download: { enabled: prefer !== null, label: downloadLabel, prefer },
        recordLabel: 'Record new take',
        showClear: true,
        live: false,
      };
    case 'draft':
    default: {
      const hasRecordingOnly = Boolean(take.artifacts.baseRecording) && !hasBase && !hasBaked;
      badges.push({ label: 'DRAFT', tone: 'warning' });
      return {
        icon: status.warning,
        stateText: 'Incomplete take',
        hint:
          take.meta.note ??
          (hasRecordingOnly
            ? 'Captured audio is safe — reopening the Studio will finish MP4 conversion.'
            : 'This session did not finish — record again or discard.'),
        badges,
        download: { enabled: prefer !== null, label: downloadLabel, prefer },
        recordLabel: hasRecordingOnly || prefer ? 'Re-record take' : 'Record new take',
        showClear: true,
        live: false,
      };
    }
  }
}

export interface CurrentTakeDeckDeps {
  /** Record/Re-record CTA — Phase 2 routes to the Studio-native recorder. */
  onRecordRequest: () => void;
}

export interface CurrentTakeDeckHandle {
  update(take: CurrentTake | null): void;
  /** Audition mode: transport controls replace the status/actions rows. */
  setAuditionActive(active: boolean): void;
  dispose(): void;
}

export function mountCurrentTakeDeck(
  root: HTMLElement,
  deps: CurrentTakeDeckDeps,
): CurrentTakeDeckHandle {
  const deck = root.querySelector<HTMLElement>('[data-current-take-deck]')!;
  const iconEl = deck.querySelector<HTMLImageElement>('[data-take-icon]')!;
  const stateEl = deck.querySelector<HTMLElement>('[data-take-state]')!;
  const hintEl = deck.querySelector<HTMLElement>('[data-take-hint]')!;
  const badgesEl = deck.querySelector<HTMLElement>('[data-take-badges]')!;
  const downloadBtn = deck.querySelector<HTMLButtonElement>('[data-take-download]')!;
  const recordBtn = deck.querySelector<HTMLButtonElement>('[data-take-record]')!;
  const clearBtn = deck.querySelector<HTMLButtonElement>('[data-take-clear]')!;

  let model: TakeDeckModel = deriveTakeDeckModel(null);
  let downloading = false;
  let downloadFlashTimer = 0;
  let disposed = false;

  function syncDownloadButton(): void {
    if (downloading) return; // transient labels own the button until settled
    downloadBtn.textContent = model.download.label;
    downloadBtn.disabled = !model.download.enabled;
    downloadBtn.classList.toggle('studio-v4__bake-btn--ready', model.download.enabled);
    downloadBtn.classList.toggle('studio-v4__bake-btn--unavailable', !model.download.enabled);
  }

  function render(): void {
    iconEl.src = studioV4AssetUrl(model.icon);
    stateEl.textContent = model.stateText;
    hintEl.textContent = model.hint ?? '';
    hintEl.hidden = !model.hint;
    badgesEl.replaceChildren(
      ...model.badges.map((badge) => {
        const chip = document.createElement('span');
        chip.className = `studio-v4__take-badge studio-v4__take-badge--${badge.tone}`;
        chip.textContent = badge.label;
        return chip;
      }),
    );
    deck.classList.toggle('studio-v4__take-deck--live', model.live);
    syncDownloadButton();
    recordBtn.textContent = model.recordLabel;
    clearBtn.hidden = !model.showClear;
  }

  downloadBtn.addEventListener('click', () => {
    if (downloading || !model.download.enabled) return;
    downloading = true;
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Preparing…';

    void (async () => {
      try {
        // Resolve at click time — the snapshot may have advanced (fresh bake)
        // since the last render; always export the best available MP4.
        const snapshot =
          model.download.prefer === 'baked'
            ? ((await loadLastBakedMp4()) ?? (await loadLastBaseMp4()))
            : ((await loadLastBaseMp4()) ?? (await loadLastBakedMp4()));
        if (!snapshot) {
          downloadBtn.textContent = 'No MP4 found';
          return;
        }
        downloadBlob(snapshot.blob, buildVoiceNoteFilename('mp4'));
        downloadBtn.textContent = 'Downloaded ✓';
      } catch (error) {
        console.warn(`${EXTENSION_LOG_PREFIX} Take download failed`, error);
        downloadBtn.textContent = 'Download failed';
      } finally {
        window.clearTimeout(downloadFlashTimer);
        downloadFlashTimer = window.setTimeout(() => {
          downloading = false;
          if (!disposed) syncDownloadButton();
        }, 1800);
      }
    })();
  });

  recordBtn.addEventListener('click', () => {
    deps.onRecordRequest();
  });

  clearBtn.addEventListener('click', () => {
    if (!window.confirm('Discard the current take? The Studio will forget this session.')) return;
    // Snapshot only — the single-slot IDB blobs are overwritten by the next
    // take anyway (roadmap §5 storage-bloat answer), and the voice/subtitle
    // panels keep working against the last stored media until then.
    void getTakeManager()
      .clearCurrentTake()
      .catch((error: unknown) => {
        console.warn(`${EXTENSION_LOG_PREFIX} Could not clear take`, error);
      });
  });

  render();

  return {
    update(take: CurrentTake | null): void {
      model = deriveTakeDeckModel(take);
      render();
    },
    setAuditionActive(active: boolean): void {
      deck.classList.toggle('studio-v4__take-deck--audition', active);
    },
    dispose(): void {
      disposed = true;
      window.clearTimeout(downloadFlashTimer);
    },
  };
}
