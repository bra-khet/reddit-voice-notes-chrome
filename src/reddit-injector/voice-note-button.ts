import { VOICE_NOTE_BUTTON_ATTR } from './selectors';

const STYLE_ID = 'rvn-voice-note-button-styles';

function ensureButtonStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .rvn-voice-note-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-width: 32px;
      height: 32px;
      padding: 0 8px;
      margin: 0 2px;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      cursor: pointer;
      vertical-align: middle;
      transition: background-color 0.15s ease;
    }
    .rvn-voice-note-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .rvn-voice-note-btn:focus-visible {
      outline: 2px solid #0079d3;
      outline-offset: 2px;
    }
    .rvn-voice-note-btn__icon {
      font-size: 16px;
      line-height: 1;
    }
    .rvn-voice-note-btn__label {
      white-space: nowrap;
    }
    @media (prefers-color-scheme: light) {
      .rvn-voice-note-btn:hover {
        background: rgba(0, 0, 0, 0.06);
      }
    }
  `;
  document.head.appendChild(style);
}

export interface VoiceNoteButtonOptions {
  onClick: (event: MouseEvent) => void;
  showLabel?: boolean;
}

export function createVoiceNoteButton(options: VoiceNoteButtonOptions): HTMLButtonElement {
  ensureButtonStyles();

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rvn-voice-note-btn';
  button.setAttribute(VOICE_NOTE_BUTTON_ATTR, 'true');
  button.setAttribute('aria-label', 'Record voice note');
  button.title = 'Record voice note (max 3:00)';

  const icon = document.createElement('span');
  icon.className = 'rvn-voice-note-btn__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🎤';
  button.appendChild(icon);

  if (options.showLabel !== false) {
    const label = document.createElement('span');
    label.className = 'rvn-voice-note-btn__label';
    label.textContent = 'Voice Note';
    button.appendChild(label);
  }

  button.addEventListener('click', options.onClick);
  return button;
}

export function removeVoiceNoteButton(button: HTMLButtonElement): void {
  button.remove();
}