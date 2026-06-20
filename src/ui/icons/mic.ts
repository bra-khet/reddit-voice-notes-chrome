/** Inline mic icon — source of truth: public/icon/mic.svg */
export const MIC_ICON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
  <line x1="12" y1="19" x2="12" y2="23"/>
  <line x1="8" y1="23" x2="16" y2="23"/>
</svg>`;

export function createMicIconElement(sizePx = 20): HTMLSpanElement {
  const icon = document.createElement('span');
  icon.className = 'rvn-mic-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = MIC_ICON_SVG;
  icon.style.display = 'inline-flex';
  icon.style.alignItems = 'center';
  icon.style.justifyContent = 'center';
  icon.style.width = `${sizePx}px`;
  icon.style.height = `${sizePx}px`;
  icon.style.flexShrink = '0';
  return icon;
}