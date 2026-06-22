/**
 * Persists jobId → Reddit tabId for offscreen → content-script relays.
 * MV3 service workers lose in-memory maps on restart; session storage survives
 * for the browser session (BUG-032).
 */

const RELAY_TAB_SESSION_KEY = 'rvnRelayTabByJobId';

interface RelayTabEntry {
  tabId: number;
  registeredAt: number;
}

type RelayTabMap = Record<string, RelayTabEntry>;

async function readRelayTabMap(): Promise<RelayTabMap> {
  try {
    const stored = await browser.storage.session.get(RELAY_TAB_SESSION_KEY);
    const raw = stored[RELAY_TAB_SESSION_KEY];
    if (!raw || typeof raw !== 'object') return {};
    return raw as RelayTabMap;
  } catch {
    return {};
  }
}

async function writeRelayTabMap(map: RelayTabMap): Promise<void> {
  try {
    await browser.storage.session.set({ [RELAY_TAB_SESSION_KEY]: map });
  } catch {
    // Session storage may be unavailable in some test harnesses.
  }
}

export async function rememberRelayTab(jobId: string, tabId: number): Promise<void> {
  const map = await readRelayTabMap();
  map[jobId] = { tabId, registeredAt: Date.now() };
  await writeRelayTabMap(map);
}

export async function forgetRelayTab(jobId: string): Promise<void> {
  const map = await readRelayTabMap();
  if (!(jobId in map)) return;
  delete map[jobId];
  await writeRelayTabMap(map);
}

export async function lookupRelayTab(jobId: string): Promise<number | undefined> {
  const map = await readRelayTabMap();
  return map[jobId]?.tabId;
}

const REDDIT_TAB_URLS = ['https://www.reddit.com/*', 'https://reddit.com/*'] as const;

export async function resolveActiveRedditTabId(): Promise<number | undefined> {
  const tabs = await browser.tabs.query({ url: [...REDDIT_TAB_URLS] });
  const target = tabs.find((tab) => tab.active) ?? tabs[0];
  return target?.id;
}