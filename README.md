# Chromium Spotlight

A macOS Spotlight style launcher for Brave (and any other Chromium browser).
Press `⌘K`, start typing, and get fuzzy-ranked results from your bookmarks,
your history and your open tabs in one list.

```
┌──────── the page you are on ─────────┐
│                                      │
│   ╔══════════════════════════════╗   │
│   ║ 🔍 mdn js                    ║   │
│   ╟──────────────────────────────╢   │
│   ║ ▸ JavaScript | MDN           ║   │
│   ║   Rules of Hooks    Bookmark ║   │
│   ║   Figma – Untitled       Tab ║   │
│   ╚══════════════════════════════╝   │
│                                      │
└──────────────────────────────────────┘
```

## Install

1. Open `brave://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.

That is the whole install. There is no build step and no dependencies: it is
plain JavaScript and CSS, loaded as-is.

## Use

| Key | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | Open Spotlight (so does clicking the toolbar icon) |
| `↑` `↓` (or `Ctrl+P` / `Ctrl+N`) | Move through results |
| `return` | Open in the current tab, or switch to the tab if it is already open |
| `⌘ return` / `Ctrl+return` | Open in a new tab |
| `⇧ return` | Open in a new window |
| `tab` | Fill the input with the selected URL |
| `esc` | Dismiss |

Opening with an empty query shows your most recent and most used pages, so it
is useful before you type anything.

### Choosing what gets searched

The three toggles in the footer turn each source on and off. Click one, or
press `⌥1` / `⌥2` / `⌥3` (`Alt` on Windows and Linux). The choice is saved and
follows your profile.

Bookmarks and history are on out of the box; tabs are off. Bookmarks and
history are things you chose to keep or actually visited, whereas a wall of
open tabs tends to crowd them out. Turn tabs on if you live with twenty of
them and want to jump between them.

The coloured dot on each toggle is the same colour that source uses in the
rail down the left of every result, so the toggles double as the legend:

| | |
| --- | --- |
| Blue | an open tab, where `return` switches to it instead of loading it again |
| Amber | a bookmark |
| Grey | history |

A result that is more than one of those shows a stacked rail, because it is
one row rather than three. Grey is the exception: having a page open or
bookmarked already means you have been there, so history only gets its own
segment when it is the only thing a result is.

### If the shortcut does nothing

`⌘K` is already Brave's own "search from the address bar" shortcut, and Brave
will silently refuse to auto-assign a suggested key that collides with one of
its own. Check here first:

```
brave://extensions/shortcuts
```

Find Chromium Spotlight. If the box next to "Open Spotlight" is empty, click it and
press `⌘K` yourself. Assigned by hand it takes priority over Brave's shortcut
and over any web app that binds `⌘K` (Slack, Notion, Linear). Pick something
else there if you would rather keep `⌘K` as it is.

## How results are ranked

Matching is subsequence fuzzy matching, so `gmi` finds **G**\ **m**ail and
`mdn js` finds JavaScript | MDN. Multi-word queries are matched as independent
tokens in any order, against both the title and the URL.

A result's final score combines:

- how well the text matched, with bonuses for hits at word boundaries and for
  runs of consecutive characters,
- what kind of thing it is: open tabs rank above bookmarks, which rank above
  plain history,
- how recently you were there, decaying over about two weeks,
- how often you have been there.

A page that is bookmarked *and* in your history *and* currently open shows as
one row, not three.

## What it can and cannot cover

The panel is injected into the page you are on, which is what lets it float
centred over the content. Brave does not allow that on its own pages, so on
`brave://` URLs, the Chrome Web Store and the new tab page there is nothing to
inject into. Those fall back to the same panel in its own small window,
centred on the browser window. It has an OS title bar, which the extension
cannot remove, but it searches and behaves identically.

There is deliberately no toolbar popup. A popup can only ever be anchored
under the toolbar icon, so clicking the icon does exactly what the shortcut
does: the centred overlay on an ordinary page, the centred window elsewhere.

If you press `⌘K` on a tab that was already open when you installed or reloaded
the extension, the panel is injected on the spot, so it still works without a
page refresh.

## Privacy

Nothing leaves your browser. There are no network requests, no analytics and no
remote code. Favicons come from Brave's own local favicon cache via the
`favicon` permission, not from a third-party favicon service. "Search the web"
hands your query to whichever search engine you have set as default, and only
when you pick that row.

The permissions in `manifest.json` are there for:

| Permission | Why |
| --- | --- |
| `bookmarks`, `history`, `tabs` | the three things being searched |
| `favicon` | row icons from the local cache |
| `search` | the "Search the web" row uses your default engine |
| `scripting` | injecting the panel into tabs opened before install |
| `windows` (implied by `tabs`) | centring the fallback panel on your browser window |
| `<all_urls>` | the panel has to be able to appear over any page |
| `storage` | remembering which sources you switched on |

## Layout

```
manifest.json
src/
  background/
    service-worker.js   shortcut handling, message routing, index freshness
    index.js            builds and maintains the in-memory search index
    search.js           scores the index, folds in live tabs and deep history
    actions.js          open URL / switch tab / web search
    settings.js         which sources are on, cached and persisted
  shared/
    fuzzy.js            the matcher and the scorer, pure functions
    constants.js        every tunable weight and limit, in one place
  ui/
    spotlight.js        the panel: rendering, selection, keys
    spotlight.css.js    its CSS, as a string
  content/content.js    mounts the panel into a page, shields it from the page
  popup/                the same panel, as the toolbar fallback
icons/
```

`src/ui/spotlight.js` never touches a `chrome.*` API. It is handed a transport
object instead, which is how the injected overlay and the toolbar popup run the
same code.

### Changing the defaults

`DEFAULT_SOURCES` in `src/shared/constants.js` is what a fresh profile starts
with, before anyone touches the toggles:

```js
export const DEFAULT_SOURCES = {
  [SOURCE.BOOKMARK]: true,
  [SOURCE.HISTORY]: true,
  [SOURCE.TAB]: false,
};
```

A source that is off is skipped everywhere: never fetched, never indexed,
never ranked, and dropped from the placeholder text, which is built from this
list rather than hardcoded.

### Tuning the ranking

Every weight lives in `src/shared/constants.js`. `FUZZ` controls the per
character text scoring, `RANK` controls how text score, source, recency and
frequency are combined. Nothing else needs to change to retune results.
