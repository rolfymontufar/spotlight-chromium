// Entry point: owns the shortcut, routes messages, keeps the index warm.

import { MSG } from '../shared/constants.js';
import { runSearch } from './search.js';
import { run, currentBrowserTab } from './actions.js';
import { getIndex, invalidate, recordVisit, forgetUrls } from './index.js';
import { setSource } from './settings.js';

const UI_FILES = ['src/ui/spotlight.css.js', 'src/ui/spotlight.js', 'src/content/content.js'];

// Pages where no extension content script may run, so the overlay cannot exist.
const BLOCKED = /^(chrome|brave|edge|about|devtools|view-source|chrome-extension|moz-extension):/i;
const BLOCKED_HOSTS = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

function canInject(url) {
  return !!url && !BLOCKED.test(url) && !BLOCKED_HOSTS.test(url);
}

// ---------------------------------------------------------------- surface

const PANEL_PATH = 'src/popup/popup.html';
const PANEL_W = 660;
const PANEL_H = 470;

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-spotlight') return;
  await summon(await currentBrowserTab());
});

// There is no default_popup in the manifest, so this always fires and the
// icon behaves exactly like the shortcut. Nothing can appear anchored to the
// toolbar any more.
chrome.action.onClicked.addListener(async () => {
  await summon(await currentBrowserTab());
});

async function summon(tab) {
  if (tab?.id != null && canInject(tab.url)) {
    if (await toggleOverlay(tab.id)) return;
    console.info('[spotlight] overlay injection failed on', tab.url, '- using the window fallback');
  } else {
    console.info('[spotlight] no page to inject into', tab?.url, '- using the window fallback');
  }
  await openCenteredWindow();
}

/** @returns {Promise<boolean>} whether the overlay took the shortcut. */
async function toggleOverlay(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: MSG.TOGGLE });
    return true;
  } catch {
    // No content script yet: the page was open before the extension was
    // installed or reloaded. Inject once, then try again.
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: UI_FILES });
    await chrome.tabs.sendMessage(tabId, { type: MSG.TOGGLE });
    return true;
  } catch (error) {
    console.warn('[spotlight] could not inject the overlay', error);
    return false;
  }
}

/**
 * brave:// pages, the Web Store and the new tab page cannot host an injected
 * overlay. They get a real window instead of a toolbar popup, centred on the
 * browser window, because a toolbar popup can only ever sit in the corner.
 */
async function openCenteredWindow() {
  const existing = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] }).catch(() => []);
  for (const win of existing) {
    if (win.tabs?.some((t) => t.url?.includes(PANEL_PATH))) {
      await chrome.windows.update(win.id, { focused: true });
      return;
    }
  }

  const parent = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const bounds = {};
  if (parent && parent.width && parent.height) {
    bounds.left = Math.round(parent.left + (parent.width - PANEL_W) / 2);
    bounds.top = Math.round(parent.top + (parent.height - PANEL_H) / 2);
  }

  await chrome.windows.create({
    url: chrome.runtime.getURL(PANEL_PATH),
    type: 'popup',
    width: PANEL_W,
    height: PANEL_H,
    focused: true,
    ...bounds,
  });
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined;

  switch (message.type) {
    case MSG.QUERY:
      runSearch(message.text)
        .then((payload) => sendResponse({ ok: true, requestId: message.requestId, ...payload }))
        .catch((error) => {
          console.error('[spotlight] query failed', error);
          sendResponse({ ok: false, requestId: message.requestId, results: [] });
        });
      return true;

    case MSG.SET_SOURCE:
      // Turning a source on or off changes what the index should even
      // contain, so it is thrown away and rebuilt on the query that follows.
      setSource(message.source, message.enabled)
        .then(() => {
          invalidate();
          return runSearch(message.text || '');
        })
        .then((payload) => sendResponse({ ok: true, requestId: message.requestId, ...payload }))
        .catch((error) => {
          console.error('[spotlight] could not change sources', error);
          sendResponse({ ok: false, requestId: message.requestId, results: [] });
        });
      return true;

    case MSG.RUN:
      run(message.action)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          console.error('[spotlight] action failed', error);
          sendResponse({ ok: false });
        });
      return true;

    default:
      return undefined;
  }
});

// ---------------------------------------------------------------- freshness

chrome.history.onVisited.addListener((item) => recordVisit(item));
chrome.history.onVisitRemoved.addListener((removed) => {
  if (removed.allHistory) invalidate();
  else forgetUrls(removed.urls || []);
});

for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onImportEnded']) {
  chrome.bookmarks[event]?.addListener(() => invalidate());
}

chrome.runtime.onInstalled.addListener(() => {
  getIndex().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  getIndex().catch(() => {});
});
