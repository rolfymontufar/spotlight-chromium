// Everything the user can actually do from a result row.

import { SOURCE } from '../shared/constants.js';

/**
 * The active tab of the frontmost ordinary window. Explicitly not
 * lastFocusedWindow: when the fallback panel has focus, that is the panel's
 * own window, and "open in the current tab" would navigate the panel.
 */
export async function currentBrowserTab() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (win?.id != null) {
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (tab) return tab;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowType: 'normal' });
  return tab || null;
}

/**
 * @param {string} url
 * @param {'current'|'newTab'|'newWindow'} disposition
 */
export async function openUrl(url, disposition) {
  if (disposition === 'newWindow') {
    await chrome.windows.create({ url, focused: true });
    return;
  }
  if (disposition === 'newTab') {
    await chrome.tabs.create({ url, active: true });
    return;
  }
  const active = await currentBrowserTab();
  if (active?.id != null) {
    await chrome.tabs.update(active.id, { url });
    if (active.windowId != null) await chrome.windows.update(active.windowId, { focused: true }).catch(() => {});
  } else {
    await chrome.tabs.create({ url, active: true });
  }
}

/**
 * Focusing the window is the half everyone forgets, and it is why switching to
 * a tab in another window otherwise looks like nothing happened.
 */
export async function activateTab(tabId, windowId) {
  await chrome.tabs.update(tabId, { active: true });
  if (windowId != null) {
    await chrome.windows.update(windowId, { focused: true }).catch(() => {});
  }
}

const SEARCH_DISPOSITION = {
  current: 'CURRENT_TAB',
  newTab: 'NEW_TAB',
  newWindow: 'NEW_WINDOW',
};

/** Uses whatever the user set as their default engine in Brave. */
export async function webSearch(text, disposition) {
  const chromeDisposition = SEARCH_DISPOSITION[disposition] || 'NEW_TAB';
  try {
    await chrome.search.query({ text, disposition: chromeDisposition });
  } catch {
    const url = 'https://search.brave.com/search?q=' + encodeURIComponent(text);
    await openUrl(url, disposition);
  }
}

/** Routes a result row plus the modifier keys that were held down. */
export async function run(action) {
  const { result, disposition } = action;
  if (!result) return;

  if (result.type === SOURCE.SEARCH) {
    await webSearch(result.query, disposition);
    return;
  }

  // Switching to an existing tab beats opening a second copy of it, unless the
  // user explicitly asked for a new tab or window.
  if (result.tabId != null && disposition === 'current') {
    await activateTab(result.tabId, result.windowId);
    return;
  }

  await openUrl(result.url, disposition);
}
