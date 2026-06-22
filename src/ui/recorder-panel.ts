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
import { populateRecorderClipStyleSelect } from '@/src/ui/clip-style-select';
import { deriveChromeFromTheme } from '@/src/ui/theme-chrome';
import { RVN_COLORS } from '@/src/ui/tokens';
import { fetchBakedMp4FromExtension } from '@/src/storage/baked-mp4-fetch';
import { BAKED_MP4_READY_KEY } from '@/src/settings/user-preferences';
import { openDesignStudioWindow } from '@/src/ui/design-studio/open-design-studio';
import { showToast } from './toast';

const PANEL_HOST_ATTR = 'data-rvn-recorder-host';

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
          border-radius: 16px;
          background: ${RVN_COLORS.panelBg};
          color: ${RVN_COLORS.textPrimary};
          font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
          border: 1px solid var(--rvn-panel-border, ${RVN_COLORS.panelBorder});
          color-scheme: dark;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .title { font-weight: 600; font-size: 15px; margin: 0; }
        .close {
          border: none;
          background: transparent;
          color: ${RVN_COLORS.textMuted};
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 8px;
        }
        .close:hover { background: rgba(255,255,255,0.08); color: ${RVN_COLORS.textPrimary}; }
        .close:focus-visible { outline: 2px solid var(--rvn-focus, ${RVN_COLORS.redditBlue}); outline-offset: 2px; }
        .status {
          color: ${RVN_COLORS.textMuted};
          font-size: 12px;
          margin: 0 0 8px;
          min-height: 1.4em;
        }
        .status--error { color: ${RVN_COLORS.error}; }
        .status--success { color: ${RVN_COLORS.success}; }
        .status--warning { color: ${RVN_COLORS.warning}; }
        .status-studio {
          margin: 0 0 10px;
        }
        .status-studio[hidden] { display: none !important; }
        .studio-cta {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 6px;
          padding: 6px 12px;
          border: 1px solid var(--rvn-accent, ${RVN_COLORS.redditBlue});
          border-radius: 999px;
          background: transparent;
          color: var(--rvn-accent, ${RVN_COLORS.redditBlue});
          font: inherit;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .studio-cta:hover {
          background: rgba(255, 255, 255, 0.06);
        }
        .studio-cta:focus-visible {
          outline: 2px solid var(--rvn-focus, ${RVN_COLORS.redditBlue});
          outline-offset: 2px;
        }
        .timer-wrap { margin: 0 0 8px; }
        .timer {
          font-variant-numeric: tabular-nums;
          font-size: 24px;
          font-weight: 700;
          margin: 0;
        }
        .timer--warning { color: ${RVN_COLORS.warning}; }
        .timer--critical { color: ${RVN_COLORS.error}; }
        .timer__cap { font-size: 12px; font-weight: 500; color: ${RVN_COLORS.textMuted}; margin-left: 8px; }
        .time-progress {
          height: 3px;
          border-radius: 2px;
          background: ${RVN_COLORS.panelBorder};
          margin-bottom: 12px;
          overflow: hidden;
        }
        .time-progress__bar {
          height: 100%;
          width: 0%;
          background: var(--rvn-accent, ${RVN_COLORS.redditBlue});
          transition: width 0.25s linear, background 0.2s ease;
        }
        .time-progress__bar--warning { background: ${RVN_COLORS.warning}; }
        .time-progress__bar--critical { background: ${RVN_COLORS.error}; }
        .waveform {
          width: 100%;
          aspect-ratio: 16 / 9;
          border-radius: 10px;
          overflow: hidden;
          background: ${RVN_COLORS.surfaceDark};
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
          font-size: 12px;
          color: ${RVN_COLORS.textMuted};
          white-space: nowrap;
        }
        .theme-row__select {
          flex: 1;
          border: 1px solid ${RVN_COLORS.panelBorder};
          border-radius: 8px;
          background: ${RVN_COLORS.surfaceRaised};
          color: ${RVN_COLORS.textPrimary};
          font: inherit;
          font-size: 12px;
          padding: 6px 8px;
          cursor: pointer;
        }
        .theme-row__select:focus-visible {
          outline: 2px solid var(--rvn-focus, ${RVN_COLORS.redditBlue});
          outline-offset: 2px;
        }
        .theme-row__select:disabled { opacity: 0.55; cursor: not-allowed; }
        .progress {
          height: 4px;
          border-radius: 2px;
          background: ${RVN_COLORS.panelBorder};
          margin-bottom: 12px;
          overflow: hidden;
        }
        .progress__bar {
          height: 100%;
          width: 0%;
          background: var(--rvn-accent, ${RVN_COLORS.redditBlue});
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
        .action--secondary { background: ${RVN_COLORS.surfaceRaised}; color: ${RVN_COLORS.textPrimary}; }
        .action--secondary:hover { background: ${RVN_COLORS.panelBorder}; }
        .action:focus-visible { outline: 2px solid var(--rvn-focus, ${RVN_COLORS.redditBlue}); outline-offset: 2px; }
        .action:disabled { opacity: 0.5; cursor: not-allowed; }
        .tertiary {
          display: block;
          width: 100%;
          margin-top: 8px;
          border: none;
          background: transparent;
          color: ${RVN_COLORS.textMuted};
          font: inherit;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          padding: 6px 4px;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .tertiary:hover { color: ${RVN_COLORS.textPrimary}; }
        .tertiary:focus-visible { outline: 2px solid var(--rvn-focus, ${RVN_COLORS.redditBlue}); outline-offset: 2px; border-radius: 4px; }
        @media (prefers-color-scheme: light) {
          .panel {
            background: #ffffff;
            color: #1a1a1b;
            border-color: #edeff1;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
            color-scheme: light;
          }
          .close { color: #576f76; }
          .close:hover { background: rgba(0,0,0,0.06); color: #1a1a1b; }
          .status { color: #576f76; }
          .timer__cap { color: #576f76; }
          .time-progress { background: #edeff1; }
          .waveform { background: #f6f7f8; }
          .theme-row__select {
            background: #f6f7f8;
            color: #1a1a1b;
            border-color: #edeff1;
          }
          .progress { background: #edeff1; }
          .action--secondary { background: #f6f7f8; color: #1a1a1b; }
          .action--secondary:hover { background: #edeff1; }
          .tertiary { color: #576f76; }
          .tertiary:hover { color: #1a1a1b; }
        }
      </style>
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="rvn-title" tabindex="-1">
        <div class="header">
          <h2 class="title" id="rvn-title">Voice Note</h2>
          <button class="close" type="button" aria-label="Close recorder">×</button>
        </div>
        <div class="status-studio" data-status-studio>
          <p class="status" data-status role="status" aria-live="polite">Initializing microphone…</p>
          <button type="button" class="studio-cta" data-open-design-studio hidden>
            Open Design Studio
          </button>
        </div>
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

    this.session?.dispose();
    this.unsubscribe?.();
    this.session = new VoiceRecorderSession();
    this.unsubscribe = this.session.subscribe((state) => {
      this.currentState = state;
      this.render(state);
    });

    this.themeUnsubscribe?.();
    this.themeUnsubscribe = onUserPreferencesChanged((prefs) => {
      this.syncClipStyleSelect(prefs);
      this.applyThemeChrome(prefs.appearance);
    });

    this.bakedMp4Listener = (changes, area) => {
      if (area !== 'local' || !(BAKED_MP4_READY_KEY in changes)) return;
      void this.tryApplyBakedMp4();
    };
    browser.storage.onChanged.addListener(this.bakedMp4Listener);

    try {
      const prefs = await loadUserPreferences();
      this.syncClipStyleSelect(prefs);
      this.applyThemeChrome(prefs.appearance);
      await this.session.prepare();
      this.panelEl.focus();
      void this.tryApplyBakedMp4();
    } catch {
      // Error state rendered via subscription.
      this.panelEl.focus();
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
    if (this.bakedMp4Listener) {
      browser.storage.onChanged.removeListener(this.bakedMp4Listener);
      this.bakedMp4Listener = null;
    }
    this.themeUnsubscribe?.();
    this.themeUnsubscribe = null;
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
        void this.open();
        break;
    }
  }

  private onSecondaryClick(): void {
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
    this.studioCtaBtn.hidden = true;

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
            'MP4 ready — open Design Studio to edit subtitles, bake, then attach.';
          this.studioCtaBtn.hidden = false;
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
        this.primaryBtn.textContent = 'Retry';
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