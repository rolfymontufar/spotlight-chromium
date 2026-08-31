// Subsequence fuzzy matching, Spotlight flavoured: typing "gmi" should find
// "Gmail", and "mdn js" should find developer.mozilla.org/.../JavaScript.
//
// Pure functions. No chrome.* here, so this file can be exercised in plain node.

import { FUZZ, LIMITS, RANK, DAY_MS, SOURCE } from './constants.js';

const SEPARATORS = new Set(['.', '/', '-', '_', ' ', ':', '?', '&', '=', '#', '+', ',', '|', '(', ')', '[', ']']);

/** True when index `i` starts a new "word" in `text`. */
function isBoundary(text, i) {
  if (i === 0) return true;
  const prev = text[i - 1];
  if (SEPARATORS.has(prev)) return true;
  // camelCase: lower followed by upper counts as a boundary.
  const cur = text[i];
  return prev >= 'a' && prev <= 'z' && cur >= 'A' && cur <= 'Z';
}

/** Cheap O(n) reject. Used to throw out the bulk of the index before scoring. */
export function isSubsequence(needle, haystack, from = 0) {
  let ti = from;
  for (let qi = 0; qi < needle.length; qi++) {
    ti = haystack.indexOf(needle[qi], ti);
    if (ti < 0) return false;
    ti++;
  }
  return true;
}

/**
 * Greedy left-to-right walk that prefers word boundaries, but only takes a
 * boundary when the rest of the query still fits after it. That lookahead is
 * what stops "gmi" from wasting its "m" on the wrong occurrence.
 *
 * @returns {{score:number, positions:number[]}|null}
 */
export function fuzzyMatch(query, original, lowered) {
  if (!query) return { score: 0, positions: [] };
  if (!original) return null;

  const target = lowered !== undefined ? lowered : original.toLowerCase();
  if (query.length > target.length) return null;

  const positions = [];
  let cursor = 0;

  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    let at = target.indexOf(ch, cursor);
    if (at < 0) return null;

    // Already consecutive with the previous hit? Nothing beats that.
    if (at !== cursor) {
      const rest = query.slice(qi + 1);
      let probe = at;
      while (probe >= 0) {
        if (isBoundary(target, probe) && (!rest || isSubsequence(rest, target, probe + 1))) {
          at = probe;
          break;
        }
        probe = target.indexOf(ch, probe + 1);
      }
    }

    positions.push(at);
    cursor = at + 1;
  }

  return { score: scorePositions(query, original, target, positions), positions };
}

function scorePositions(query, original, target, positions) {
  let score = 0;

  for (let qi = 0; qi < positions.length; qi++) {
    const p = positions[qi];
    let points = FUZZ.BASE;

    if (p === 0) points += FUZZ.FIRST_CHAR_BONUS;
    else if (isBoundary(target, p)) points += FUZZ.BOUNDARY_BONUS;

    if (qi > 0) {
      const gap = p - positions[qi - 1] - 1;
      if (gap === 0) points += FUZZ.CONSECUTIVE_BONUS;
      else points -= Math.min(gap * FUZZ.GAP_PENALTY, FUZZ.MAX_GAP_PENALTY);
    }

    if (original[p] === query[qi]) points += FUZZ.EXACT_CASE_BONUS;

    score += points;
  }

  // Matches that start deep into the string are weaker.
  score -= Math.min(positions[0] * FUZZ.LEADING_PENALTY, FUZZ.MAX_LEADING_PENALTY);

  if (target.startsWith(query)) score += FUZZ.PREFIX_BONUS;
  else if (target.includes(query)) score += FUZZ.SUBSTRING_BONUS;
  if (target === query) score += FUZZ.EXACT_BONUS;

  // Normalise into roughly 0..1 so the boosts below stay comparable across
  // queries of different lengths.
  const ceiling =
    query.length * (FUZZ.BASE + FUZZ.BOUNDARY_BONUS + FUZZ.CONSECUTIVE_BONUS + FUZZ.EXACT_CASE_BONUS) +
    FUZZ.FIRST_CHAR_BONUS +
    FUZZ.PREFIX_BONUS +
    FUZZ.EXACT_BONUS;

  return Math.max(0, Math.min(1, score / ceiling));
}

/** Splits a query into independent tokens. "mdn js" is two searches, not one. */
export function tokenize(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Every token must land somewhere, in the title or the URL, in any order.
 * Each token scores against whichever field suits it best; the item's text
 * score is the mean, so a query is only as strong as its weakest token.
 */
export function matchItem(tokens, item) {
  if (!tokens.length) return { textScore: 0, titlePositions: null, urlPositions: null };

  let total = 0;
  let titlePositions = null;
  let urlPositions = null;

  for (const token of tokens) {
    const title = fuzzyMatch(token, item.title, item.titleLower);
    const url = fuzzyMatch(token, item.url, item.urlLower);
    if (!title && !url) return null;

    const titleScore = title ? title.score * RANK.TITLE_WEIGHT : -1;
    const urlScore = url ? url.score * RANK.URL_WEIGHT : -1;

    if (titleScore >= urlScore) {
      total += titleScore;
      titlePositions = merge(titlePositions, title.positions);
    } else {
      total += urlScore;
      urlPositions = merge(urlPositions, url.positions);
    }
  }

  return { textScore: total / tokens.length, titlePositions, urlPositions };
}

function merge(existing, positions) {
  if (!existing) return positions.slice();
  for (const p of positions) if (!existing.includes(p)) existing.push(p);
  return existing;
}

export function recencyBoost(lastVisitTime, now = Date.now()) {
  if (!lastVisitTime) return 0;
  const ageDays = Math.max(0, (now - lastVisitTime) / DAY_MS);
  return Math.exp(-ageDays / RANK.RECENCY_HALFLIFE_DAYS);
}

export function frequencyBoost(visitCount) {
  if (!visitCount) return 0;
  return Math.min(1, Math.log1p(visitCount) / Math.log1p(RANK.FREQUENCY_SATURATION));
}

/** Final score for a matched item. `match` comes from matchItem(). */
export function scoreItem(item, match, now = Date.now()) {
  const weight = RANK.SOURCE_WEIGHT[primarySource(item)] ?? 1;
  return (
    match.textScore * weight +
    recencyBoost(item.lastVisitTime, now) * RANK.RECENCY_WEIGHT +
    frequencyBoost(item.visitCount) * RANK.FREQUENCY_WEIGHT
  );
}

/** Ranking with no query at all: most recent and most used, tabs nudged up. */
export function scoreIdle(item, now = Date.now()) {
  return (
    recencyBoost(item.lastVisitTime, now) * RANK.IDLE_RECENCY_WEIGHT +
    frequencyBoost(item.visitCount) * RANK.IDLE_FREQUENCY_WEIGHT +
    (RANK.IDLE_SOURCE_BONUS[primarySource(item)] ?? 0)
  );
}

/** An entry can be several things at once. Tab wins, then bookmark. */
export function primarySource(item) {
  if (item.sources.includes(SOURCE.TAB)) return SOURCE.TAB;
  if (item.sources.includes(SOURCE.BOOKMARK)) return SOURCE.BOOKMARK;
  return SOURCE.HISTORY;
}

/** Long titles and URLs get clipped before they are ever scored. */
export function clip(text) {
  if (!text) return '';
  return text.length > LIMITS.MAX_FIELD_LEN ? text.slice(0, LIMITS.MAX_FIELD_LEN) : text;
}
