/**
 * UPDATE WHEN REDDIT UI CHANGES
 * All Reddit-specific DOM selectors live in this file.
 */

/** Root elements that indicate a comment composer is present. */
export const COMPOSER_ROOT_SELECTORS = [
  'shreddit-composer',
  'shreddit-comment-composer',
  'comment-composer-host',
  '#comment-composer',
  '[data-testid="comment-composer"]',
  'faceplate-form[action*="comment"]',
] as const;

/**
 * aria-label substrings for Reddit's native video-upload button.
 * UPDATE WHEN REDDIT UI CHANGES
 */
export const VIDEO_BUTTON_ARIA_HINTS = [
  'video',
  'record',
  'upload a video',
  'add a video',
] as const;

/** data-testid substrings for video/media upload buttons. */
export const VIDEO_BUTTON_TEST_ID_HINTS = [
  'video',
  'media-upload',
] as const;

/** Custom element / tag hints for media toolbar controls. */
export const VIDEO_BUTTON_TAG_HINTS = [
  'shreddit-video',
  'shreddit-media',
  'faceplate-media',
] as const;

/** Icon name attributes Reddit uses on toolbar glyphs. */
export const VIDEO_ICON_NAME_HINTS = [
  'video',
  'videocam',
  'play',
  'media-video',
] as const;

/** Toolbar containers that wrap media action buttons. */
export const TOOLBAR_SELECTORS = [
  '[data-testid="composer-toolbar"]',
  '[slot="toolbar"]',
  '[slot="submit-row"]',
  'div[class*="toolbar"]',
  'div[class*="action-bar"]',
  'div[class*="media-controls"]',
  'div[class*="composer__footer"]',
] as const;

/** Selectors for non-video media buttons used as injection fallback anchors. */
export const MEDIA_TOOLBAR_BUTTON_SELECTORS = [
  'button[aria-label*="image" i]',
  'button[aria-label*="gif" i]',
  'button[aria-label*="photo" i]',
  'button[aria-label*="media" i]',
  '[data-testid*="image" i]',
] as const;

/** File inputs Reddit may use for video comments. UPDATE WHEN REDDIT UI CHANGES */
export const FILE_INPUT_SELECTORS = [
  'input[type="file"][accept*="video" i]',
  'input[type="file"][accept*="mp4" i]',
  'input[type="file"][accept*="mov" i]',
  'input[type="file"]',
] as const;

/** Drop targets for media uploads. UPDATE WHEN REDDIT UI CHANGES */
export const DROPZONE_SELECTORS = [
  '[data-testid*="drop" i]',
  '[data-testid*="upload" i]',
  '[class*="dropzone" i]',
  '[class*="drop-zone" i]',
  '[aria-label*="drop" i]',
] as const;

export const VOICE_NOTE_BUTTON_ATTR = 'data-rvn-voice-note-btn';
export const INJECTED_COMPOSER_ATTR = 'data-rvn-composer-bound';