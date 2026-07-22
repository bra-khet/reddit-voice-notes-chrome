/*
 * Web host — `browser.runtime.*`, `browser.tabs.*`, `browser.windows.*`,
 * `browser.commands.*`.
 *
 * Track D Phase 0. The message bus here is a LOOPBACK: sender and receiver are
 * the same page. Phase 1 mounts entrypoints/offscreen/main.ts on top of it so the
 * transcode / burn-in / transcribe contracts stay byte-identical to the extension
 * (roadmap §3.3) — nothing in this file knows about those message families.
 */

export type MessageListener = (
  message: any,
  sender: Record<string, unknown>,
  sendResponse: (response?: any) => void,
) => boolean | void | Promise<any>;

const messageListeners = new Set<MessageListener>();

/** Minimal `runtime.Port` shape — only what shared source actually touches. */
export interface WebPort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: {
    addListener(listener: (message: any) => void): void;
    removeListener(listener: (message: any) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
}

/** Minimal `tabs.Tab` shape — shared source reads only these fields. */
export interface WebTab {
  id?: number;
  windowId?: number;
  url?: string;
}

/*
 * A synthetic sender. `runtime.id` must be TRUTHY: transcoder.ts's
 * isExtensionContextValid() reads it before every transcode and a falsy value
 * aborts the pipeline before it starts (roadmap §3.2 hazard 4).
 */
const RUNTIME_ID = 'rvn-web-host';

function webOrigin(): string {
  return `${location.origin}${import.meta.env.BASE_URL}`;
}

/**
 * Resolve a packaged-asset path to a URL under the Pages base.
 *
 * In the extension this returns `chrome-extension://<id>/<path>`. Here it must
 * return an absolute http(s) URL, because several call sites pass the result
 * straight to fetch() or to an <img>/worker src.
 */
export function webGetURL(path: string): string {
  return `${webOrigin()}${String(path).replace(/^\/+/, '')}`;
}

/**
 * Deliver a message to every in-page listener and resolve with the first
 * non-undefined response.
 *
 * Contract detail that matters: when NO listener responds this resolves
 * `undefined` and does NOT throw. The extension's "Could not establish
 * connection / no receiving end" rejection is caught-and-ignored at several call
 * sites (`.catch(() => {})`); if this rejected instead, those sites would swallow
 * it identically — but sites that AWAIT a response would hang on a rejection they
 * never expected. Resolving undefined is both closer to the useful case and
 * strictly safer. (roadmap §3.2 hazard 3)
 */
export function webSendMessage(message: any): Promise<any> {
  return new Promise((resolve) => {
    const listeners = [...messageListeners];
    if (listeners.length === 0) {
      resolve(undefined);
      return;
    }

    let settled = false;
    let pendingAsync = 0;
    const settle = (value: unknown): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    for (const listener of listeners) {
      const sendResponse = (response?: any): void => {
        settle(response);
      };

      let result: boolean | void | Promise<any>;
      try {
        // NOTE: the message object is passed BY REFERENCE, not structured-cloned.
        // The pipeline moves base64-packed binaries through here; cloning a 30 MB
        // payload would cost a copy the single-context host does not owe anyone.
        result = listener(message, { id: RUNTIME_ID, url: location.href }, sendResponse);
      } catch (error) {
        console.error('[web-runtime] onMessage listener threw', error);
        continue;
      }

      if (result instanceof Promise) {
        pendingAsync += 1;
        void result.then(
          (value) => {
            if (value !== undefined) settle(value);
            pendingAsync -= 1;
            if (pendingAsync === 0) settle(undefined);
          },
          (error) => {
            console.error('[web-runtime] async onMessage listener rejected', error);
            pendingAsync -= 1;
            if (pendingAsync === 0) settle(undefined);
          },
        );
      } else if (result === true) {
        // MV3 convention: `return true` means "sendResponse will be called later".
        pendingAsync += 1;
      }
      // BUG FIX: a synchronous responder silenced every later listener
      // Fix: this loop used to `return` as soon as one listener called
      // sendResponse. That conflates "won the response race" with "consumed the
      // message" — in the real runtime EVERY listener receives EVERY message and
      // only the first response is kept. With offscreen/main.ts now mounted
      // in-page (Phase 1) the two collide directly: offscreen answers
      // MSG_*_OFFSCREEN synchronously, so any listener registered after it
      // would have stopped seeing traffic. settle() is already idempotent, so
      // delivering to the rest is free.
    }

    if (pendingAsync === 0) settle(undefined);
  });
}

export const webRuntime = {
  id: RUNTIME_ID,
  getURL: webGetURL,
  sendMessage: webSendMessage,
  onMessage: {
    addListener(listener: MessageListener): void {
      messageListeners.add(listener);
    },
    removeListener(listener: MessageListener): void {
      messageListeners.delete(listener);
    },
    hasListener(listener: MessageListener): boolean {
      return messageListeners.has(listener);
    },
  },
  /* Content-script-only in the extension; unreachable here, but must exist so a
   * feature-detecting caller sees the same shape rather than a TypeError. */
  onConnect: {
    addListener(): void {},
    removeListener(): void {},
    hasListener(): boolean {
      return false;
    },
  },
  /*
   * Long-lived ports need a background service worker to connect TO, and there
   * isn't one. Throwing is the honest answer, and it is also the SAFE one: the
   * single caller (src/storage/background-loader.ts:237, the personal-background
   * blob relay) wraps this in try/catch and degrades to `null`, which is exactly
   * the "relay unavailable, use the direct path" outcome we want here.
   *
   * Typed as returning a port so shared source still compiles.
   *
   * CHANGED: swept 2026-07-22 — by inspection this is unreachable here.
   * WHY: background-loader.ts routes BOTH loadBackgroundImageElement() and
   *      fetchAnimatableBytes() through isExtensionPageContext() →
   *      isOwnStorageOrigin(), which is true on the hosted Studio, so both take
   *      the local-IDB branch and the port relay is never entered. That is a
   *      static claim, not an observation: roadmap §7.2 registers it as H-5 and
   *      QA item 3.9 confirms it in Phase 2, which is the first phase that runs
   *      personal and animated backgrounds for real.
   */
  connect(_connectInfo?: { name?: string }): WebPort {
    throw new Error('[web-runtime] runtime.connect has no background to reach on the hosted surface');
  },
  reload(): void {
    location.reload();
  },
  async getPlatformInfo(): Promise<{ os: string; arch: string }> {
    return { os: 'web', arch: 'web' };
  },
  /* Present so `browser.runtime.lastError` reads as "no error" rather than
   * throwing on property access in any callback-style code path. */
  lastError: undefined as { message: string } | undefined,
};

/*
 * tabs/windows: there are no other tabs to talk to, and no Reddit tab to focus.
 *
 * The ONE case with a sensible web behaviour is activateRedditTab() — a user
 * asking to go to Reddit can be sent there in a new tab. Everything else no-ops
 * rather than throwing, because these paths are reached from shared UI code that
 * has no reason to know which host it is running on.
 *
 * Phase 3 supersedes most of this: `hostCapabilities.redditAttach: false` will
 * stop the Studio from RENDERING the affordance at all (roadmap §3.6), so these
 * stubs become the belt to that braces.
 */
export const webTabs = {
  /*
   * Always empty. activateRedditTab() reads this first and, finding nothing,
   * falls through to tabs.create() — which is the branch with a real web meaning.
   * Returning a fake tab would send it down update()/windows.update() instead and
   * silently do nothing at all.
   */
  async query(_queryInfo?: Record<string, unknown>): Promise<WebTab[]> {
    return [];
  },
  async update(_tabId?: number, _updateProperties?: Record<string, unknown>): Promise<WebTab | null> {
    return null;
  },
  async create(createProperties?: { url?: string }): Promise<WebTab | null> {
    if (createProperties?.url) window.open(createProperties.url, '_blank', 'noopener');
    return null;
  },
  /* Targets Reddit content scripts. None exist here, so this resolves undefined
   * rather than rejecting — same contract as sendMessage with no listener. */
  async sendMessage(_tabId?: number, _message?: any): Promise<any> {
    return undefined;
  },
};

export const webWindows = {
  async update(_windowId?: number, _updateInfo?: Record<string, unknown>): Promise<null> {
    return null;
  },
};

export const webCommands = {
  onCommand: {
    addListener(): void {},
    removeListener(): void {},
    hasListener(): boolean {
      return false;
    },
  },
};
