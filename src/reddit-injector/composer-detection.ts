import { EXTENSION_LOG_PREFIX } from '@/src/utils';
import { deepQueryAll, deepQuerySelector, walkDeepElements } from '@/src/utils/shadow-dom';
import {
  COMPOSER_ROOT_SELECTORS,
  TOOLBAR_SELECTORS,
  VIDEO_BUTTON_ARIA_HINTS,
  VIDEO_BUTTON_TEST_ID_HINTS,
  VIDEO_BUTTON_TAG_HINTS,
  VIDEO_ICON_NAME_HINTS,
  MEDIA_TOOLBAR_BUTTON_SELECTORS,
  INJECTED_COMPOSER_ATTR,
  VOICE_NOTE_BUTTON_ATTR,
} from './selectors';

export interface ComposerInjectionTarget {
  composer: Element;
  anchor: HTMLElement;
  videoButton: HTMLElement | null;
}

export interface ScanDiagnostics {
  composerCandidates: number;
  visibleComposers: number;
  withVideoButton: number;
  withMediaFallback: number;
  alreadyInjected: number;
}

const BUTTON_SELECTOR =
  'button, [role="button"], faceplate-button, shreddit-button, rpl-button, faceplate-tracker';

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function elementTextHints(element: Element): string {
  const parts = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('data-testid'),
    element.getAttribute('icon-name'),
    element.getAttribute('name'),
    element.tagName,
  ];
  return normalize(parts.filter(Boolean).join(' '));
}

function hasVideoIconDescendant(element: Element): boolean {
  let matched = false;
  walkDeepElements(element, (node) => {
    if (matched) return;
    const iconName = normalize(
      [
        node.getAttribute('icon-name'),
        node.getAttribute('name'),
        node.getAttribute('data-icon'),
        node.getAttribute('aria-label'),
      ]
        .filter(Boolean)
        .join(' '),
    );
    if (VIDEO_ICON_NAME_HINTS.some((hint) => iconName.includes(hint))) {
      matched = true;
    }
  });
  return matched;
}

function scoreVideoButton(candidate: Element): number {
  const hints = elementTextHints(candidate);
  let score = 0;

  if (VIDEO_BUTTON_ARIA_HINTS.some((hint) => hints.includes(hint))) score += 10;
  if (VIDEO_BUTTON_TEST_ID_HINTS.some((hint) => hints.includes(hint))) score += 8;
  if (VIDEO_BUTTON_TAG_HINTS.some((hint) => hints.includes(hint))) score += 6;
  if (hasVideoIconDescendant(candidate)) score += 5;

  return score;
}

function isButtonLike(element: Element): boolean {
  return (
    element.matches(BUTTON_SELECTOR) ||
    element.getAttribute('role') === 'button' ||
    element.tagName.toLowerCase().includes('button')
  );
}

/**
 * UPDATE WHEN REDDIT UI CHANGES
 * Locate Reddit's video upload button within a composer subtree (includes Shadow DOM).
 */
