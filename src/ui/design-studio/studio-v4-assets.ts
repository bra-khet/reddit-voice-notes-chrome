/**
 * Design Studio v4 vector asset paths (public/assets/design-studio-v4/).
 * Resolve with studioV4AssetUrl() for border-image, <img>, and mask URLs.
 */

const BASE = 'assets/design-studio-v4';

export const STUDIO_V4_ASSETS = {
  panels: {
    panelFrame9Slice: `${BASE}/panels/panel-frame-9slice.svg`,
    previewWindowFrame: `${BASE}/panels/preview-window-frame.svg`,
    /** Mask-cutout predecessor — see panels/preview-window-frame.legacy.svg */
    previewWindowFrameLegacy: `${BASE}/panels/preview-window-frame.legacy.svg`,
    profileStatusFrame: `${BASE}/panels/profile-status-frame.svg`,
    statusPanelFrame: `${BASE}/panels/status-panel-frame.svg`,
    cardFooter9Slice: `${BASE}/panels/card-footer-9slice.svg`,
    subpanelHeader9Slice: `${BASE}/panels/subpanel-header-9slice.svg`,
    /** Experimental — not used in runtime; see panels/5-slice-usage.md */
    subpanelHeader5Slice: `${BASE}/panels/subpanel-header-5slice.svg`,
    subpanelHeader9SliceLegacy: `${BASE}/panels/subpanel-header-9slice.legacy.svg`,
    navChip9Slice: `${BASE}/panels/nav-chip-9slice.svg`,
    navChipNegate9Slice: `${BASE}/panels/nav-chip-negate-9slice.svg`,
    dialogFrame9Slice: `${BASE}/panels/dialog-frame-9slice.svg`,
    panelHeaderBar: `${BASE}/panels/panel-header-bar.svg`,
  },
  buttons: {
    frame9Slice: `${BASE}/buttons/button-frame-9slice.svg`,
    update: `${BASE}/buttons/button-update.svg`,
    clone: `${BASE}/buttons/button-clone.svg`,
    delete: `${BASE}/buttons/button-delete.svg`,
    done: `${BASE}/buttons/button-done.svg`,
    cancel: `${BASE}/buttons/button-cancel.svg`,
  },
  icons: {
    barStyle32: `${BASE}/icons/waveform-bars-32.svg`,
    background32: `${BASE}/icons/frame-icon-32.svg`,
    backgroundCenter32: `${BASE}/icons/center-frame-32.svg`,
    voice32: `${BASE}/icons/mic-wave-32.svg`,
    subtitles32: `${BASE}/icons/caption-lines-32.svg`,
    barStyle16: `${BASE}/icons/section-16/waveform-bars-16.svg`,
    background16: `${BASE}/icons/section-16/frame-icon-16.svg`,
    voice16: `${BASE}/icons/section-16/mic-wave-16.svg`,
    subtitles16: `${BASE}/icons/section-16/caption-lines-16.svg`,
    // Voice-panel QoL (v5.1.x): character lock guard + clipboard voice backup.
    padlockOpen16: `${BASE}/icons/section-16/padlock-open-16.svg`,
    padlockClosed16: `${BASE}/icons/section-16/padlock-closed-16.svg`,
    copy16: `${BASE}/icons/section-16/copy-16.svg`,
    paste16: `${BASE}/icons/section-16/paste-16.svg`,
    // Subtitle QoL (v5.3): per-cue delete — nav-chip body + chevron-X.
    cueDeleteX16: `${BASE}/icons/section-16/cue-delete-x-16.svg`,
    chevronEnter32: `${BASE}/icons/navigation/chevron-enter-32.svg`,
    chevronEnter16: `${BASE}/icons/navigation/chevron-enter-16.svg`,
    chevronBack32: `${BASE}/icons/navigation/chevron-back-32.svg`,
    chevronBack16: `${BASE}/icons/navigation/chevron-back-16.svg`,
    chevronUp16: `${BASE}/icons/navigation/chevron-up-16.svg`,
    chevronDown16: `${BASE}/icons/navigation/chevron-down-16.svg`,
    profile32: `${BASE}/icons/navigation/profile-silhouette-32.svg`,
    profile16: `${BASE}/icons/navigation/profile-silhouette-16.svg`,
  },
  status: {
    led: `${BASE}/status/status-indicator.svg`,
    pending: `${BASE}/status/pending-indicator.svg`,
    warning: `${BASE}/status/warning-indicator.svg`,
    complete: `${BASE}/status/complete-check.svg`,
    info: `${BASE}/status/info-indicator.svg`,
    failure: `${BASE}/status/failure-indicator.svg`,
  },
  knobs: {
    housing: `${BASE}/knobs/knob-housing.svg`,
    ticks: `${BASE}/knobs/knob-ticks-amber.svg`,
    needle: `${BASE}/knobs/knob-needle.svg`,
    decal: `${BASE}/knobs/knob-radial-speedometer-decal.svg`,
    volumeAssembly: `${BASE}/knobs/volume-knob.svg`,
    mini: `${BASE}/knobs/knob-mini.svg`,
  },
} as const;

/** Extension-origin URL for a v4 asset path. */
export function studioV4AssetUrl(relativePath: string): string {
  return browser.runtime.getURL(relativePath as never);
}

/** CSS border-image value for a 9-slice SVG (uniform slice on all sides). */
export function studioV4BorderImage(relativePath: string, slice: number): string {
  const url = studioV4AssetUrl(relativePath);
  return `url("${url}") ${slice} fill`;
}

/** Border corners/edges only — center discarded so HTML/CSS background shows through. */
export function studioV4BorderImageEdgesOnly(relativePath: string, slice: number): string {
  const url = studioV4AssetUrl(relativePath);
  return `url("${url}") ${slice}`;
}

/** CSS border-image with per-edge slice (5-slice horizontal bars, asymmetric frames). */
export function studioV4BorderImageSlices(
  relativePath: string,
  top: number,
  right: number,
  bottom: number,
  left: number,
): string {
  const url = studioV4AssetUrl(relativePath);
  return `url("${url}") ${top} ${right} ${bottom} ${left} fill`;
}
