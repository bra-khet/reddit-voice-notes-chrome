import { createMicIconElement } from '@/src/ui/icons/mic';
import { VOICE_NOTE_BUTTON_ATTR } from './selectors';

const STYLE_ID = 'rvn-voice-note-button-styles';

const INLINE_BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '4px',
  minWidth: '32px',
  height: '32px',
  padding: '0 8px',
  margin: '0 2px',
  border: 'none',
  borderRadius: '999px',
  background: 'transparent',
  color: 'inherit',
  font: '600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  cursor: 'pointer',
  verticalAlign: 'middle',
};

function ensureButtonStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .rvn-voice-note-btn:hover { background: rgba(255, 255, 255, 0.08); }
    .rvn-voice-note-btn:focus-visible { outline: 2px solid #0079d3; outline-offset: 2px; }
    .rvn-voice-note-btn .rvn-mic-icon svg { display: block; }
    @media (prefers-color-scheme: light) {
      .rvn-voice-note-btn:hover { background: rgba(0, 0, 0, 0.06); }
    }
  `;
  document.head.appendChild(style);
}

function applyInlineStyles(button: HTMLButtonElement): void {
  Object.assign(button.style, INLINE_BUTTON_STYLE);
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
  applyInlineStyles(button);

  button.appendChild(createMicIconElement(18));

  if (options.showLabel !== false) {
    const label = document.createElement('span');
    label.textContent = 'Voice Note';
    label.style.whiteSpace = 'nowrap';
    button.appendChild(label);
  }

  button.addEventListener('click', options.onClick);
  return button;
}

export function removeVoiceNoteButton(button: HTMLButtonElement): void {
  button.remove();
}