/*
 * Web host — `browser.storage.*` over Pages-origin IndexedDB.
 *
 * Track D Phase 0. See docs/v6.0.0-hosted-design-studio.md §3.2 for why each of
 * these behaviours is load-bearing rather than a convenience.
 *
 * THE HAZARD THIS FILE EXISTS TO AVOID
 * -----------------------------------
 * Real `chrome.storage.onChanged` notifies EVERY context, including the one that
 * performed the write. The take lifecycle (ADR-0002 / I9) and the preference
 * coordinator (I21) are both built on that: a module writes a key and then reacts
 * to its own change event. On the hosted surface there is exactly ONE context, so
 * a shim that helpfully skips "the writer" notifies nobody and the Studio quietly
 * stops reacting to its own state. Fire unconditionally.
 */

export type StorageAreaName = 'local' | 'sync' | 'session';

export type StorageChange = { oldValue?: unknown; newValue?: unknown };

export type StorageChangeListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void;

export interface WebStorageArea {
  // `any` is deliberate: ~40 extension call sites read typed values straight out
  // of the returned record. Narrowing to `unknown` here would force casts into
  // shared source, which must stay identical for both hosts.
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, any>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'rvnWebHostStorage';
const DB_VERSION = 1;
const STORE = 'kv';

/* Areas share one store; the key is namespaced so `local` and `sync` cannot
 * collide. `session` never touches IDB at all (see below). */
const compositeKey = (area: StorageAreaName, key: string): string => `${area}:${key}`;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('rvnWebHostStorage open failed'));
  });
  return dbPromise;
}

/*
 * Serialized write queue.
 *
 * `storage.local` is async in the extension and must STAY async here — backing it
 * with localStorage would make writes synchronous and let ordering bugs hide until
 * they surface on the real (async) host. Chaining every mutation through one tail
 * promise gives the same "writes land in call order" guarantee chrome.storage has.
 */
let writeTail: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeTail.then(operation, operation);
  // Swallow rejection on the CHAIN only — the returned promise still rejects, so
  // one failed write cannot poison every write that follows it.
  writeTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** In-memory backing for `storage.session`: cleared on reload, exactly like MV3. */
const sessionStore = new Map<string, unknown>();

/** Listeners are global across areas — `browser.storage.onChanged` is not per-area. */
const changeListeners = new Set<StorageChangeListener>();

function dispatchChanges(area: StorageAreaName, changes: Record<string, StorageChange>): void {
  if (Object.keys(changes).length === 0) return;
  // Asynchronous, like the real event — a listener must never run inside the
  // caller's stack frame, or re-entrant writes would deadlock the queue.
  queueMicrotask(() => {
    for (const listener of [...changeListeners]) {
      try {
        listener(changes, area);
      } catch (error) {
        // One bad listener must not stop the others, and must not reject the write.
        console.error('[web-storage] onChanged listener threw', error);
      }
    }
  });
}

function normalizeKeys(
  keys: string | string[] | Record<string, unknown> | null | undefined,
): { names: string[] | null; defaults: Record<string, unknown> } {
  if (keys == null) return { names: null, defaults: {} };
  if (typeof keys === 'string') return { names: [keys], defaults: {} };
  if (Array.isArray(keys)) return { names: keys, defaults: {} };
  return { names: Object.keys(keys), defaults: keys };
}

async function idbReadMany(area: StorageAreaName, names: string[] | null): Promise<Record<string, unknown>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const out: Record<string, unknown> = {};

    if (names === null) {
      // get() with no argument means "everything in this area".
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const composite = String(cursor.key);
        if (composite.startsWith(`${area}:`)) {
          out[composite.slice(area.length + 1)] = cursor.value;
        }
        cursor.continue();
      };
    } else {
      for (const name of names) {
        const request = store.get(compositeKey(area, name));
        request.onsuccess = () => {
          if (request.result !== undefined) out[name] = request.result;
        };
      }
    }

    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error ?? new Error('rvnWebHostStorage read failed'));
    tx.onabort = () => reject(tx.error ?? new Error('rvnWebHostStorage read aborted'));
  });
}

