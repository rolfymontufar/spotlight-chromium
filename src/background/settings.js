// The user's source choices, cached in worker memory and persisted so they
// survive the worker being torn down.

import { DEFAULT_SOURCES, SOURCES_KEY } from '../shared/constants.js';

/** @type {Record<string, boolean>|null} */
let cache = null;
let loading = null;

/**
 * Synchronous best guess, for the event listeners that cannot await. Falls
 * back to the defaults until the first real load lands.
 */
export function snapshot() {
  return cache || DEFAULT_SOURCES;
}

export async function getSources() {
  if (cache) return cache;
  if (!loading) {
    loading = chrome.storage.sync
      .get(SOURCES_KEY)
      .then((stored) => {
        // Spread over the defaults so a source added in a later version is
        // enabled sensibly rather than coming back undefined.
        cache = { ...DEFAULT_SOURCES, ...(stored?.[SOURCES_KEY] || {}) };
        return cache;
      })
      .catch(() => {
        cache = { ...DEFAULT_SOURCES };
        return cache;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export async function setSource(source, enabled) {
  const current = await getSources();
  if (!(source in DEFAULT_SOURCES)) return current;

  cache = { ...current, [source]: !!enabled };
  await chrome.storage.sync.set({ [SOURCES_KEY]: cache }).catch(() => {});
  return cache;
}

/** Another window changed the setting; drop the stale copy. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[SOURCES_KEY]) {
    cache = { ...DEFAULT_SOURCES, ...(changes[SOURCES_KEY].newValue || {}) };
  }
});
