/** Shared popup settings row builders (pretty-2 shell). */

export interface SettingsToggleOptions {
  id: string;
  label: string;
  description?: string;
  /** Extra detail shown on the ? help affordance (pretty-3). */
  helpTip?: string;
  checked: boolean;
  disabled?: boolean;
  comingSoon?: boolean;
}

export interface SettingsInfoOptions {
  label: string;
  value: string;
  description?: string;
  valueId?: string;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderSettingsSection(title: string, titleId: string, bodyHtml: string): string {
  return `
    <section class="popup__section" aria-labelledby="${titleId}">
      <h2 class="popup__section-title" id="${titleId}">${escapeHtml(title)}</h2>
      ${bodyHtml}
    </section>
  `;
}

export function renderInfoRow({ label, value, description, valueId }: SettingsInfoOptions): string {
  const desc = description
    ? `<p class="popup__field-desc">${escapeHtml(description)}</p>`
    : '';
  const idAttr = valueId ? ` id="${escapeHtml(valueId)}"` : '';
  return `
    <div class="popup__info-row">
      <div class="popup__info-copy">
        <span class="popup__info-label">${escapeHtml(label)}</span>
        ${desc}
      </div>
      <span class="popup__info-value"${idAttr} aria-label="${escapeHtml(label)}">${escapeHtml(value)}</span>
    </div>
  `;
}

function renderHelpTip(id: string, helpTip: string): string {
  const tipId = `${id}-help`;
  return `
    <button
      type="button"
      class="popup__help-tip"
      id="${tipId}"
      aria-label="${escapeHtml(helpTip)}"
      title="${escapeHtml(helpTip)}"
    >?</button>
  `;
}

export function renderToggleRow({
  id,
  label,
  description,
  helpTip,
  checked,
  disabled = false,
  comingSoon = false,
}: SettingsToggleOptions): string {
  const rowClass = disabled ? 'popup__toggle-row popup__toggle-row--disabled' : 'popup__toggle-row';
  const badge = comingSoon
    ? '<span class="popup__badge" aria-hidden="true">Coming soon</span>'
    : '';
  const help = helpTip ? renderHelpTip(id, helpTip) : '';
  const desc = description
    ? `<p class="popup__field-desc" id="${id}-desc">${escapeHtml(description)}</p>`
    : '';
  const describedByParts = [description ? `${id}-desc` : '', helpTip ? `${id}-help` : ''].filter(Boolean);
  const ariaDescribedBy = describedByParts.length
    ? ` aria-describedby="${describedByParts.join(' ')}"`
    : '';

  return `
    <div class="${rowClass}">
      <div class="popup__toggle-copy">
        <div class="popup__toggle-heading">
          <label class="popup__toggle-label" for="${id}">${escapeHtml(label)}</label>
          ${help}
          ${badge}
        </div>
        ${desc}
      </div>
      <input
        type="checkbox"
        class="popup__toggle-input"
        id="${id}"
        role="switch"
        ${checked ? 'checked' : ''}
        ${disabled ? 'disabled' : ''}
        ${ariaDescribedBy}
      />
    </div>
  `;
}

export function bindToggle(
  root: ParentNode,
  id: string,
  onChange: (checked: boolean) => void,
): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`)!;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}