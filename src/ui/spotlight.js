// The panel itself. Classic script, no chrome.* calls: everything privileged
// arrives through the `transport` object, which is what lets the content
// script and the toolbar popup share one implementation.
//
// globalThis.SpotlightUI.mount({ mode, transport }) -> controller

(function () {
  'use strict';

  var DEBOUNCE_MS = 60;

  // Width of the gutter the source rail lives in. The selection pill starts
  // after it so the rail's colours stay readable on the selected row.
  var RAIL_GUTTER = 11;

  // Locked down with !important so no page stylesheet can move, hide or
  // restyle the host element out from under us.
  var HOST_STYLE = {
    all: 'initial',
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    padding: '0',
    border: '0',
    'z-index': '2147483647',
    'color-scheme': 'light dark',
    contain: 'layout style',
    isolation: 'isolate',
    visibility: 'visible',
    opacity: '1',
    transform: 'none',
    filter: 'none',
    'pointer-events': 'auto',
  };

  // Stable order, so the rail reads the same way on every row: live, kept, past.
  var SOURCE_ORDER = ['tab', 'bookmark', 'history'];

  var GLYPHS = {
    glass:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">' +
      '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    bookmark:
      '<svg viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.2L5 21V4a1 1 0 0 1 1-1z"/></svg>',
    history:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.4l3.4 2"/></svg>',
    tab:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">' +
      '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/></svg>',
  };

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function svg(markup) {
    // Parsed rather than assigned so nothing here depends on innerHTML of
    // untrusted data. The markup is a constant defined just above.
    var wrapper = document.createElement('div');
    wrapper.innerHTML = markup;
    return wrapper.firstElementChild;
  }

  /** Bolds the characters the matcher actually landed on. Text stays text. */
  function highlight(text, positions) {
    var frag = document.createDocumentFragment();
    if (!positions || !positions.length) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }

    var marks = positions.slice().sort(function (a, b) {
      return a - b;
    });
    var cursor = 0;

    for (var i = 0; i < marks.length; i++) {
      var start = marks[i];
      if (start < cursor || start >= text.length) continue;

      var end = start + 1;
      while (i + 1 < marks.length && marks[i + 1] === end) {
        end++;
        i++;
      }

      if (start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, start)));
      var mark = el('span', 'sl-hl');
      mark.textContent = text.slice(start, end);
      frag.appendChild(mark);
      cursor = end;
    }

    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    return frag;
  }

  function initial(result) {
    var source = result.title || result.url || '?';
    try {
      source = new URL(result.url).hostname.replace(/^www\./, '');
    } catch (e) {
      /* not a URL, fall back to the title */
    }
    var match = source.match(/[a-z0-9]/i);
    return match ? match[0] : '?';
  }

  function isMac() {
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    return /mac/i.test(platform);
  }

  function dispositionFor(event) {
    if (event.metaKey || event.ctrlKey) return 'newTab';
    if (event.shiftKey) return 'newWindow';
    return 'current';
  }

  function mount(options) {
    var mode = options.mode || 'overlay';
    var transport = options.transport;
    var container = options.container || document.documentElement;

    // ---------------------------------------------------------- structure

    var host = el('div');
    host.setAttribute('data-spotlight-host', '');
    host.setAttribute('data-mode', mode);
    Object.keys(HOST_STYLE).forEach(function (prop) {
      host.style.setProperty(prop, HOST_STYLE[prop], 'important');
    });
    host.style.setProperty('display', 'none', 'important');

    var shadow = host.attachShadow({ mode: 'closed' });
    applyStyles(shadow);

    var backdrop = el('div', 'sl-backdrop');
    var stage = el('div', 'sl-stage');
    var panel = el('div', 'sl-panel');

    var search = el('div', 'sl-search');
    var glass = svg(GLYPHS.glass);
    glass.setAttribute('class', 'sl-glass');
    var input = el('input', 'sl-input');
    input.type = 'text';
    input.placeholder = 'Search…'; // replaced by the first response
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-autocomplete', 'list');
    search.appendChild(glass);
    search.appendChild(input);

    var list = el('ul', 'sl-results');
    list.setAttribute('role', 'listbox');
    var pill = el('div', 'sl-pill');

    var empty = el('div', 'sl-empty');
    empty.textContent = 'Your bookmarks, history and open tabs will show up here.';
    empty.hidden = true;

    var MOD = isMac() ? '⌘' : 'Ctrl';
    var ALT = isMac() ? '⌥' : 'Alt';

    var sources = el('div', 'sl-sources');
    var hints = el('div', 'sl-hints');
    hints.appendChild(hint('Open', ['return']));
    hints.appendChild(hint('New tab', [MOD, 'return']));
    hints.appendChild(hint('Dismiss', ['esc']));

    var footer = el('div', 'sl-footer');
    footer.appendChild(sources);
    footer.appendChild(hints);

    panel.appendChild(search);
    panel.appendChild(list);
    panel.appendChild(empty);
    panel.appendChild(footer);
    stage.appendChild(panel);
    shadow.appendChild(backdrop);
    shadow.appendChild(stage);
    container.appendChild(host);

    function hint(label, keys) {
      var wrap = el('span', 'sl-hint');
      keys.forEach(function (key) {
        var kbd = el('kbd');
        kbd.textContent = key;
        wrap.appendChild(kbd);
      });
      wrap.appendChild(document.createTextNode(label));
      return wrap;
    }

    /**
     * Draws the source toggles. They double as the legend for the rail: the
     * dot on each toggle is the colour that source uses in the row gutter.
     */
    function renderSources(list) {
      sources.textContent = '';
      if (!list) return;

      list.forEach(function (source, i) {
        var chip = el('div', 'sl-source');
        chip.dataset.id = source.id;
        chip.dataset.on = String(source.enabled);
        chip.setAttribute('role', 'switch');
        chip.setAttribute('aria-checked', String(source.enabled));
        chip.title = (source.enabled ? 'Stop searching ' : 'Search ') + source.label.toLowerCase() + '  (' + ALT + (i + 1) + ')';

        var dot = el('span', 'sl-dot');
        var label = el('span');
        label.textContent = source.label;
        chip.appendChild(dot);
        chip.appendChild(label);

        chip.addEventListener('mousedown', function (event) {
          event.preventDefault(); // keep focus in the input
        });
        chip.addEventListener('click', function () {
          toggleSource(source.id, !source.enabled);
        });

        sources.appendChild(chip);
      });
    }

    function applyStyles(root) {
      var css = globalThis.SPOTLIGHT_CSS || '';
      try {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        root.adoptedStyleSheets = [sheet];
      } catch (e) {
        // Very old engines only. A <style> inside a shadow root is still
        // scoped; it is just theoretically reachable by a page CSP.
        var style = document.createElement('style');
        style.textContent = css;
        root.appendChild(style);
      }
    }

    // ------------------------------------------------------------- state

    var open = mode === 'popup';
    var results = [];
    var selected = 0;
    var requestId = 0;
    var lastRendered = -1;
    var answered = false;
    var debounceTimer = null;
    var rows = [];
    var sourceList = [];

    // ------------------------------------------------------------ render

    function render() {
      list.textContent = '';
      list.appendChild(pill);
      rows = [];

      for (var i = 0; i < results.length; i++) {
        rows.push(list.appendChild(buildRow(results[i], i)));
      }

      // Before the first response there is nothing to say yet, so stay quiet
      // rather than flashing an empty state for one frame on every open.
      empty.hidden = results.length > 0 || !answered;
      updateSelection();
    }

    function buildRow(result, i) {
      var row = el('li', 'sl-row');
      row.setAttribute('role', 'option');
      row.dataset.index = String(i);

      var rail = result.rail || result.sources;
      if (rail?.length) row.appendChild(buildRail(rail));

      var icon = el('span', 'sl-icon');
      paintIcon(icon, result);

      var text = el('span', 'sl-text');
      var title = el('span', 'sl-title');
      title.appendChild(highlight(result.title || result.url || '', result.titlePositions));
      var sub = el('span', 'sl-sub');
      sub.textContent = result.subtitle || '';
      text.appendChild(title);
      text.appendChild(sub);

      row.appendChild(icon);
      row.appendChild(text);

      // Only tabs are labelled, because only a tab changes what return does:
      // it switches to the tab instead of loading the page again.
      if (result.type === 'tab') {
        var tag = el('span', 'sl-badge');
        tag.textContent = 'Tab';
        row.appendChild(tag);
      }

      row.addEventListener('mousemove', function () {
        if (selected !== i) {
          selected = i;
          updateSelection(true);
        }
      });
      row.addEventListener('mousedown', function (event) {
        event.preventDefault(); // keep focus in the input
      });
      row.addEventListener('click', function (event) {
        activate(i, dispositionFor(event));
      });

      return row;
    }

    /** One stacked segment per source, so an overlap is visible at a glance. */
    function buildRail(sources) {
      var rail = el('span', 'sl-rail');
      for (var i = 0; i < SOURCE_ORDER.length; i++) {
        if (sources.indexOf(SOURCE_ORDER[i]) === -1) continue;
        var seg = el('i');
        seg.dataset.source = SOURCE_ORDER[i];
        rail.appendChild(seg);
      }
      return rail;
    }

    function paintIcon(icon, result) {
      if (result.type === 'search') {
        icon.appendChild(svg(GLYPHS.glass));
        return;
      }

      var href = transport.faviconUrl ? transport.faviconUrl(result) : null;
      if (!href) {
        icon.appendChild(svg(GLYPHS[result.type] || GLYPHS.history));
        return;
      }

      var img = document.createElement('img');
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', function () {
        icon.textContent = initial(result);
      });
      img.src = href;
      icon.appendChild(img);
    }

    function updateSelection(skipScroll) {
      if (selected >= results.length) selected = Math.max(0, results.length - 1);
      for (var i = 0; i < rows.length; i++) {
        rows[i].setAttribute('aria-selected', String(i === selected));
      }

      var row = rows[selected];
      if (!row) {
        pill.dataset.visible = 'false';
        list.dataset.armed = 'false';
        return;
      }

      // The pill is placed from the row's own box, so it stays exact whatever
      // the row height or panel width happens to be.
      pill.style.width = row.offsetWidth - RAIL_GUTTER + 'px';
      pill.style.height = row.offsetHeight + 'px';
      pill.style.transform = 'translate(' + (row.offsetLeft + RAIL_GUTTER) + 'px,' + row.offsetTop + 'px)';
      pill.dataset.visible = 'true';

      // Arm the slide only after the first placement, so the pill does not
      // fly in from the corner when the list is first drawn.
      if (list.dataset.armed !== 'true') {
        requestAnimationFrame(function () {
          list.dataset.armed = 'true';
        });
      }

      if (skipScroll) return;

      // Deliberately not scrollIntoView: on a fixed overlay it will happily
      // scroll the page underneath as well.
      var top = row.offsetTop;
      var bottom = top + row.offsetHeight;
      if (top - 8 < list.scrollTop) list.scrollTop = Math.max(0, top - 8);
      else if (bottom + 8 > list.scrollTop + list.clientHeight) list.scrollTop = bottom + 8 - list.clientHeight;
    }

    // ------------------------------------------------------------- query

    function schedule() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(query, DEBOUNCE_MS);
    }

    function query() {
      debounceTimer = null;
      var id = ++requestId;
      var text = input.value;

      Promise.resolve(transport.query(text, id))
        .then(function (response) {
          // Fast typing means responses can land out of order. Anything older
          // than what is already on screen is dropped.
          if (!response || id <= lastRendered) return;
          lastRendered = id;
          absorb(response);
        })
        .catch(function (error) {
          console.warn('[spotlight] query failed', error);
        });
    }

    /** Everything the panel draws comes from the background in one payload. */
    function absorb(response) {
      answered = true;
      // The enabled sources are settings, not UI state, so the panel is told
      // what to show rather than tracking its own copy.
      if (response.placeholder) input.placeholder = response.placeholder;
      if (response.sources) {
        sourceList = response.sources;
        renderSources(sourceList);
      }
      results = response.results || [];
      selected = 0;
      render();
    }

    function toggleSource(id, enabled) {
      if (!transport.setSource) return;
      var reqId = ++requestId;
      Promise.resolve(transport.setSource(id, enabled, input.value, reqId))
        .then(function (response) {
          if (!response || reqId <= lastRendered) return;
          lastRendered = reqId;
          absorb(response);
        })
        .catch(function (error) {
          console.warn('[spotlight] could not change sources', error);
        });
    }

    // ------------------------------------------------------------ actions

    function activate(i, disposition) {
      var result = results[i];
      if (!result) return;
      // Dispatch before closing: in popup mode close() ends the document, and
      // a torn-down popup never gets to send its message.
      var running = Promise.resolve(transport.run({ result: result, disposition: disposition }));
      running.catch(function (error) {
        console.warn('[spotlight] action failed', error);
      });
      close();
    }

    function move(delta) {
      if (!results.length) return;
      selected = (selected + delta + results.length) % results.length;
      updateSelection();
    }

    /**
     * Called from a capturing window listener so page shortcuts never see the
     * keystroke. Returns true when the panel consumed the event.
     */
    function handleKey(event) {
      if (!open) return false;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          close();
          return true;
        case 'ArrowDown':
          event.preventDefault();
          move(1);
          return true;
        case 'ArrowUp':
          event.preventDefault();
          move(-1);
          return true;
        case 'Enter':
          event.preventDefault();
          activate(selected, dispositionFor(event));
          return true;
        case 'Tab':
          event.preventDefault();
          if (results[selected] && results[selected].url) {
            input.value = results[selected].url;
            input.setSelectionRange(input.value.length, input.value.length);
            schedule();
          }
          return true;
        default:
          break;
      }

      // Alt+number toggles a source. Not Cmd+number: the browser owns that
      // one for switching tabs and a page cannot intercept it.
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.code && /^Digit[1-9]$/.test(event.code)) {
        var slot = Number(event.code.slice(5)) - 1;
        if (sourceList[slot]) {
          event.preventDefault();
          toggleSource(sourceList[slot].id, !sourceList[slot].enabled);
          return true;
        }
      }

      // Emacs-style navigation, which is muscle memory for a lot of people.
      if (event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === 'n') {
          event.preventDefault();
          move(1);
          return true;
        }
        if (event.key === 'p') {
          event.preventDefault();
          move(-1);
          return true;
        }
      }

      return false;
    }

    // ------------------------------------------------------- open / close

    function show() {
      if (open) {
        input.select();
        return;
      }
      open = true;
      host.style.setProperty('display', 'block', 'important');
      input.value = '';
      results = [];
      lastRendered = -1;
      answered = false;
      list.dataset.armed = 'false';
      render();
      input.focus({ preventScroll: true });
      query();
    }

    function close() {
      if (!open || mode === 'popup') {
        if (mode === 'popup' && transport.close) transport.close();
        return;
      }
      open = false;
      host.style.setProperty('display', 'none', 'important');
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      input.blur();
      if (transport.close) transport.close();
    }

    function toggle() {
      if (open) close();
      else show();
    }

    // ------------------------------------------------------------ wiring

    input.addEventListener('input', schedule);
    backdrop.addEventListener('mousedown', function (event) {
      event.preventDefault();
      close();
    });
    stage.addEventListener('mousedown', function (event) {
      if (event.target === stage) {
        event.preventDefault();
        close();
      }
    });

    // The pill is positioned in pixels, so it has to be replaced when the
    // panel changes width.
    window.addEventListener('resize', function () {
      if (open) updateSelection(true);
    });

    if (mode === 'popup') {
      host.style.setProperty('display', 'block', 'important');
      render();
      input.focus({ preventScroll: true });
      query();
    }

    return {
      show: show,
      close: close,
      toggle: toggle,
      handleKey: handleKey,
      isOpen: function () {
        return open;
      },
      destroy: function () {
        host.remove();
      },
    };
  }

  globalThis.SpotlightUI = { mount: mount };
})();