export function findVideoButton(root: Element): HTMLElement | null {
  const candidates: Array<{ el: HTMLElement; score: number }> = [];

  walkDeepElements(root, (element) => {
    if (!isButtonLike(element) || !isVisible(element)) return;
    const score = scoreVideoButton(element);
    if (score > 0) {
      candidates.push({ el: element as HTMLElement, score });
    }
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.el ?? null;
}

/**
 * Fallback when video button label differs: anchor after last image/gif/media toolbar button.
 */
function findMediaToolbarAnchor(root: Element): HTMLElement | null {
  const anchors: HTMLElement[] = [];

  for (const selector of MEDIA_TOOLBAR_BUTTON_SELECTORS) {
    for (const match of deepQueryAll(root, selector)) {
      if (isButtonLike(match) && isVisible(match)) {
        anchors.push(match as HTMLElement);
      }
    }
  }

  return anchors.at(-1) ?? null;
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
    const toolbar = deepQuerySelector(composer, selector);
    if (toolbar && isVisible(toolbar)) return toolbar;
  }
  return null;
}

function composerHasTextbox(composer: Element): boolean {
  return (
    deepQuerySelector(composer, '[role="textbox"]') != null ||
    deepQuerySelector(composer, '[contenteditable="true"]') != null ||
    deepQuerySelector(composer, 'textarea') != null
  );
}

function isComposerReady(composer: Element): boolean {
  if (!isVisible(composer) && !composerHasTextbox(composer)) return false;
  return composerHasTextbox(composer) || findVideoButton(composer) != null || findMediaToolbarAnchor(composer) != null;
}

/**
 * UPDATE WHEN REDDIT UI CHANGES
 */
export function findInjectionTarget(element: Element): ComposerInjectionTarget | null {
  const composer = findComposerRoot(element);
  if (!composer || !isComposerReady(composer)) return null;

  if (deepQuerySelector(composer, `[${VOICE_NOTE_BUTTON_ATTR}]`)) return null;

  const videoButton = findVideoButton(composer);
  const mediaAnchor = findMediaToolbarAnchor(composer);
  const anchorElement = videoButton ?? mediaAnchor;

  // Spec: only inject when video comments UI is available (video or sibling media toolbar).
  if (!anchorElement) return null;

  const toolbar = findToolbar(composer);
  const anchor = anchorElement.parentElement ?? (toolbar as HTMLElement | null) ?? (composer as HTMLElement);

  return { composer, anchor, videoButton: anchorElement };
}

/**
 * Resolve the comment composer associated with a focused node, if any.
 * UPDATE WHEN REDDIT UI CHANGES
 */
export function findComposerFromNode(node: Node | null): Element | null {
  if (!node) return null;

  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const composer = findComposerRoot(current as Element);
      if (composer) return composer;
    }

    const parent: ParentNode | null = current.parentNode;
    if (parent) {
      current = parent as Node;
      continue;
    }

    // BUG FIX: Keyboard shortcut could not resolve Reddit comment composer
    // Fix: parentNode is null inside shadow trees — exit via getRootNode().host.
    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      current = root.host;
      continue;
    }

    break;
  }

  return null;
}

/** Prefer focused composer; otherwise first visible injection target. */
export function resolveTargetComposer(): Element | null {
  const focused = findComposerFromNode(document.activeElement);
  if (focused && isComposerReady(focused)) return focused;

  const targets = findAllInjectionTargets();
  return targets[0]?.composer ?? null;
}

export function findAllInjectionTargets(root: ParentNode = document): ComposerInjectionTarget[] {
  const targets: ComposerInjectionTarget[] = [];
  const seenComposers = new Set<Element>();

  const scanRoots = new Set<Element>();
  for (const selector of COMPOSER_ROOT_SELECTORS) {
    deepQueryAll(root, selector).forEach((el) => scanRoots.add(el));
  }

  if (scanRoots.size === 0) {
    deepQueryAll(root, '[contenteditable="true"][role="textbox"]').forEach((el) => scanRoots.add(el));
    deepQueryAll(root, 'div[role="textbox"]').forEach((el) => scanRoots.add(el));
  }

  for (const scanRoot of scanRoots) {
    const composer = findComposerRoot(scanRoot) ?? scanRoot;
    if (seenComposers.has(composer)) continue;

    if (
      composer.hasAttribute(INJECTED_COMPOSER_ATTR) &&
      deepQuerySelector(composer, `[${VOICE_NOTE_BUTTON_ATTR}]`)
    ) {
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

export function collectScanDiagnostics(root: ParentNode = document): ScanDiagnostics {
  const diagnostics: ScanDiagnostics = {
    composerCandidates: 0,
    visibleComposers: 0,
    withVideoButton: 0,
    withMediaFallback: 0,
    alreadyInjected: 0,
  };

  const composers = new Set<Element>();
  for (const selector of COMPOSER_ROOT_SELECTORS) {
    deepQueryAll(root, selector).forEach((el) => composers.add(el));
  }
  diagnostics.composerCandidates = composers.size;

  for (const composer of composers) {
    if (!isComposerReady(composer)) continue;
    diagnostics.visibleComposers += 1;

    if (deepQuerySelector(composer, `[${VOICE_NOTE_BUTTON_ATTR}]`)) {
      diagnostics.alreadyInjected += 1;
      continue;
    }

    if (findVideoButton(composer)) {
      diagnostics.withVideoButton += 1;
    } else if (findMediaToolbarAnchor(composer)) {
      diagnostics.withMediaFallback += 1;
    }
  }

  return diagnostics;
}

export function logScanDiagnostics(context: string): void {
  const d = collectScanDiagnostics();
  console.log(`${EXTENSION_LOG_PREFIX} Scan diagnostics (${context}):`, d);
}

export function markComposerInjected(composer: Element): void {
  composer.setAttribute(INJECTED_COMPOSER_ATTR, 'true');
}

export function unmarkComposerInjected(composer: Element): void {
  composer.removeAttribute(INJECTED_COMPOSER_ATTR);
}