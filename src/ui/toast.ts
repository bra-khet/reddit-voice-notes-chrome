import { RVN_COLORS } from '@/src/ui/tokens';

const TOAST_HOST_ATTR = 'data-rvn-toast-host';
const TOAST_STYLE_ID = 'rvn-toast-styles';

function ensureToastStyles(): void {
  if (document.getElementById(TOAST_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = TOAST_STYLE_ID;
  style.textContent = `
    .rvn-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483646;
      max-width: 320px;
      padding: 12px 16px;
      border-radius: 8px;
      background: ${RVN_COLORS.panelBg};
      color: ${RVN_COLORS.textPrimary};
      font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      border: 1px solid ${RVN_COLORS.panelBorder};
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.2s ease, transform 0.2s ease;
      pointer-events: none;
      color-scheme: dark;
    }
    .rvn-toast--visible {
      opacity: 1;
      transform: translateY(0);
    }
    .rvn-toast--error {
      border-left: 3px solid ${RVN_COLORS.error};
    }
    .rvn-toast--info {
      border-left: 3px solid ${RVN_COLORS.redditBlue};
    }
    @media (prefers-color-scheme: light) {
      .rvn-toast {
        background: #ffffff;
        color: #1a1a1b;
        border-color: #edeff1;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        color-scheme: light;
      }
    }
  `;
  document.head.appendChild(style);
}

function getToastHost(): HTMLElement {
  let host = document.querySelector<HTMLElement>(`[${TOAST_HOST_ATTR}]`);
  if (!host) {
    host = document.createElement('div');
    host.setAttribute(TOAST_HOST_ATTR, 'true');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}

let hideTimer: ReturnType<typeof setTimeout> | undefined;
let lastToastMessage = '';

export function showToast(message: string, variant: 'info' | 'error' = 'info', durationMs = 4000): void {
  if (message === lastToastMessage) return;
  lastToastMessage = message;

  ensureToastStyles();
  const host = getToastHost();

  let toast = host.querySelector<HTMLElement>('.rvn-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'rvn-toast';
    toast.setAttribute('role', 'status');
    host.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = `rvn-toast rvn-toast--${variant}`;

  requestAnimationFrame(() => {
    toast!.classList.add('rvn-toast--visible');
  });

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    toast?.classList.remove('rvn-toast--visible');
    lastToastMessage = '';
  }, durationMs);
}