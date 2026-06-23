import {
  STUDIO_V4_ASSETS,
  studioV4AssetUrl,
  studioV4BorderImage,
} from '@/src/ui/design-studio/studio-v4-assets';

const PANEL_ICON_BY_ID: Record<string, string> = {
  'bar-style': STUDIO_V4_ASSETS.icons.barStyle32,
  background: STUDIO_V4_ASSETS.icons.background32,
  voice: STUDIO_V4_ASSETS.icons.voice32,
  subtitles: STUDIO_V4_ASSETS.icons.subtitles32,
};

/** Set CSS custom properties on `.studio-v4` for 9-slice frames and fixed chrome SVGs. */
export function applyStudioV4ShellChrome(root: HTMLElement): void {
  const panels = STUDIO_V4_ASSETS.panels;
  const icons = STUDIO_V4_ASSETS.icons;

  const setImageUrl = (name: string, relativePath: string): void => {
    root.style.setProperty(name, `url("${studioV4AssetUrl(relativePath)}")`);
  };

  root.style.setProperty(
    '--studio-v4-border-panel',
    studioV4BorderImage(panels.panelFrame9Slice, 10),
  );
  root.style.setProperty(
    '--studio-v4-border-nav-chip',
    studioV4BorderImage(panels.navChip9Slice, 10),
  );
  root.style.setProperty(
    '--studio-v4-border-nav-chip-negate',
    studioV4BorderImage(panels.navChipNegate9Slice, 10),
  );
  root.style.setProperty(
    '--studio-v4-border-card-footer',
    `url("${studioV4AssetUrl(panels.cardFooter9Slice)}") 6 10 6 10 fill`,
  );
  root.style.setProperty(
    '--studio-v4-border-dialog',
    studioV4BorderImage(panels.dialogFrame9Slice, 10),
  );
  root.style.setProperty(
    '--studio-v4-border-subpanel-header',
    `url("${studioV4AssetUrl(panels.subpanelHeader9Slice)}") 10 14 10 14 fill`,
  );
  root.style.setProperty(
    '--studio-v4-border-bake-btn',
    studioV4BorderImage(STUDIO_V4_ASSETS.buttons.frame9Slice, 10),
  );

  setImageUrl('--studio-v4-preview-frame', panels.previewWindowFrame);
  setImageUrl('--studio-v4-profile-frame', panels.profileStatusFrame);
  setImageUrl('--studio-v4-icon-chevron-enter', icons.chevronEnter16);
  setImageUrl('--studio-v4-icon-profile', icons.profile32);

  for (const panel of root.querySelectorAll<HTMLElement>('[data-studio-panel]')) {
    const panelId = panel.getAttribute('data-studio-panel');
    const iconPath = panelId ? PANEL_ICON_BY_ID[panelId] : undefined;
    const img = panel.querySelector<HTMLImageElement>('.studio__panel-icon');
    if (iconPath && img) {
      img.src = studioV4AssetUrl(iconPath);
    }
  }

  for (const img of root.querySelectorAll<HTMLImageElement>('.studio__panel-enter-icon')) {
    img.src = studioV4AssetUrl(icons.chevronEnter16);
  }

  const profileIcon = root.querySelector<HTMLImageElement>('.studio__profile-cluster-icon');
  if (profileIcon) {
    profileIcon.src = studioV4AssetUrl(icons.profile32);
  }
}