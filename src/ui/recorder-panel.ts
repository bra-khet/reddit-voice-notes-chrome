import {
  DISPLAY_MAX_RECORDING_SECONDS,
  formatRecordingCapProse,
  MAX_RECORDING_SECONDS,
} from '@/src/utils/constants';
import { VoiceRecorderSession, type RecorderState } from '@/src/recorder/voice-recorder';
import { attachMp4ToComposer } from '@/src/reddit-injector/video-attach';
import { resolveAppearanceTheme } from '@/src/theme';
import { DEFAULT_THEME_ID } from '@/src/theme/presets';
import { parseClipStyleSelectValue } from '@/src/settings/clip-profiles';
import { presetProfileId } from '@/src/settings/preset-profiles';
import {
  applyClipProfile,
  loadUserPreferences,
  onUserPreferencesChanged,
  type AppearancePreferences,
} from '@/src/settings/user-preferences';
import {
  getWorkflowPhase,
  onWorkflowPhaseChanged,
  setWorkflowPhase,
  type WorkflowPhase,
} from '@/src/workflow/workflow-state';
import { populateRecorderClipStyleSelect } from '@/src/ui/clip-style-select';
import { deriveChromeFromTheme } from '@/src/ui/theme-chrome';
import { RVN_COLORS } from '@/src/ui/tokens';
import { fetchBakedMp4FromExtension } from '@/src/storage/baked-mp4-fetch';
import { BAKED_MP4_READY_KEY } from '@/src/settings/user-preferences';
import { openDesignStudioWindow } from '@/src/ui/design-studio/open-design-studio';
import {
  getTakeManager,
  isTransientTakeStatus,
  type CurrentTake,
} from '@/src/session/take-manager';
import { showToast } from './toast';

const PANEL_HOST_ATTR = 'data-rvn-recorder-host';

/**
 * Studio chrome mirrored for the Reddit-docked recorder panel. The panel lives in a
 * content-script Shadow DOM and can't read the Design Studio's CSS custom properties, so
 * the nocturnal-indigo + amber identity is mirrored here. Keep in sync with
 * entrypoints/design-studio/studio-palette.css. The Record button's accent stays
 * theme-derived (--rvn-accent) so it reads as the active clip's colour.
 */
