// The search index: every bookmark, plus a recent slice of history, held in
// service worker memory and keyed by normalised URL.
//
// MV3 kills the worker after ~30s idle, so this is built to be cheap to
// rebuild rather than persisted. Rebuilding beats deserialising, and it can
// never go stale.

import { LIMITS, SOURCE, DAY_MS } from '../shared/constants.js';
import { clip } from '../shared/fuzzy.js';
import { getSources, snapshot } from './settings.js';

/** @type {Map<string, object>|null} */
let index = null;
/** @type {Promise<Map<string, object>>|null} */
let building = null;

/** Trailing slashes and fragments make the same page look like two pages. */
export function normalizeUrl(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    if (u.pathname === '/') u.pathname = '';
    return u.protocol + '//' + u.host.toLowerCase() + u.pathname + u.search;
  } catch {
    return raw;
  }
}

/** Everything the matcher and the UI need, precomputed once at build time. */
function makeEntry(url, title, source) {
  const display = title && title.trim() ? title.trim() : url;
  const clippedTitle = clip(display);
  const clippedUrl = clip(url);
  return {
    key: normalizeUrl(url),
    url,
    title: clippedTitle,
    titleLower: clippedTitle.toLowerCase(),
    urlLower: clippedUrl.toLowerCase(),
    sources: [source],
    visitCount: 0,
    lastVisitTime: 0,
    folderPath: '',
    tabId: null,
    windowId: null,
  };
}

function addSource(entry, source) {
  if (!entry.sources.includes(source)) entry.sources.push(source);
}

/** Upserts an entry into `map`, merging sources and keeping the richer data. */
export function upsert(map, url, title, source) {
  if (!url || !/^https?:|^ftp:|^file:/i.test(url)) return null;
  const key = normalizeUrl(url);
  const existing = map.get(key);
  if (existing) {
    addSource(existing, source);
    // A bookmark's own name beats a page title scraped from a visit.
    if (source === SOURCE.BOOKMARK && title && title.trim()) {
      existing.title = clip(title.trim());
      existing.titleLower = existing.title.toLowerCase();
    }
    return existing;
  }
  const entry = makeEntry(url, title, source);
  map.set(key, entry);
  return entry;
}

function flattenBookmarks(nodes, map, path) {
  for (const node of nodes) {
    if (node.children) {
      const name = node.title ? (path ? path + ' / ' + node.title : node.title) : path;
      flattenBookmarks(node.children, map, name);
    } else if (node.url && !/^javascript:/i.test(node.url)) {
      const entry = upsert(map, node.url, node.title, SOURCE.BOOKMARK);
      if (entry) entry.folderPath = path;
    }
  }
}

async function build() {
  const map = new Map();
  const enabled = await getSources();

  // A disabled source is never even fetched, so it costs nothing to leave off.
  const [tree, history] = await Promise.all([
    enabled[SOURCE.BOOKMARK] ? chrome.bookmarks.getTree().catch(() => []) : [],
    enabled[SOURCE.HISTORY]
      ? chrome.history
          .search({
            text: '',
            maxResults: LIMITS.HISTORY_MAX,
            startTime: Date.now() - LIMITS.HISTORY_DAYS * DAY_MS,
          })
          .catch(() => [])
      : [],
  ]);

  flattenBookmarks(tree, map, '');

  for (const h of history) {
    const entry = upsert(map, h.url, h.title, SOURCE.HISTORY);
    if (!entry) continue;
    entry.visitCount = Math.max(entry.visitCount, h.visitCount || 0);
    entry.lastVisitTime = Math.max(entry.lastVisitTime, h.lastVisitTime || 0);
  }

  return map;
}

export async function getIndex() {
  if (index) return index;
  if (!building) {
    building = build()
      .then((map) => {
        index = map;
        return map;
      })
      .finally(() => {
        building = null;
      });
  }
  return building;
}

/** Bookmarks change rarely, so a full rebuild on the next query is fine. */
export function invalidate() {
  index = null;
}

/** A single visit is cheap to fold in; no need to throw the whole index away. */
export function recordVisit(historyItem) {
  if (!index || !snapshot()[SOURCE.HISTORY]) return;
  const entry = upsert(index, historyItem.url, historyItem.title, SOURCE.HISTORY);
  if (!entry) return;
  entry.visitCount = Math.max(entry.visitCount, historyItem.visitCount || entry.visitCount + 1);
  entry.lastVisitTime = historyItem.lastVisitTime || Date.now();
}

export function forgetUrls(urls) {
  if (!index) return;
  for (const url of urls) {
    const key = normalizeUrl(url);
    const entry = index.get(key);
    if (!entry) continue;
    // Still a bookmark? Keep the row, just drop the history signal.
    if (entry.sources.includes(SOURCE.BOOKMARK)) {
      entry.sources = entry.sources.filter((s) => s !== SOURCE.HISTORY);
      entry.visitCount = 0;
      entry.lastVisitTime = 0;
    } else {
      index.delete(key);
    }
  }
}
