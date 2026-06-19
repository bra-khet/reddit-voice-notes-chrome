/**
 * UPDATE WHEN REDDIT UI CHANGES
 * All Reddit-specific DOM selectors live in this file.
 * When Reddit ships a UI update, adjust these constants first.
 */

/** Root elements that indicate a comment composer is present. */
export const COMPOSER_ROOT_SELECTORS = [
  'shreddit-composer',
  '[data-testid="comment-composer"]',
  'faceplate-form[action*="comment"]',
  'div[contenteditable="true"][role="textbox"]',
] as const;

/**
 * aria-label patterns for Reddit's native video-upload button.
 * Tested against new Reddit (shreddit) comment toolbar — June 2026.
 */
export const VIDEO_BUTTON_ARIA_PATTERNS = [
  /^video$/i,
  /^add video$/i,
  /^upload video$/i,
  /^record video$/i,
  /video.*comment/i,
  /comment.*video/i,
] as const;

/** data-testid values Reddit has used for media toolbar buttons. */
export const VIDEO_BUTTON_TEST_IDS = [
  'comment-video-button',
  'video-upload-button',
  'composer-video-button',
] as const;

/** Toolbar containers that wrap media action buttons. */
export const TOOLBAR_SELECTORS = [
  '[data-testid="composer-toolbar"]',
  '[slot="toolbar"]',
  'div[class*="toolbar"]',
  'div[class*="action-bar"]',
  'div[class*="media-controls"]',
] as const;

export const VOICE_NOTE_BUTTON_ATTR = 'data-rvn-voice-note-btn';
export const INJECTED_COMPOSER_ATTR = 'data-rvn-composer-bound';