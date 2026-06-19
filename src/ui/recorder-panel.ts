import { MAX_RECORDING_SECONDS } from '@/src/utils/constants';
import { VoiceRecorderSession, type RecorderState } from '@/src/recorder/voice-recorder';

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
  private currentState: RecorderState = { phase: 'idle', elapsedSeconds: 0 };

  private statusEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private waveformSlot!: HTMLElement;
  private primaryBtn!: HTMLButtonElement;
  private secondaryBtn!: HTMLButtonElement;
  private closeBtn!: HTMLButtonElement;

  constructor() {
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
          background: #1a1a1b;
          color: #d7dadc;
          font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
          border: 1px solid #343536;
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
          color: #818384;
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 8px;
        }
        .close:hover { background: rgba(255,255,255,0.08); color: #d7dadc; }
        .status { color: #818384; font-size: 12px; margin: 0 0 8px; }
        .timer {
          font-variant-numeric: tabular-nums;
          font-size: 24px;
          font-weight: 700;
          margin: 0 0 12px;
        }
        .timer__cap { font-size: 12px; font-weight: 500; color: #818384; margin-left: 8px; }
        .waveform {
          width: 100%;
          aspect-ratio: 16 / 9;
          border-radius: 10px;
          overflow: hidden;
          background: #0f1115;
          margin-bottom: 12px;
        }
        .waveform canvas { width: 100%; height: 100%; display: block; }
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
        .action--primary { background: #d93900; color: #fff; }
        .action--primary:hover { background: #ff4500; }
        .action--secondary { background: #272729; color: #d7dadc; }
        .action--secondary:hover { background: #343536; }
        .action:disabled { opacity: 0.5; cursor: not-allowed; }
      </style>
      <div class="panel" role="dialog" aria-label="Voice note recorder">
        <div class="header">
          <h2 class="title">Voice Note</h2>
          <button class="close" type="button" aria-label="Close recorder">×</button>
        </div>
        <p class="status" data-status>Initializing microphone…</p>
        <p class="timer" data-timer>0:00<span class="timer__cap">/ 3:00 max</span></p>
        <div class="waveform" data-waveform></div>
        <div class="actions">
          <button class="action action--primary" type="button" data-primary disabled>Record</button>
          <button class="action action--secondary" type="button" data-secondary hidden>Cancel</button>
        </div>
      </div>
    `;

    this.statusEl = this.shadow.querySelector('[data-status]')!;
    this.timerEl = this.shadow.querySelector('[data-timer]')!;
    this.waveformSlot = this.shadow.querySelector('[data-waveform]')!;
    this.primaryBtn = this.shadow.querySelector('[data-primary]')!;
    this.secondaryBtn = this.shadow.querySelector('[data-secondary]')!;
    this.closeBtn = this.shadow.querySelector('.close')!;

    this.primaryBtn.addEventListener('click', () => this.onPrimaryClick());
    this.secondaryBtn.addEventListener('click', () => this.onSecondaryClick());
    this.closeBtn.addEventListener('click', () => this.close());
  }

  async open(): Promise<void> {
    if (!document.body.contains(this.host)) {
      document.body.appendChild(this.host);
    }

    this.session?.dispose();
    this.unsubscribe?.();
    this.session = new VoiceRecorderSession();
    this.unsubscribe = this.session.subscribe((state) => {
      this.currentState = state;
      this.render(state);
    });

    try {
      await this.session.prepare();
    } catch {
      // Error state rendered via subscription.
    }
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();
    this.session = null;
    this.host.remove();
  }

  private onPrimaryClick(): void {
    if (!this.session) return;

    switch (this.currentState.phase) {
      case 'ready':
        this.session.startRecording();
        break;
      case 'recording':
        this.session.stopRecording();
        break;
      case 'stopped':
        this.session.downloadRecording();
        break;
      case 'error':
        void this.open();
        break;
    }
  }

  private onSecondaryClick(): void {
    if (!this.session) return;

    if (this.currentState.phase === 'recording') {
      this.session.cancel();
      this.close();
      return;
    }

    if (this.currentState.phase === 'stopped') {
      void this.session.resetForNewRecording();
    }
  }

  private render(state: RecorderState): void {
    this.timerEl.innerHTML = `${formatTime(state.elapsedSeconds)}<span class="timer__cap">/ ${formatTime(MAX_RECORDING_SECONDS)} max</span>`;

    const canvas = this.session?.previewCanvas;
    if (canvas && !this.waveformSlot.contains(canvas)) {
      this.waveformSlot.replaceChildren(canvas);
    }

    this.secondaryBtn.hidden = state.phase !== 'recording' && state.phase !== 'stopped';

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
        break;
      case 'recording':
        this.statusEl.textContent = 'Recording…';
        this.primaryBtn.textContent = 'Stop';
        this.primaryBtn.disabled = false;
        this.secondaryBtn.textContent = 'Cancel';
        break;
      case 'stopped':
        this.statusEl.textContent = 'Recording saved locally as WebM. Download now (MP4 in Phase 3).';
        this.primaryBtn.textContent = 'Download WebM';
        this.primaryBtn.disabled = !state.blob;
        this.secondaryBtn.textContent = 'Record again';
        break;
      case 'error':
        this.statusEl.textContent = state.errorMessage ?? 'Microphone unavailable.';
        this.primaryBtn.textContent = 'Retry';
        this.primaryBtn.disabled = false;
        this.secondaryBtn.textContent = 'Cancel';
        break;
    }
  }
}

let activePanel: RecorderPanel | null = null;

export function openRecorderPanel(): void {
  activePanel?.close();
  activePanel = new RecorderPanel();
  void activePanel.open();
}

export function closeRecorderPanel(): void {
  activePanel?.close();
  activePanel = null;
}