// Query orchestration. Scores the cached index, folds in live tabs and a deep
// history top-up, and returns a short ranked list ready to render.

import { LIMITS, SOURCE, SOURCE_LABELS } from '../shared/constants.js';
import { matchItem, scoreItem, scoreIdle, primarySource, tokenize, clip } from '../shared/fuzzy.js';
import { getIndex, normalizeUrl, upsert } from './index.js';
import { currentBrowserTab } from './actions.js';
import { getSources } from './settings.js';

/**
 * Open tabs, minus the one the user is already looking at (switching to it
 * does nothing) and minus the panel's own fallback window.
 */
async function liveTabs(enabled) {
  if (!enabled[SOURCE.TAB]) return [];

  const [tabs, active] = await Promise.all([
    chrome.tabs.query({ windowType: 'normal' }).catch(() => []),
    currentBrowserTab().catch(() => null),
  ]);
  const activeId = active?.id;
  return tabs.filter((t) => t.url && t.id !== activeId && !t.url.startsWith('chrome-extension://'));
}

/**
 * Overlays live tab state onto a copy of the index. The copy is shallow per
 * entry so tab state never leaks back into the cached index.
 */
function withTabs(indexMap, tabs) {
  const merged = new Map(indexMap);

  for (const tab of tabs) {
    const key = normalizeUrl(tab.url);
    const existing = merged.get(key);

    // How recently a tab was looked at is a far better freshness signal than
    // whatever history says about the same URL.
    const touched = tab.lastAccessed || 0;

    if (existing) {
      merged.set(key, {
        ...existing,
        sources: existing.sources.includes(SOURCE.TAB) ? existing.sources : [...existing.sources, SOURCE.TAB],
        lastVisitTime: Math.max(existing.lastVisitTime, touched),
        tabId: tab.id,
        windowId: tab.windowId,
        favIconUrl: tab.favIconUrl,
      });
      continue;
    }

    // A tab on a page that was never indexed, e.g. a brave:// page or a
    // session restored before this profile had history for it.
    const title = clip((tab.title || tab.url).trim());
    merged.set(key, {
      key,
      url: tab.url,
      title,
      titleLower: title.toLowerCase(),
      urlLower: clip(tab.url).toLowerCase(),
      sources: [SOURCE.TAB],
      visitCount: 0,
      lastVisitTime: touched,
      folderPath: '',
      tabId: tab.id,
      windowId: tab.windowId,
      favIconUrl: tab.favIconUrl,
    });
  }

  return merged;
}

/** History older than the cached window, pulled in only for real queries. */
async function deepHistory(text, merged) {
  const found = await chrome.history
    .search({ text, maxResults: LIMITS.DEEP_HISTORY_MAX, startTime: 0 })
    .catch(() => []);

  const extra = new Map();
  for (const h of found) {
    if (merged.has(normalizeUrl(h.url))) continue;
    const entry = upsert(extra, h.url, h.title, SOURCE.HISTORY);
    if (!entry) continue;
    entry.visitCount = h.visitCount || 0;
    entry.lastVisitTime = h.lastVisitTime || 0;
  }
  return extra;
}

function toResult(entry, match) {
  return {
    type: primarySource(entry),
    url: entry.url,
    title: entry.title,
    subtitle: subtitleFor(entry),
    tabId: entry.tabId,
    windowId: entry.windowId,
    favIconUrl: entry.favIconUrl,
    sources: entry.sources,
    rail: railFor(entry.sources),
    titlePositions: match ? match.titlePositions : null,
  };
}

/**
 * The URL identifies the result, so it is always shown, bookmarks included.
 * A bookmark filed in a nested folder gets that folder's name after it;
 * "Bookmarks bar" is where things go by default and naming it says nothing.
 * Appended to the same string so it is the first thing to be truncated away.
 */
function subtitleFor(entry) {
  const url = prettyUrl(entry.url);
  if (entry.sources.includes(SOURCE.BOOKMARK) && entry.folderPath.includes(' / ')) {
    return url + '  ·  ' + entry.folderPath.split(' / ').pop();
  }
  return url;
}

/**
 * Which segments the rail draws. Having a page open or bookmarked already
 * means you have been there, so history only earns a segment when it is the
 * only thing a result is.
 */
function railFor(sources) {
  const kept = sources.filter((source) => source !== SOURCE.HISTORY);
  return kept.length ? kept : sources.slice();
}

function prettyUrl(url) {
  try {
    const u = new URL(url);
    // brave://, file:// and friends have no meaningful host to strip down to.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
    const rest = (u.pathname === '/' ? '' : u.pathname) + u.search;
    return u.host.replace(/^www\./, '') + rest;
  } catch {
    return url;
  }
}

/** "Search bookmarks, history and tabs", minus whatever is switched off. */
export function placeholderText(enabled) {
  const parts = SOURCE_LABELS.filter((s) => enabled[s.id]).map((s) => s.phrase);

  if (!parts.length) return 'Every source is switched off';
  if (parts.length === 1) return 'Search ' + parts[0];
  return 'Search ' + parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/** The footer toggles: display order, wording and current state, in one go. */
export function sourceControls(enabled) {
  return SOURCE_LABELS.map((s) => ({ id: s.id, label: s.label, enabled: !!enabled[s.id] }));
}

export async function runSearch(rawText) {
  const text = (rawText || '').trim();
  const tokens = tokenize(text);
  const now = Date.now();

  const enabled = await getSources();
  const [indexMap, tabs] = await Promise.all([getIndex(), liveTabs(enabled)]);
  let merged = withTabs(indexMap, tabs);

  if (enabled[SOURCE.HISTORY] && tokens.length && text.length >= LIMITS.DEEP_HISTORY_MIN_CHARS) {
    const extra = await deepHistory(text, merged);
    if (extra.size) merged = new Map([...merged, ...extra]);
  }

  const scored = [];

  if (!tokens.length) {
    for (const entry of merged.values()) {
      scored.push({ entry, match: null, score: scoreIdle(entry, now) });
    }
  } else {
    for (const entry of merged.values()) {
      const match = matchItem(tokens, entry);
      if (!match) continue;
      scored.push({ entry, match, score: scoreItem(entry, match, now) });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const results = scored.slice(0, LIMITS.MAX_RESULTS).map((s) => toResult(s.entry, s.match));

  if (text) {
    results.push({
      type: SOURCE.SEARCH,
      title: text,
      subtitle: 'Search the web',
      query: text,
    });
  }

  return { results, placeholder: placeholderText(enabled), sources: sourceControls(enabled) };
}
