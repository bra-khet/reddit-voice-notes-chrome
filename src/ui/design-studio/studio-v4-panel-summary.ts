/** Status-card face — tap opens sub-panel (not inline details). */
export function renderStudioV4PanelCard(title: string, summaryAttr: string, panelId: string): string {
  return `
    <button type="button" class="studio__panel-card" data-studio-panel-open="${panelId}" aria-label="Open ${title}">
      <span class="studio__panel-summary-face">
        <span class="studio__panel-summary-head">
          <img class="studio__panel-icon studio-v4__icon studio-v4__icon--32" alt="" width="32" height="32" />
          <span class="studio__panel-title">${title}</span>
        </span>
        <span class="studio__panel-meta" ${summaryAttr}></span>
        <span class="studio__panel-enter studio-v4__surface studio-v4__surface--card-footer" aria-hidden="true">
          <span class="studio__panel-enter-chip studio-v4__nav-chip">
            <img class="studio__panel-enter-icon studio-v4__icon studio-v4__icon--16" alt="" width="16" height="16" />
          </span>
        </span>
      </span>
    </button>
  `;
}