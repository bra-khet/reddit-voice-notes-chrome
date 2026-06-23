/** Status-card face markup for v4 shell (summary only — body unchanged). */
export function renderStudioV4PanelSummary(title: string, summaryAttr: string): string {
  return `
    <summary class="studio__panel-summary">
      <div class="studio__panel-summary-face">
        <div class="studio__panel-summary-head">
          <img class="studio__panel-icon studio-v4__icon studio-v4__icon--32" alt="" width="32" height="32" />
          <span class="studio__panel-title">${title}</span>
        </div>
        <span class="studio__panel-meta" ${summaryAttr}></span>
        <div class="studio__panel-enter studio-v4__surface studio-v4__surface--card-footer">
          <span class="studio__panel-enter-chip studio-v4__nav-chip" aria-hidden="true">
            <img class="studio__panel-enter-icon studio-v4__icon studio-v4__icon--16" alt="" width="16" height="16" />
          </span>
        </div>
      </div>
    </summary>
  `;
}