function createIdbArea(area: StorageAreaName): WebStorageArea {
  return {
    async get(keys) {
      const { names, defaults } = normalizeKeys(keys);
      const stored = await idbReadMany(area, names);
      // Object-form keys supply defaults for anything absent, matching chrome.storage.
      return { ...defaults, ...stored };
    },

    set(items) {
      return enqueueWrite(async () => {
        const db = await openDb();
        const names = Object.keys(items);
        // oldValue has to come from the SAME transaction as the write, or a
        // concurrent set could report a value that was never actually replaced.
        const changes = await new Promise<Record<string, StorageChange>>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          const collected: Record<string, StorageChange> = {};
          for (const name of names) {
            const composite = compositeKey(area, name);
            const readRequest = store.get(composite);
            readRequest.onsuccess = () => {
              collected[name] = { oldValue: readRequest.result, newValue: items[name] };
              store.put(items[name], composite);
            };
          }
          tx.oncomplete = () => resolve(collected);
          tx.onerror = () => reject(tx.error ?? new Error('rvnWebHostStorage write failed'));
          tx.onabort = () => reject(tx.error ?? new Error('rvnWebHostStorage write aborted'));
        });
        dispatchChanges(area, changes);
      });
    },

    remove(keys) {
      return enqueueWrite(async () => {
        const db = await openDb();
        const names = typeof keys === 'string' ? [keys] : keys;
        const changes = await new Promise<Record<string, StorageChange>>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          const collected: Record<string, StorageChange> = {};
          for (const name of names) {
            const composite = compositeKey(area, name);
            const readRequest = store.get(composite);
            readRequest.onsuccess = () => {
              // A delete of an absent key is not a change — chrome does not fire for it.
              if (readRequest.result === undefined) return;
              collected[name] = { oldValue: readRequest.result, newValue: undefined };
              store.delete(composite);
            };
          }
          tx.oncomplete = () => resolve(collected);
          tx.onerror = () => reject(tx.error ?? new Error('rvnWebHostStorage remove failed'));
          tx.onabort = () => reject(tx.error ?? new Error('rvnWebHostStorage remove aborted'));
        });
        dispatchChanges(area, changes);
      });
    },

    clear() {
      return enqueueWrite(async () => {
        const existing = await idbReadMany(area, null);
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          for (const name of Object.keys(existing)) store.delete(compositeKey(area, name));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('rvnWebHostStorage clear failed'));
        });
        const changes: Record<string, StorageChange> = {};
        for (const [name, oldValue] of Object.entries(existing)) {
          changes[name] = { oldValue, newValue: undefined };
        }
        dispatchChanges(area, changes);
      });
    },
  };
}

/* `session` is memory-only by contract, so it does not go through IDB or the
 * write queue — but it MUST still emit change events with identical shape. */
function createSessionArea(): WebStorageArea {
  return {
    async get(keys) {
      const { names, defaults } = normalizeKeys(keys);
      const out: Record<string, unknown> = { ...defaults };
      const wanted = names ?? [...sessionStore.keys()];
      for (const name of wanted) {
        if (sessionStore.has(name)) out[name] = sessionStore.get(name);
      }
      return out;
    },
    async set(items) {
      const changes: Record<string, StorageChange> = {};
      for (const [name, value] of Object.entries(items)) {
        changes[name] = { oldValue: sessionStore.get(name), newValue: value };
        sessionStore.set(name, value);
      }
      dispatchChanges('session', changes);
    },
    async remove(keys) {
      const names = typeof keys === 'string' ? [keys] : keys;
      const changes: Record<string, StorageChange> = {};
      for (const name of names) {
        if (!sessionStore.has(name)) continue;
        changes[name] = { oldValue: sessionStore.get(name), newValue: undefined };
        sessionStore.delete(name);
      }
      dispatchChanges('session', changes);
    },
    async clear() {
      const changes: Record<string, StorageChange> = {};
      for (const [name, oldValue] of sessionStore) {
        changes[name] = { oldValue, newValue: undefined };
      }
      sessionStore.clear();
      dispatchChanges('session', changes);
    },
  };
}

export const webStorage = {
  local: createIdbArea('local'),
  /*
   * `sync` is a SEPARATE namespace backed by the same store, not an alias of
   * `local`. There is no cross-device sync on a static page, but keeping the
   * namespaces distinct means a key written to one is not readable from the
   * other — which is what the extension's own behaviour is, and the only way a
   * mistaken area choice stays visible instead of silently working here.
   */
  sync: createIdbArea('sync'),
  session: createSessionArea(),
  onChanged: {
    addListener(listener: StorageChangeListener): void {
      changeListeners.add(listener);
    },
    removeListener(listener: StorageChangeListener): void {
      changeListeners.delete(listener);
    },
    hasListener(listener: StorageChangeListener): boolean {
      return changeListeners.has(listener);
    },
  },
};
