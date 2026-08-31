// Single place for every tunable. Nothing here touches a chrome.* API.

export const MSG = {
  QUERY: 'spotlight:query',
  RUN: 'spotlight:run',
  TOGGLE: 'spotlight:toggle',
  SET_SOURCE: 'spotlight:set-source',
};

export const SOURCE = {
  TAB: 'tab',
  BOOKMARK: 'bookmark',
  HISTORY: 'history',
  SEARCH: 'search',
};

/**
 * Which sources Spotlight looks in on a fresh profile. Users change this from
 * the toggles in the panel footer; what they pick is stored and wins from
 * then on. Edit here to change the out-of-the-box behaviour.
 *
 * Tabs are off by default: bookmarks and history are things you chose to keep
 * or actually visited, whereas a wall of open tabs mostly crowds them out.
 */
export const DEFAULT_SOURCES = {
  [SOURCE.BOOKMARK]: true,
  [SOURCE.HISTORY]: true,
  [SOURCE.TAB]: false,
};

/** Where the user's choice is stored, in chrome.storage.sync. */
export const SOURCES_KEY = 'spotlight:sources';

/**
 * Display order and wording for the footer toggles and the placeholder. The
 * order here is the order they appear in.
 */
export const SOURCE_LABELS = [
  { id: SOURCE.BOOKMARK, label: 'Bookmarks', phrase: 'bookmarks' },
  { id: SOURCE.HISTORY, label: 'History', phrase: 'history' },
  { id: SOURCE.TAB, label: 'Tabs', phrase: 'tabs' },
];

export const LIMITS = {
  // How far back the cached history slice reaches.
  HISTORY_DAYS: 90,
  // Size of that cached slice.
  HISTORY_MAX: 5000,
  // Live top-up query against the full history store, for anything older.
  DEEP_HISTORY_MAX: 30,
  // Minimum query length before the deep top-up is worth a round trip.
  DEEP_HISTORY_MIN_CHARS: 3,
  // Longest prefix of a field we bother scoring.
  MAX_FIELD_LEN: 160,
  // Rows handed back to the UI (the web-search row is extra).
  MAX_RESULTS: 8,
};

// Per-character scoring for the fuzzy matcher. Raw points, normalised later.
export const FUZZ = {
  BASE: 16,
  FIRST_CHAR_BONUS: 22,
  BOUNDARY_BONUS: 14,
  CONSECUTIVE_BONUS: 12,
  EXACT_CASE_BONUS: 2,
  GAP_PENALTY: 2,
  MAX_GAP_PENALTY: 14,
  LEADING_PENALTY: 1.5,
  MAX_LEADING_PENALTY: 15,
  SUBSTRING_BONUS: 30,
  PREFIX_BONUS: 30,
  EXACT_BONUS: 40,
};

export const RANK = {
  // A title hit is worth more than the same hit buried in a URL.
  TITLE_WEIGHT: 1.0,
  URL_WEIGHT: 0.82,

  // Multiplies the text score.
  SOURCE_WEIGHT: {
    [SOURCE.TAB]: 1.3,
    [SOURCE.BOOKMARK]: 1.2,
    [SOURCE.HISTORY]: 1.0,
  },

  // Added to the text score. Both land in roughly 0..1 before weighting.
  RECENCY_WEIGHT: 0.25,
  RECENCY_HALFLIFE_DAYS: 14,
  FREQUENCY_WEIGHT: 0.25,
  FREQUENCY_SATURATION: 60,

  // Ranking for the empty query, where there is no text score at all.
  IDLE_RECENCY_WEIGHT: 1.0,
  IDLE_FREQUENCY_WEIGHT: 0.6,
  IDLE_SOURCE_BONUS: {
    [SOURCE.TAB]: 0.45,
    [SOURCE.BOOKMARK]: 0.15,
    [SOURCE.HISTORY]: 0,
  },
};

export const DAY_MS = 24 * 60 * 60 * 1000;