const STUDIO = {
  bgDeep: '#12001f',
  surfaceInset: '#0a0014',
  surfaceRaised: '#241a4a',
  amber: '#ffd54f',
  amberDim: '#c9a63d',
  amberEdge: '#8a6f1a',
  cyanReady: '#5ec8e8',
  text: '#e8e6f0',
  textMuted: '#a8a4c0',
  hairline: 'rgba(138, 134, 176, 0.22)',
} as const;

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export class RecorderPanel {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private session: VoiceRecorderSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private currentState: RecorderState = {
    phase: 'idle',
    elapsedSeconds: 0,
    processingProgress: 0,
    nearLimit: false,
    criticalLimit: false,
    stoppedAtCap: false,
  };

  private panelEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private studioCtaBtn!: HTMLButtonElement;
  private timerEl!: HTMLElement;
  private timeProgressEl!: HTMLElement;
  private timeProgressBar!: HTMLElement;
  private waveformSlot!: HTMLElement;
  private primaryBtn!: HTMLButtonElement;
  private secondaryBtn!: HTMLButtonElement;
  private tertiaryBtn!: HTMLButtonElement;
  private closeBtn!: HTMLButtonElement;
  private themeSelect!: HTMLSelectElement;
  private themeUnsubscribe: (() => void) | null = null;
  private readonly composer: Element | null;
  private previouslyFocused: HTMLElement | null = null;
  private lastNotifiedPhase: RecorderState['phase'] | null = null;
  private lastNotifiedError = '';
  private attaching = false;
  private bakedMp4Listener: ((changes: Record<string, unknown>, area: string) => void) | null = null;
  private workflowPhase: WorkflowPhase = 'design';
  private unsubWorkflowPhase: (() => void) | null = null;
  /** v5.4.0: auto-draft when the Reddit tab itself is torn down mid-session. */
  private pageHideHandler: (() => void) | null = null;
  /**
   * v5.4.0 Phase 3: 'attach' when a completed Studio take exists — the panel
   * opens as an output target (attach primary, record-here secondary).
   */
  private mode: 'record' | 'attach' = 'record';
  private attachableTake: CurrentTake | null = null;

  constructor(composer: Element | null = null) {
    this.composer = composer;
    this.host = document.createElement('div');
    this.host.setAttribute(PANEL_HOST_ATTR, 'true');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .panel {
          position: fixed;
          left: 50%;
          bottom: 24px;
          transform: translateX(-50%);
          z-index: 2147483647;
          width: min(420px, calc(100vw - 32px));
          padding: 16px;
          border-radius: 14px;
          background: linear-gradient(180deg, rgba(29, 31, 110, 0.28), rgba(18, 0, 31, 0)) ${STUDIO.bgDeep};
          color: ${STUDIO.text};
          font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          box-shadow:
            0 12px 40px rgba(0, 0, 0, 0.55),
            inset 0 1px 0 rgba(255, 213, 79, 0.12);
          border: 1px solid var(--rvn-panel-border, ${STUDIO.hairline});
          color-scheme: dark;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .title {
          margin: 0;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: ${STUDIO.amber};
        }
        .close {
          border: none;
          background: transparent;
          color: ${STUDIO.textMuted};
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 8px;
        }
        .close:hover { background: rgba(255, 213, 79, 0.12); color: ${STUDIO.amber}; }
        .close:focus-visible { outline: 2px solid var(--rvn-focus, ${STUDIO.amber}); outline-offset: 2px; }
        .status {
          color: ${STUDIO.textMuted};
          font-size: 12px;
          margin: 0 0 8px;
          min-height: 1.4em;
        }
        .status--error { color: ${RVN_COLORS.error}; }
        .status--success { color: ${STUDIO.cyanReady}; }
        .status--warning { color: ${STUDIO.amber}; }
        .status-studio {
          margin: 0 0 10px;
        }
        .status-studio[hidden] { display: none !important; }
        .studio-flow {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 10px;
          margin-top: 8px;
        }

        .studio-first-hint {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin: 0;
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid rgba(255, 213, 79, 0.55);
          background: rgba(212, 160, 32, 0.16);
          color: #ffd54f;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.03em;
          line-height: 1.2;
          box-shadow: 0 0 12px rgba(255, 193, 7, 0.18);
        }
        .studio-first-hint__caution {
          flex-shrink: 0;
          font-size: 16px;
          line-height: 1;
          color: #ffb84d;
        }
        .studio-first-hint__arrow {
          flex-shrink: 0;
          font-size: 22px;
          font-weight: 800;
          line-height: 1;
          color: #ffd54f;
          transform: translateY(-1px);
        }
        .studio-cta {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border: 1px solid #6b70c4;
          border-radius: 999px;
          background: #9498e8;
          color: #f4f3ff;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 0 0 1px rgba(107, 112, 196, 0.35), 0 2px 8px rgba(107, 112, 196, 0.3);
        }
        .studio-cta:hover {
          filter: brightness(1.08);
        }
        .studio-cta:focus-visible {
          outline: 2px solid #9498e8;
          outline-offset: 2px;
        }
        .timer-wrap { margin: 0 0 8px; }
        .timer {
          font-variant-numeric: tabular-nums;
          font-size: 24px;
          font-weight: 700;
          margin: 0;
        }
        .timer--warning { color: ${STUDIO.amber}; }
        .timer--critical { color: ${RVN_COLORS.error}; }
        .timer__cap { font-size: 12px; font-weight: 500; color: ${STUDIO.textMuted}; margin-left: 8px; }
        .time-progress {
          height: 3px;
          border-radius: 2px;
          background: ${STUDIO.surfaceRaised};
          margin-bottom: 12px;
          overflow: hidden;
        }
        .time-progress__bar {
          height: 100%;
          width: 0%;
          background: var(--rvn-accent, ${STUDIO.amber});
          transition: width 0.25s linear, background 0.2s ease;
        }
        .time-progress__bar--warning { background: ${RVN_COLORS.warning}; }
        .time-progress__bar--critical { background: ${RVN_COLORS.error}; }
        .waveform {
          width: 100%;
          aspect-ratio: 16 / 9;
          border-radius: 10px;
          overflow: hidden;
          background: ${STUDIO.surfaceInset};
          border: 1px solid rgba(255, 213, 79, 0.18);
          box-shadow: inset 0 0 18px rgba(0, 0, 0, 0.6);
          margin-bottom: 12px;
        }
        .waveform canvas { width: 100%; height: 100%; display: block; }
        .theme-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 12px;
        }
        .theme-row__label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: ${STUDIO.amberDim};
          white-space: nowrap;
        }
        .theme-row__select {
          flex: 1;
          border: 1px solid ${STUDIO.hairline};
          border-radius: 8px;
          background: ${STUDIO.surfaceRaised};
          color: ${STUDIO.text};
          font: inherit;
          font-size: 12px;
          padding: 6px 8px;
          cursor: pointer;
        }
        .theme-row__select:focus-visible {
          outline: 2px solid var(--rvn-focus, ${STUDIO.amber});
          outline-offset: 2px;
        }
        .theme-row__select:disabled { opacity: 0.55; cursor: not-allowed; }
        .progress {
          height: 4px;
          border-radius: 2px;
          background: ${STUDIO.surfaceRaised};
          margin-bottom: 12px;
          overflow: hidden;
        }
        .progress__bar {
          height: 100%;
          width: 0%;
          background: var(--rvn-accent, ${STUDIO.amber});
          transition: width 0.2s ease;
        }
        .actions { display: flex; gap: 8px; }
        button.action {
          flex: 1;
          border: none;
          border-radius: 999px;
          padding: 10px 14px;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        .action--primary {
          background: var(--rvn-accent, ${RVN_COLORS.redditOrange});
          color: var(--rvn-accent-text, #fff);
        }
        .action--primary:hover {
          background: var(--rvn-accent-hover, ${RVN_COLORS.redditOrangeHover});
          filter: brightness(1.06);
        }
        .action--secondary { background: ${STUDIO.surfaceRaised}; color: ${STUDIO.text}; border: 1px solid ${STUDIO.hairline}; }
        .action--secondary:hover { background: #2e2360; border-color: ${STUDIO.amberEdge}; }
        .action:focus-visible { outline: 2px solid var(--rvn-focus, ${STUDIO.amber}); outline-offset: 2px; }
        .action:disabled { opacity: 0.5; cursor: not-allowed; }
        .tertiary {
          display: block;
          width: 100%;
          margin-top: 8px;
          border: none;
          background: transparent;
          color: ${STUDIO.textMuted};
          font: inherit;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          padding: 6px 4px;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .tertiary:hover { color: ${STUDIO.amber}; }
        .tertiary:focus-visible { outline: 2px solid var(--rvn-focus, ${STUDIO.amber}); outline-offset: 2px; border-radius: 4px; }
        /* Light Reddit: the panel stays nocturnal-indigo — the Studio is dark by identity,
           so it docks as a deliberate instrument, not a theme-flipped card. Only firm up the
           edge + shadow for separation against a light page; color-scheme stays dark so the
           native clip-style <select> popup renders dark too. */
        @media (prefers-color-scheme: light) {
          .panel {
            border-color: rgba(18, 0, 31, 0.55);
            box-shadow:
              0 12px 40px rgba(0, 0, 0, 0.3),
              inset 0 1px 0 rgba(255, 213, 79, 0.12);
          }
        }
        /* ── 3-phase how-it-works intro card ── */
        .how-it-works {
          margin: 6px 0 10px;
          border-radius: 8px;
          border: 1px solid rgba(148, 152, 232, 0.2);
          background: rgba(26, 31, 110, 0.22);
          overflow: hidden;
        }
        .how-it-works[hidden] { display: none !important; }
        .how-it-works__summary {
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 600;
          color: #9498e8;
          cursor: pointer;
          list-style: none;
          display: flex;
          align-items: center;
          gap: 6px;
          user-select: none;
        }
        .how-it-works__summary::-webkit-details-marker { display: none; }
        .how-it-works__summary::marker { content: ''; }
        .how-it-works__summary::before {
          content: '▶';
          font-size: 8px;
          transition: transform 0.15s ease;
          display: inline-block;
        }
        .how-it-works[open] .how-it-works__summary::before { transform: rotate(90deg); }
        .how-it-works__summary:focus-visible { outline: 2px solid #9498e8; outline-offset: -2px; border-radius: 6px; }
        .how-it-works__body { padding: 0 10px 10px; display: flex; flex-direction: column; gap: 5px; }
        .how-it-works__step { display: flex; align-items: flex-start; gap: 8px; margin: 0; }
        .how-it-works__num {
          flex-shrink: 0;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: rgba(148, 152, 232, 0.22);
          color: #9498e8;
          font-size: 10px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          margin-top: 2px;
        }
        .how-it-works__step-text { font-size: 12px; color: #c9cdf5; margin: 0; }
        .how-it-works__step-text strong { color: #e0e2f8; }
        /* ── v5.4.0 Phase 3: Current Studio Take card (attach mode) ──
           Mirrors the Studio deck's card language: amber signage title,
           mono chronos chip, indigo inset surface. */
        .take-card {
          margin: 0 0 12px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(255, 213, 79, 0.28);
          background: linear-gradient(180deg, rgba(29, 31, 110, 0.3), rgba(10, 0, 20, 0.55));
          box-shadow: inset 0 1px 0 rgba(255, 213, 79, 0.08);
        }
        .take-card[hidden] { display: none !important; }
        .take-card__head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 4px;
        }
        .take-card__title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: ${STUDIO.amber};
        }
        .take-card__chip {
          font: 700 11px/1 ui-monospace, 'Cascadia Mono', 'SFMono-Regular', monospace;
          font-variant-numeric: tabular-nums;
          color: ${STUDIO.amber};
          background: rgba(212, 160, 32, 0.16);
          border: 1px solid rgba(255, 213, 79, 0.45);
          border-radius: 999px;
          padding: 3px 8px;
        }
        .take-card__chip[hidden] { display: none !important; }
        .take-card__state { margin: 0; font-size: 13px; font-weight: 600; color: ${STUDIO.text}; }
      </style>
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="rvn-title" tabindex="-1">
        <div class="header">
          <h2 class="title" id="rvn-title">Voice Note</h2>
          <button class="close" type="button" aria-label="Close recorder">×</button>
        </div>
        <div class="status-studio" data-status-studio>
          <p class="status" data-status role="status" aria-live="polite">Initializing microphone…</p>
          <div class="studio-flow" data-studio-flow>
            <p class="studio-first-hint" id="rvn-studio-first-hint">
              <span class="studio-first-hint__caution" aria-hidden="true">⚠</span>
              <span class="studio-first-hint__arrow" aria-hidden="true">→</span>
              <strong>Go here first</strong>
            </p>
            <button type="button" class="studio-cta" data-open-design-studio aria-describedby="rvn-studio-first-hint">
              Open Design Studio
            </button>
          </div>
        </div>
        <div class="take-card" data-take-card hidden>
          <div class="take-card__head">
            <span class="take-card__title">Current Studio Take</span>
            <span class="take-card__chip" data-take-chip hidden></span>
          </div>
          <p class="take-card__state" data-take-card-state></p>
        </div>
        <details class="how-it-works" data-how-it-works hidden>
          <summary class="how-it-works__summary">How this works</summary>
          <div class="how-it-works__body">
            <p class="how-it-works__step">
              <span class="how-it-works__num" aria-hidden="true">1</span>
              <span class="how-it-works__step-text"><strong>Design</strong> — pick clip style, background &amp; voice in Design Studio.</span>
            </p>
            <p class="how-it-works__step">
              <span class="how-it-works__num" aria-hidden="true">2</span>
              <span class="how-it-works__step-text"><strong>Capture</strong> — return here and record your voice comment.</span>
            </p>
            <p class="how-it-works__step">
              <span class="how-it-works__num" aria-hidden="true">3</span>
              <span class="how-it-works__step-text"><strong>Polish &amp; Bake</strong> — go back to Studio to edit subtitles and bake your final MP4.</span>
            </p>
          </div>
        </details>
        <div class="timer-wrap" aria-live="polite" aria-atomic="true">
          <p class="timer" data-timer>0:00<span class="timer__cap">/ 2:00 max</span></p>
        </div>
        <div class="time-progress" data-time-progress aria-hidden="true">
          <div class="time-progress__bar" data-time-progress-bar></div>
        </div>
        <div class="progress" data-progress hidden><div class="progress__bar" data-progress-bar></div></div>
        <div class="waveform" data-waveform aria-label="Live audio waveform"></div>
        <div class="theme-row" data-theme-row hidden>
          <label class="theme-row__label" for="rvn-theme">Clip style</label>
          <select class="theme-row__select" id="rvn-theme" data-theme aria-label="Clip style"></select>
        </div>
        <div class="actions">
          <button class="action action--primary" type="button" data-primary disabled>Record</button>
          <button class="action action--secondary" type="button" data-secondary hidden>Cancel</button>
        </div>
        <button class="tertiary" type="button" data-tertiary hidden>Record again</button>
      </div>
    `;

    this.panelEl = this.shadow.querySelector('.panel')!;
    this.statusEl = this.shadow.querySelector('[data-status]')!;
    this.studioCtaBtn = this.shadow.querySelector('[data-open-design-studio]')!;
    this.timerEl = this.shadow.querySelector('[data-timer]')!;
    this.timeProgressEl = this.shadow.querySelector('[data-time-progress]')!;
    this.timeProgressBar = this.shadow.querySelector('[data-time-progress-bar]')!;
    this.waveformSlot = this.shadow.querySelector('[data-waveform]')!;
    this.primaryBtn = this.shadow.querySelector('[data-primary]')!;
    this.secondaryBtn = this.shadow.querySelector('[data-secondary]')!;
    this.tertiaryBtn = this.shadow.querySelector('[data-tertiary]')!;
    this.closeBtn = this.shadow.querySelector('.close')!;
    this.themeSelect = this.shadow.querySelector('[data-theme]')!;

    this.themeSelect.addEventListener('change', () => {
      const parsed = parseClipStyleSelectValue(this.themeSelect.value);
      const profileId =
        parsed.kind === 'profile' ? parsed.profileId : presetProfileId(parsed.themeId);
      // CHANGED: bundled presets use virtual dummy profiles (`preset-{themeId}`).
      // WHY: same applyClipProfile path as saved profiles — fully resets style, bg, and overrides.
      void applyClipProfile(profileId).then((prefs) => {
        this.syncClipStyleSelect(prefs);
        this.applyThemeChrome(prefs.appearance);
      });
    });

    this.primaryBtn.addEventListener('click', () => this.onPrimaryClick());
    this.secondaryBtn.addEventListener('click', () => this.onSecondaryClick());
    this.tertiaryBtn.addEventListener('click', () => this.onTertiaryClick());
    this.closeBtn.addEventListener('click', () => this.requestClose());
    this.studioCtaBtn.addEventListener('click', () => openDesignStudioWindow());

    // Mark the 3-phase intro card as seen on any interaction so it stays collapsed on future opens.
    this.shadow.querySelector('[data-how-it-works]')?.addEventListener('toggle', () => {
      try { localStorage.setItem('rvn.wf.how-seen', '1'); } catch { /* sandboxed env */ }
    });

    this.host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.requestClose();
      }
    });
  }

  private applyThemeChrome(appearance: AppearancePreferences): void {
    const chrome = deriveChromeFromTheme(resolveAppearanceTheme(appearance));
    this.panelEl.style.setProperty('--rvn-accent', chrome.accent);
    this.panelEl.style.setProperty('--rvn-accent-hover', chrome.accentHover);
    this.panelEl.style.setProperty('--rvn-accent-text', chrome.accentText);
    this.panelEl.style.setProperty('--rvn-focus', chrome.focusRing);
    this.panelEl.style.setProperty('--rvn-panel-border', chrome.panelBorder);
  }

  private syncClipStyleSelect(prefs: Awaited<ReturnType<typeof loadUserPreferences>>): void {
    populateRecorderClipStyleSelect(this.themeSelect, prefs);
  }

  async open(): Promise<void> {
    this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!document.body.contains(this.host)) {
      document.body.appendChild(this.host);
    }

    this.lastNotifiedPhase = null;
    this.lastNotifiedError = '';

    this.themeUnsubscribe?.();
    this.themeUnsubscribe = onUserPreferencesChanged((prefs) => {
      this.syncClipStyleSelect(prefs);
      this.applyThemeChrome(prefs.appearance);
    });

    this.unsubWorkflowPhase?.();
    this.unsubWorkflowPhase = onWorkflowPhaseChanged((phase) => {
      this.workflowPhase = phase;
      if (this.mode === 'record') this.render(this.currentState);
    });

    // v5.4.0: tab navigation / close mid-session — same auto-draft semantics
    // as panel close. storage.local writes from pagehide are best-effort but
    // reliable in practice (same pattern as the Studio's BUG-017 flushes).
    this.pageHideHandler = () => this.session?.persistTakeOnClose();
    window.addEventListener('pagehide', this.pageHideHandler);

    // v5.4.0 Phase 3: with a completed Studio take + a live composer, the
    // panel opens as an OUTPUT TARGET — attach primary, record-here secondary.
    const attachTake = await this.findAttachableTake();
    if (attachTake) {
      this.mode = 'attach';
      this.attachableTake = attachTake;
      try {
        const [prefs, phase] = await Promise.all([loadUserPreferences(), getWorkflowPhase()]);
        this.workflowPhase = phase;
        this.syncClipStyleSelect(prefs);
        this.applyThemeChrome(prefs.appearance);
      } catch {
        // Default chrome is fine — attach itself relays through the background.
      }
      this.renderAttachMode();
      this.panelEl.focus();
      return;
    }

    await this.startRecordSession();
  }

  /** Completed takes only — a mid-flight or artifact-less snapshot records fresh. */
  private async findAttachableTake(): Promise<CurrentTake | null> {
    if (!this.composer || !document.contains(this.composer)) return null;
    try {
      const take = await getTakeManager().getCurrentTake();
      if (!take || isTransientTakeStatus(take.status)) return null;
      if (!take.artifacts.bakedMp4 && !take.artifacts.baseMp4) return null;
      return take;
    } catch {
      return null;
    }
  }

  private async startRecordSession(): Promise<void> {
    this.mode = 'record';
    this.attachableTake = null;
    this.setAttachChromeVisible(false);

    this.session?.dispose();
    this.unsubscribe?.();
    this.session = new VoiceRecorderSession();
    this.unsubscribe = this.session.subscribe((state) => {
      this.currentState = state;
      this.render(state);
    });

    if (this.bakedMp4Listener) {
      browser.storage.onChanged.removeListener(this.bakedMp4Listener);
    }
    this.bakedMp4Listener = (changes, area) => {
      if (area !== 'local' || !(BAKED_MP4_READY_KEY in changes)) return;
      void this.tryApplyBakedMp4();
    };
    browser.storage.onChanged.addListener(this.bakedMp4Listener);

    try {
      const [prefs, phase] = await Promise.all([loadUserPreferences(), getWorkflowPhase()]);
      this.workflowPhase = phase;
      this.syncClipStyleSelect(prefs);
      this.applyThemeChrome(prefs.appearance);
      await this.session.prepare();
      this.panelEl.focus();
      void this.tryApplyBakedMp4();
    } catch (error) {
      // BUG FIX: recorder panel frozen on an invalidated extension context (fresh install / auto-update)
      // Fix: a failure BEFORE session.prepare() — e.g. loadUserPreferences() throwing "Extension
      //   context invalidated" when this content script was orphaned by an extension reload/update —
      //   left the session in 'idle', so the panel froze on "Initializing microphone…" with a grayed
      //   Record button (the old catch wrongly assumed prepare() had already rendered the error).
      //   Route it through the session so friendlyRecorderError renders the actionable "Extension was
      //   reloaded. Refresh this Reddit tab…" message + a one-click Refresh. The misdiagnosed 200ms
      //   "service worker race" retry is removed: an orphaned content script never recovers in place,
      //   so retrying just threw the same error and still left the panel frozen.
      // Sync: VoiceRecorderSession.failWith() no-ops unless still 'idle'; render() + onPrimaryClick()
      //   map errorCode 'context-invalidated' to the Refresh-page button.
      this.session?.failWith(error);
      this.panelEl.focus();
    }
  }

  /** Toggle panel chrome between attach mode (take card) and record mode. */
  private setAttachChromeVisible(visible: boolean): void {
    const takeCard = this.shadow.querySelector<HTMLElement>('[data-take-card]')!;
    const timerWrap = this.shadow.querySelector<HTMLElement>('.timer-wrap')!;
    takeCard.hidden = !visible;
    timerWrap.hidden = visible;
    this.waveformSlot.hidden = visible;
    this.timeProgressEl.hidden = true;
  }

  private renderAttachMode(): void {
    const take = this.attachableTake;
    if (!take) return;

    this.setAttachChromeVisible(true);

    const chip = this.shadow.querySelector<HTMLElement>('[data-take-chip]')!;
    const cardState = this.shadow.querySelector<HTMLElement>('[data-take-card-state]')!;
    const duration =
      take.meta.durationSeconds ??
      take.artifacts.bakedMp4?.durationSeconds ??
      take.artifacts.baseMp4?.durationSeconds;
    chip.hidden = typeof duration !== 'number' || duration <= 0;
    if (!chip.hidden) chip.textContent = formatTime(Math.round(duration!));

    const baked = Boolean(take.artifacts.bakedMp4);
    cardState.textContent =
      take.status === 'baked' || baked
        ? 'Baked & ready — captions burned in.'
        : take.status === 'ready'
          ? 'Ready — styled MP4 from your Studio session.'
          : 'Recovered from an earlier session.';

    this.statusEl.textContent = 'Attach your Studio take, or record a fresh one here.';
    this.statusEl.classList.remove('status--error', 'status--success', 'status--warning');

    const studioHintEl = this.shadow.querySelector<HTMLElement>('.studio-first-hint');
    if (studioHintEl) {
      studioHintEl.innerHTML =
        '<span class="studio-first-hint__caution" aria-hidden="true">★</span>' +
        '<strong>Made in Studio</strong>';
    }
    this.studioCtaBtn.textContent = 'Edit in Design Studio';

    const howItWorks = this.shadow.querySelector<HTMLDetailsElement>('[data-how-it-works]');
    if (howItWorks) howItWorks.hidden = true;

    this.primaryBtn.textContent = 'Attach Studio take';
    this.primaryBtn.disabled = false;
    this.secondaryBtn.hidden = false;
    this.secondaryBtn.disabled = false;
    this.secondaryBtn.textContent = 'Record new here';
    this.tertiaryBtn.hidden = true;
  }

  private async attachStudioTake(): Promise<void> {
    const take = this.attachableTake;
    if (!take || this.attaching) return;
    if (!this.composer || !document.contains(this.composer)) {
      showToast('Comment box not found — download the MP4 from the Studio instead.', 'error', 6000);
      return;
    }

    this.attaching = true;
    this.primaryBtn.disabled = true;
    this.primaryBtn.textContent = 'Fetching take…';

    try {
      const store = take.artifacts.bakedMp4 ? 'baked' : 'base';
      const blob = await fetchBakedMp4FromExtension(store);
      if (!blob) {
        this.statusEl.textContent =
          'Could not load the Studio take — open the Design Studio to check it.';
        this.statusEl.classList.add('status--error');
        showToast('Studio take not found in storage.', 'error', 6000);
        return;
      }

      this.primaryBtn.textContent = 'Attaching…';
      const result = await attachMp4ToComposer(this.composer, blob);
      showToast(result.message, result.ok ? 'info' : 'error', 6000);
      this.statusEl.textContent = result.message;
      this.statusEl.classList.toggle('status--success', result.ok);
      this.statusEl.classList.toggle('status--error', !result.ok);
      if (result.ok) {
        // Loop closed — Studio is ready to design the next clip.
        void setWorkflowPhase('design');
      }
    } finally {
      this.attaching = false;
      this.primaryBtn.disabled = false;
      this.primaryBtn.textContent = 'Attach Studio take';
    }
  }

  private async tryApplyBakedMp4(): Promise<void> {
    if (!this.session) return;
    const phase = this.currentState.phase;
    if (phase !== 'stopped' && phase !== 'processing') return;
    const blob = await fetchBakedMp4FromExtension();
    if (!blob) return;
    this.session.applyBakedMp4(blob);
    showToast('Captioned MP4 ready — attach or download.', 'info', 5000);
  }

  close(): void {
    // v5.4.0: auto-draft — a panel torn down mid-session must leave a
    // recoverable take snapshot (or restore the prior one) before dispose.
    this.session?.persistTakeOnClose();
    if (this.pageHideHandler) {
      window.removeEventListener('pagehide', this.pageHideHandler);
      this.pageHideHandler = null;
    }
    if (this.bakedMp4Listener) {
      browser.storage.onChanged.removeListener(this.bakedMp4Listener);
      this.bakedMp4Listener = null;
    }
    this.themeUnsubscribe?.();
    this.themeUnsubscribe = null;
    this.unsubWorkflowPhase?.();
    this.unsubWorkflowPhase = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();
    this.session = null;
    this.host.remove();

    if (this.previouslyFocused?.isConnected) {
      this.previouslyFocused.focus();
    }
    this.previouslyFocused = null;
  }

  private requestClose(): void {
    const { phase, elapsedSeconds } = this.currentState;

    if (phase === 'recording' && elapsedSeconds > 0) {
      const discard = window.confirm('Discard this recording?');
      if (!discard) return;
      // Take reconciliation happens inside session.cancel() — discard restores
      // the pre-session snapshot (nothing durable was captured yet).
      this.session?.cancel();
      this.close();
      return;
    }

    if (phase === 'processing') {
      this.session?.cancel();
      showToast('Processing cancelled.', 'info');
      this.close();
      return;
    }

    this.close();
  }

  private onPrimaryClick(): void {
    if (this.mode === 'attach') {
      void this.attachStudioTake();
      return;
    }
    if (!this.session) return;

    switch (this.currentState.phase) {
      case 'ready':
        void this.session.startRecording();
        break;
      case 'recording':
        void this.session.stopRecording();
        break;
      case 'stopped':
        this.session.downloadRecording();
        showToast('MP4 downloaded.', 'info', 4000);
        break;
      case 'error':
        // BUG FIX: recorder panel frozen on an invalidated extension context (fresh install / auto-update)
        // Fix: a dead content script never recovers in place — reload the tab to inject a fresh one.
        //   Other errors (mic, transcode) still retry by re-running open(). Sync: render() 'error' case.
        if (this.currentState.errorCode === 'context-invalidated') {
          window.location.reload();
          return;
        }
        void this.open();
        break;
    }
  }

  private onSecondaryClick(): void {
    if (this.mode === 'attach') {
      // "Record new here" — classic capture flow; TakeManager stashes the
      // prior snapshot, so a discarded recording restores this take intact.
      void this.startRecordSession();
      return;
    }
    if (!this.session) return;

    if (this.currentState.phase === 'recording') {
      if (this.currentState.elapsedSeconds > 0) {
        const discard = window.confirm('Discard this recording?');
        if (!discard) return;
      }
      this.session.cancel();
      this.close();
      return;
    }

    if (this.currentState.phase === 'processing') {
      this.session.cancel();
      showToast('Processing cancelled.', 'info');
      this.close();
      return;
    }

    if (this.currentState.phase === 'stopped') {
      void this.attachToReddit();
      return;
    }

    if (this.currentState.phase === 'error') {
      this.close();
    }
  }

  private onTertiaryClick(): void {
    if (!this.session || this.currentState.phase !== 'stopped') return;
    void this.session.resetForNewRecording();
    // Re-enter capture phase so Design Studio banner reflects a new recording in progress.
    void setWorkflowPhase('capture');
  }

  private async attachToReddit(): Promise<void> {
    const blob = this.currentState.mp4Blob;
    if (!blob) {
      showToast('MP4 is not ready yet.', 'error');
      return;
    }

    if (!this.composer || !document.contains(this.composer)) {
      showToast('Comment box not found — download the MP4 and upload manually.', 'error', 6000);
      return;
    }

    if (this.attaching) return;
    this.attaching = true;
    this.secondaryBtn.disabled = true;
    this.secondaryBtn.textContent = 'Attaching…';

    try {
      const result = await attachMp4ToComposer(this.composer, blob);
      showToast(result.message, result.ok ? 'info' : 'error', 6000);
      if (result.ok) {
        this.statusEl.textContent = result.message;
        this.statusEl.classList.remove('status--error');
        this.statusEl.classList.add('status--success');
        // Full loop closure: return to Phase 1 so Design Studio is ready for the next clip.
        void setWorkflowPhase('design');
      }
    } finally {
      this.attaching = false;
      if (this.currentState.phase === 'stopped') {
        this.secondaryBtn.disabled = !this.currentState.mp4Blob || !this.composer;
        this.secondaryBtn.textContent = 'Attach to Reddit';
      }
    }
  }

  private render(state: RecorderState): void {
    const capLabel = formatTime(DISPLAY_MAX_RECORDING_SECONDS);
    this.timerEl.innerHTML = `${formatTime(state.elapsedSeconds)}<span class="timer__cap">/ ${capLabel} max</span>`;

    this.timerEl.classList.toggle('timer--warning', state.phase === 'recording' && state.nearLimit && !state.criticalLimit);
    this.timerEl.classList.toggle('timer--critical', state.phase === 'recording' && state.criticalLimit);

    const elapsedRatio = Math.min(1, state.elapsedSeconds / DISPLAY_MAX_RECORDING_SECONDS);
    this.timeProgressEl.hidden = state.phase !== 'recording';
    this.timeProgressBar.style.width = `${elapsedRatio * 100}%`;
    this.timeProgressBar.classList.toggle('time-progress__bar--warning', state.nearLimit && !state.criticalLimit);
    this.timeProgressBar.classList.toggle('time-progress__bar--critical', state.criticalLimit);

    const progressEl = this.shadow.querySelector<HTMLElement>('[data-progress]')!;
    const progressBar = this.shadow.querySelector<HTMLElement>('[data-progress-bar]')!;
    progressEl.hidden = state.phase !== 'processing';
    progressBar.style.width = `${state.processingProgress}%`;

    const canvas = this.session?.previewCanvas;
    if (canvas && !this.waveformSlot.contains(canvas)) {
      this.waveformSlot.replaceChildren(canvas);
    }

    // UX guard: hide in-panel theme picker while recording. Pipeline supports live swaps via
    // extension popup + onUserPreferencesChanged → waveform.setTheme (see pretty-branch.md).
    const themeRow = this.shadow.querySelector<HTMLElement>('[data-theme-row]')!;
    const themeEditable = state.phase === 'ready' || state.phase === 'idle';
    themeRow.hidden = !themeEditable;
    this.themeSelect.disabled = !themeEditable || state.phase === 'idle';
    if (themeEditable && !this.themeSelect.value) {
      this.themeSelect.value = DEFAULT_THEME_ID;
    }

    this.secondaryBtn.hidden = !['recording', 'stopped', 'processing', 'error'].includes(state.phase);
    this.tertiaryBtn.hidden = state.phase !== 'stopped';

    this.statusEl.classList.remove('status--error', 'status--success', 'status--warning');
    // Phase-aware studio flow label — before recording: "Go here first"; after: "Return to studio"
    const studioFlowEl = this.shadow.querySelector<HTMLElement>('[data-studio-flow]');
    const studioHintEl = this.shadow.querySelector<HTMLElement>('.studio-first-hint');
    const isPostRecording = state.phase === 'stopped' || state.phase === 'processing';
    if (studioFlowEl && studioHintEl) {
      if (isPostRecording) {
        studioHintEl.innerHTML =
          '<span class="studio-first-hint__caution" aria-hidden="true">★</span>' +
          '<span class="studio-first-hint__arrow" aria-hidden="true">→</span>' +
          '<strong>Phase 3</strong>';
        this.studioCtaBtn.textContent = 'Edit & Bake in Design Studio';
        studioFlowEl.setAttribute('aria-label', 'Phase 3 — return to Design Studio to edit subtitles and bake');
      } else if (this.workflowPhase === 'capture') {
        studioHintEl.innerHTML =
          '<span class="studio-first-hint__caution" aria-hidden="true">●</span>' +
          '<strong>Phase 2 — Ready to record</strong>';
        studioFlowEl.setAttribute('aria-label', 'Phase 2 — recording phase');
        // Keep CTA available in case user wants to go back
        this.studioCtaBtn.textContent = 'Open Design Studio';
      } else {
        studioHintEl.innerHTML =
          '<span class="studio-first-hint__caution" aria-hidden="true">⚠</span>' +
          '<span class="studio-first-hint__arrow" aria-hidden="true">→</span>' +
          '<strong>Go here first</strong>';
        this.studioCtaBtn.textContent = 'Open Design Studio';
        studioFlowEl.removeAttribute('aria-label');
      }
    }

    // 3-phase intro card: visible only in Phase 1 (design, pre-recording); auto-expands on first visit.
    const howItWorks = this.shadow.querySelector<HTMLDetailsElement>('[data-how-it-works]');
    if (howItWorks) {
      const showCard = !isPostRecording && this.workflowPhase === 'design';
      howItWorks.hidden = !showCard;
      if (showCard && !howItWorks.open) {
        try {
          if (!localStorage.getItem('rvn.wf.how-seen')) howItWorks.open = true;
        } catch { /* sandboxed env */ }
      }
    }

    switch (state.phase) {
      case 'idle':
        this.statusEl.textContent = 'Initializing microphone…';
        this.primaryBtn.textContent = 'Record';
        this.primaryBtn.disabled = true;
        this.secondaryBtn.textContent = 'Cancel';
        break;
      case 'ready':
        this.statusEl.textContent = 'Microphone ready — press Record when you are set.';
        this.primaryBtn.textContent = 'Record';
        this.primaryBtn.disabled = false;
        this.secondaryBtn.textContent = 'Cancel';
        this.panelEl.focus();
        break;
      case 'recording':
        if (state.criticalLimit) {
          this.statusEl.textContent = `${formatTime(DISPLAY_MAX_RECORDING_SECONDS - state.elapsedSeconds)} left — wrapping up soon.`;
          this.statusEl.classList.add('status--warning');
        } else if (state.nearLimit) {
          this.statusEl.textContent = `Almost at the ${formatRecordingCapProse()} limit.`;
          this.statusEl.classList.add('status--warning');
        } else {
          this.statusEl.textContent = 'Recording… speak clearly into your microphone.';
        }
        this.primaryBtn.textContent = 'Stop';
        this.primaryBtn.disabled = false;
        this.secondaryBtn.textContent = 'Discard';
        break;
      case 'processing':
        if (state.processingProgress <= 5) {
          this.statusEl.textContent = `Loading FFmpeg WASM… ${state.processingProgress}%`;
        } else {
          this.statusEl.textContent = `Converting to MP4… ${state.processingProgress}%`;
        }
        this.primaryBtn.textContent = 'Processing…';
        this.primaryBtn.disabled = true;
        this.secondaryBtn.textContent = 'Cancel';
        break;
      case 'stopped':
        if (state.subtitleStudioPending) {
          this.statusEl.textContent =
            'MP4 ready — open Design Studio to edit subtitles, bake, then attach. (Phase 3)';
        } else if (state.stoppedAtCap) {
          this.statusEl.textContent = `${formatRecordingCapProse()} limit reached — your MP4 is ready.`;
        } else {
          this.statusEl.textContent = 'MP4 ready — download or attach your clip.';
        }
        this.statusEl.classList.add('status--success');
        this.primaryBtn.textContent = 'Download MP4';
        this.primaryBtn.disabled = !state.mp4Blob;
        this.secondaryBtn.textContent = this.attaching ? 'Attaching…' : 'Attach to Reddit';
        this.secondaryBtn.disabled =
          this.attaching || !state.mp4Blob || !this.composer || !document.contains(this.composer);
        this.tertiaryBtn.textContent = 'Record again';
        if (this.lastNotifiedPhase !== 'stopped') {
          // Advance workflow phase to 'polish' so Design Studio banner updates.
          void setWorkflowPhase('polish');
          if (state.stoppedAtCap) {
            showToast(`${formatRecordingCapProse()} limit reached — processing complete.`, 'info', 5000);
          }
          if (state.voiceEffectFallback) {
            showToast(
              'Voice effect could not be applied — your clip used the original audio.',
              'info',
              6000,
            );
          }
          if (state.subtitleBurnInFallback) {
            showToast(
              'Subtitles could not be burned in — your clip exported without captions.',
              'info',
              6000,
            );
          }
        }
        break;
      case 'error':
        this.statusEl.textContent = state.errorMessage ?? 'Something went wrong.';
        this.statusEl.classList.add('status--error');
        // BUG FIX: recorder panel frozen on an invalidated extension context (fresh install / auto-update)
        // Fix: an orphaned content script can only recover via a page reload, so offer a one-click
        //   Refresh instead of a Retry that would just rethrow. Sync: onPrimaryClick() 'error' case.
        this.primaryBtn.textContent =
          state.errorCode === 'context-invalidated' ? 'Refresh page' : 'Retry';
        this.primaryBtn.disabled = false;
        this.secondaryBtn.textContent = 'Close';
        if (
          this.lastNotifiedPhase !== 'error' ||
          this.lastNotifiedError !== (state.errorMessage ?? '')
        ) {
          showToast(state.errorMessage ?? 'Recording failed.', 'error', 6000);
          this.lastNotifiedError = state.errorMessage ?? '';
        }
        break;
    }

    this.lastNotifiedPhase = state.phase;
  }
}

let activePanel: RecorderPanel | null = null;

export function openRecorderPanel(composer?: Element): void {
  activePanel?.close();
  activePanel = new RecorderPanel(composer ?? null);
  void activePanel.open();
}

export function closeRecorderPanel(): void {
  activePanel?.close();
  activePanel = null;
}