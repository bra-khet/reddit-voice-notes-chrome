/**
 * Traverse Reddit's web-component trees, including closed Shadow DOM (via chrome.dom).
 */

type ChromeDomApi = {
  openOrClosedShadowRoot: (element: Element) => ShadowRoot | null;
};

function getChromeDomApi(): ChromeDomApi | undefined {
  const chromeRef = (globalThis as { chrome?: { dom?: ChromeDomApi } }).chrome;
  return chromeRef?.dom;
}

function getShadowRoot(element: Element): ShadowRoot | null {
  if (element.shadowRoot) {
    return element.shadowRoot;
  }

  const domApi = getChromeDomApi();
  if (domApi?.openOrClosedShadowRoot) {
    try {
      return domApi.openOrClosedShadowRoot(element);
    } catch {
      return null;
    }
  }

  return null;
}

/** Depth-first walk of light DOM + all reachable shadow roots. */
export function walkDeepElements(
  root: ParentNode,
  visit: (element: Element, contextRoot: Document | ShadowRoot) => void,
): void {
  const queue: Array<{ node: ParentNode; context: Document | ShadowRoot }> = [
    { node: root, context: root instanceof Document ? root : (root as ShadowRoot) },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = current.node.childNodes;

    for (const child of children) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element;

      visit(element, current.context);

      const shadow = getShadowRoot(element);
      if (shadow) {
        queue.push({ node: shadow, context: shadow });
      }

      queue.push({ node: element, context: current.context });
    }
  }
}

export function deepQueryAll(root: ParentNode, selector: string): Element[] {
  const matches: Element[] = [];
  walkDeepElements(root, (element) => {
    if (element.matches(selector)) {
      matches.push(element);
    }
  });
  return matches;
}

export function deepQuerySelector(root: ParentNode, selector: string): Element | null {
  let found: Element | null = null;
  walkDeepElements(root, (element) => {
    if (!found && element.matches(selector)) {
      found = element;
    }
  });
  return found;
}