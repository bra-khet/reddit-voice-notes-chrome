import {
  COMPOSER_ROOT_SELECTORS,
  TOOLBAR_SELECTORS,
  VIDEO_BUTTON_ARIA_PATTERNS,
  VIDEO_BUTTON_TEST_IDS,
  INJECTED_COMPOSER_ATTR,
  VOICE_NOTE_BUTTON_ATTR,
} from './selectors';

export interface ComposerInjectionTarget {
  composer: Element;
  anchor: HTMLElement;
  videoButton: HTMLElement | null;
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
}

function matchesAriaLabel(button: Element): boolean {
  const label = button.getAttribute('aria-label') ?? button.getAttribute('title') ?? '';
  return VIDEO_BUTTON_ARIA_PATTERNS.some((pattern) => pattern.test(label.trim()));
}

function matchesTestId(button: Element): boolean {
  const testId = button.getAttribute('data-testid');
  return testId != null && VIDEO_BUTTON_TEST_IDS.includes(testId as (typeof VIDEO_BUTTON_TEST_IDS)[number]);
}

/**
 * UPDATE WHEN REDDIT UI CHANGES
 * Locate Reddit's video upload button within a composer subtree.
 */
export function findVideoButton(root: Element): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>(
    'button, [role="button"], faceplate-button, shreddit-button',
  );

  for (const candidate of candidates) {
    if (!isVisible(candidate)) continue;
    if (matchesAriaLabel(candidate) || matchesTestId(candidate)) {
      return candidate;
    }
  }

  return null;
}

function findComposerRoot(element: Element): Element | null {
  for (const selector of COMPOSER_ROOT_SELECTORS) {
    const match = element.closest(selector);
    if (match) return match;
  }
  return null;
}

function findToolbar(composer: Element): Element | null {
  for (const selector of TOOLBAR_SELECTORS) {
    const toolbar = composer.querySelector(selector);
    if (toolbar && isVisible(toolbar)) return toolbar;
  }
  return null;
}

/**
 * UPDATE WHEN REDDIT UI CHANGES
 * Resolve a composer + anchor point for voice-note button injection.
 * Returns null when video comments appear disabled (no video button found).
 */
export function findInjectionTarget(element: Element): ComposerInjectionTarget | null {
  const composer = findComposerRoot(element);
  if (!composer || !isVisible(composer)) return null;

  if (composer.querySelector(`[${VOICE_NOTE_BUTTON_ATTR}]`)) return null;

  const videoButton = findVideoButton(composer);
  if (!videoButton) return null;

  const toolbar = findToolbar(composer);
  const anchor = videoButton.parentElement ?? (toolbar as HTMLElement | null) ?? (composer as HTMLElement);

  return { composer, anchor, videoButton };
}

export function findAllInjectionTargets(root: ParentNode = document): ComposerInjectionTarget[] {
  const targets: ComposerInjectionTarget[] = [];
  const seenComposers = new Set<Element>();

  const scanRoots: Element[] = [];
  for (const selector of COMPOSER_ROOT_SELECTORS) {
    root.querySelectorAll(selector).forEach((el) => scanRoots.push(el));
  }

  if (scanRoots.length === 0) {
    document.querySelectorAll('[contenteditable="true"][role="textbox"]').forEach((el) => {
      scanRoots.push(el);
    });
  }

  for (const scanRoot of scanRoots) {
    const composer = findComposerRoot(scanRoot) ?? scanRoot;
    if (seenComposers.has(composer)) continue;

    // Reddit SPA re-renders may remove our button while keeping the composer node.
    if (composer.hasAttribute(INJECTED_COMPOSER_ATTR) && composer.querySelector(`[${VOICE_NOTE_BUTTON_ATTR}]`)) {
      continue;
    }

    const target = findInjectionTarget(composer);
    if (target) {
      seenComposers.add(composer);
      targets.push(target);
    }
  }

  return targets;
}

export function markComposerInjected(composer: Element): void {
  composer.setAttribute(INJECTED_COMPOSER_ATTR, 'true');
}

export function unmarkComposerInjected(composer: Element): void {
  composer.removeAttribute(INJECTED_COMPOSER_ATTR);
}