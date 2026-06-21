const DESIGN_STUDIO_PATH = 'design-studio.html' as const;
const STUDIO_WIDTH = 440;
const STUDIO_HEIGHT = 760;

export function openDesignStudioWindow(): void {
  const url = browser.runtime.getURL(DESIGN_STUDIO_PATH as never);
  void browser.windows.create({
    url,
    type: 'popup',
    width: STUDIO_WIDTH,
    height: STUDIO_HEIGHT,
    focused: true,
  });
}