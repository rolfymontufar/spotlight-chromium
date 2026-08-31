// The fallback surface, used on brave:// pages, the Web Store and the new tab
// page, where no content script may run. Same panel, different plumbing: here
// it fills its own centred window instead of floating over a page.

(function () {
  'use strict';

  var MSG = { QUERY: 'spotlight:query', RUN: 'spotlight:run', SET_SOURCE: 'spotlight:set-source' };

  var panel = globalThis.SpotlightUI.mount({
    mode: 'popup',
    container: document.body,
    transport: {
      query: function (text, requestId) {
        return chrome.runtime.sendMessage({ type: MSG.QUERY, text: text, requestId: requestId });
      },
      run: function (action) {
        // Fire and forget: this window is about to close, and awaiting the
        // reply would race its teardown.
        chrome.runtime.sendMessage({ type: MSG.RUN, action: action }).catch(function () {});
        window.close();
        return Promise.resolve();
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
        window.close();
      },
    },
  });

  // The panel does not bind keys itself, so that the injected overlay can put
  // them behind a capturing guard. Nothing to guard against here, but the
  // wiring still has to exist or the arrow keys do nothing.
  window.addEventListener(
    'keydown',
    function (event) {
      panel.handleKey(event);
    },
    true
  );

  // Dismiss on focus loss, the way the overlay does. Armed on a delay: a
  // freshly created window can see a stray blur before it settles, and
  // closing on that one would make the panel look like it never opened.
  var armed = false;
  setTimeout(function () {
    armed = true;
  }, 400);
  window.addEventListener('focus', function () {
    armed = true;
  });
  window.addEventListener('blur', function () {
    if (armed) window.close();
  });
})();
