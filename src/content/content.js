// Mounts the overlay into the page and shields it from the page.
//
// Classic script. Runs in the isolated world, so `SpotlightUI` and
// `SPOTLIGHT_CSS` come from the two files listed before this one in the
// manifest, not from the page.

(function () {
  'use strict';

  // executeScript may inject this file into a tab that already has it, when a
  // previous sendMessage looked like it failed but did not.
  if (globalThis.__spotlightMounted) return;
  globalThis.__spotlightMounted = true;

  var MSG = {
    QUERY: 'spotlight:query',
    RUN: 'spotlight:run',
    TOGGLE: 'spotlight:toggle',
    SET_SOURCE: 'spotlight:set-source',
  };

  var panel = globalThis.SpotlightUI.mount({
    mode: 'overlay',
    container: document.documentElement,
    transport: {
      query: function (text, requestId) {
        return chrome.runtime.sendMessage({ type: MSG.QUERY, text: text, requestId: requestId });
      },
      run: function (action) {
        return chrome.runtime.sendMessage({ type: MSG.RUN, action: action });
      },
      setSource: function (source, enabled, text, requestId) {
        return chrome.runtime.sendMessage({
          type: MSG.SET_SOURCE,
          source: source,
          enabled: enabled,
          text: text,
          requestId: requestId,
        });
      },
      faviconUrl: function (result) {
        if (result.favIconUrl && /^https?:/i.test(result.favIconUrl)) return result.favIconUrl;
        if (!result.url) return null;
        return chrome.runtime.getURL('_favicon/?pageUrl=' + encodeURIComponent(result.url) + '&size=32');
      },
      close: function () {
        setKeyGuard(false);
      },
    },
  });

  // ---------------------------------------------------------------- keys

  // Pages listen for bare keys all the time: GitHub grabs "s", Gmail grabs
  // "j" and "k". Because a closed shadow root retargets events to the host,
  // those listeners would otherwise see everything typed into the panel.
  //
  // So while the panel is open, a capturing window listener handles the key
  // first and then stops it dead. stopImmediatePropagation does not
  // preventDefault, so ordinary characters still reach the focused input.
  var guarding = false;

  function onKey(event) {
    if (!panel.isOpen()) return;
    if (event.type === 'keydown') panel.handleKey(event);
    event.stopImmediatePropagation();
  }

  function setKeyGuard(on) {
    if (on === guarding) return;
    guarding = on;
    var method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('keydown', onKey, true);
    window[method]('keyup', onKey, true);
    window[method]('keypress', onKey, true);
  }

  // Losing the window means the user went somewhere else. Spotlight dismisses
  // itself in that situation and so do we.
  window.addEventListener('blur', function () {
    if (panel.isOpen()) panel.close();
  });

  // ------------------------------------------------------------- messages

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || message.type !== MSG.TOGGLE) return undefined;
    panel.toggle();
    setKeyGuard(panel.isOpen());
    sendResponse({ ok: true, open: panel.isOpen() });
    return false;
  });
})();
