// Classic script (content scripts cannot be ES modules), so this hangs off a
// global. The CSS ships as a string because it is applied through a
// constructed stylesheet: a strict page CSP can block an injected <style> or
// <link>, but it cannot touch adoptedStyleSheets built in the isolated world.

globalThis.SPOTLIGHT_CSS = `
:host {
  --sl-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --sl-mono: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;

  --sl-panel: rgba(249, 249, 251, 0.78);
  --sl-solid: #f5f5f7;
  --sl-ink: #0e0f12;
  --sl-dim: #6a6e76;
  --sl-rule: rgba(14, 15, 18, 0.075);
  --sl-tint: rgba(14, 15, 18, 0.055);
  --sl-accent: #2c6bed;
  --sl-on-accent: #ffffff;

  /* The source rail. A semantic ramp: live, kept, past. */
  --sl-tab: #2c6bed;
  --sl-bookmark: #de8e19;
  --sl-history: #a0a6b0;

  --sl-edge: rgba(255, 255, 255, 0.60);
  --sl-hairline: rgba(14, 15, 18, 0.13);
  --sl-shadow:
    0 32px 64px -16px rgba(9, 11, 20, 0.34),
    0 12px 28px -12px rgba(9, 11, 20, 0.22),
    0 2px 6px -2px rgba(9, 11, 20, 0.10);
  --sl-veil: rgba(10, 12, 18, 0.14);
}

@media (prefers-color-scheme: dark) {
  :host {
    --sl-panel: rgba(28, 29, 32, 0.82);
    --sl-solid: #1c1d20;
    --sl-ink: #f2f3f5;
    --sl-dim: #8b919b;
    --sl-rule: rgba(255, 255, 255, 0.085);
    --sl-tint: rgba(255, 255, 255, 0.075);
    --sl-accent: #4a85ff;

    --sl-tab: #4a85ff;
    --sl-bookmark: #f0a93a;
    --sl-history: #6e747e;

    --sl-edge: rgba(255, 255, 255, 0.10);
    --sl-hairline: rgba(0, 0, 0, 0.62);
    --sl-shadow:
      0 32px 64px -16px rgba(0, 0, 0, 0.66),
      0 12px 28px -12px rgba(0, 0, 0, 0.46),
      0 2px 6px -2px rgba(0, 0, 0, 0.30);
    --sl-veil: rgba(0, 0, 0, 0.34);
  }
}

/* ------------------------------------------------------------- structure */

.sl-backdrop {
  position: absolute;
  inset: 0;
  background: var(--sl-veil);
  animation: sl-veil 140ms ease-out;
}

.sl-stage {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px;
  box-sizing: border-box;
  pointer-events: none;
}

.sl-panel {
  pointer-events: auto;
  width: 620px;
  max-width: 100%;
  box-sizing: border-box;
  font-family: var(--sl-sans);
  color: var(--sl-ink);
  background: var(--sl-panel);
  -webkit-backdrop-filter: blur(34px) saturate(175%);
  backdrop-filter: blur(34px) saturate(175%);
  border-radius: 22px;
  box-shadow:
    var(--sl-shadow),
    0 0 0 1px var(--sl-hairline),
    inset 0 1px 0 var(--sl-edge);
  overflow: hidden;
  animation: sl-enter 170ms cubic-bezier(0.16, 0.84, 0.28, 1);
}

/* Without backdrop-filter the translucency reads as dirt, so go solid. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .sl-panel { background: var(--sl-solid); }
}

/* ------------------------------------------------------------ query field */

.sl-search {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 0 20px;
  height: 60px;
}

.sl-glass {
  flex: none;
  width: 19px;
  height: 19px;
  color: var(--sl-dim);
  opacity: 0.75;
}

.sl-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  padding: 0;
  margin: 0;
  background: transparent;
  color: var(--sl-ink);
  font-family: inherit;
  font-size: 21px;
  font-weight: 400;
  letter-spacing: -0.016em;
  line-height: 1;
  caret-color: var(--sl-accent);
}

.sl-input::placeholder {
  color: var(--sl-dim);
  opacity: 0.85;
}

.sl-input::-webkit-search-cancel-button { display: none; }

/* ---------------------------------------------------------------- results */

.sl-results {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 8px;
  max-height: 322px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-top: 1px solid var(--sl-rule);
  scrollbar-width: thin;
  scrollbar-color: var(--sl-tint) transparent;
}

.sl-results:empty { display: none; }

/*
 * One pill that slides between rows rather than a highlight that blinks from
 * one to the next. Holding the arrow key then reads as continuous travel,
 * which is the whole point of a keyboard launcher.
 */
.sl-pill {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 14px;
  background: var(--sl-accent);
  pointer-events: none;
  opacity: 0;
}

.sl-results[data-armed="true"] .sl-pill {
  transition:
    transform 140ms cubic-bezier(0.22, 0.9, 0.24, 1),
    width 140ms cubic-bezier(0.22, 0.9, 0.24, 1),
    opacity 90ms linear;
}

.sl-pill[data-visible="true"] { opacity: 1; }

.sl-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 11px;
  height: 46px;
  /* 11px rail gutter + 12px inner padding. The pill starts after the rail. */
  padding: 0 14px 0 23px;
  border-radius: 14px;
  cursor: default;
  user-select: none;
}

.sl-row:hover:not([aria-selected="true"]) { background: var(--sl-tint); }
.sl-row[aria-selected="true"] { color: var(--sl-on-accent); }

/* ------------------------------------------------------------ source rail */

/*
 * Three or fewer stacked segments, one per source. A page that is bookmarked,
 * visited and currently open is a single row here, so the rail is the only
 * thing that can say so. It sits in the gutter, outside the selection pill,
 * so its colours survive selection.
 */
.sl-rail {
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 22px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 2px;
  overflow: hidden;
}

.sl-rail > i {
  flex: 1 1 0;
  border-radius: 2px;
  background: var(--sl-history);
}

.sl-rail > i[data-source="tab"] { background: var(--sl-tab); }
.sl-rail > i[data-source="bookmark"] { background: var(--sl-bookmark); }
.sl-rail > i[data-source="history"] { background: var(--sl-history); }

/* --------------------------------------------------------------- row body */

.sl-icon {
  flex: none;
  width: 19px;
  height: 19px;
  border-radius: 5px;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--sl-tint);
  color: var(--sl-dim);
  font-size: 10px;
  font-weight: 650;
  text-transform: uppercase;
}

.sl-icon img { width: 100%; height: 100%; object-fit: contain; }
.sl-icon svg { width: 14px; height: 14px; }

.sl-row[aria-selected="true"] .sl-icon {
  background: rgba(255, 255, 255, 0.22);
  color: var(--sl-on-accent);
}

.sl-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.sl-title {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 500;
  letter-spacing: -0.004em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
 * URLs are code, not prose. Monospace makes hostnames scan in one glance and
 * keeps the second line from competing with the title.
 */
.sl-sub {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--sl-mono);
  font-size: 11px;
  letter-spacing: -0.01em;
  color: var(--sl-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sl-row[aria-selected="true"] .sl-sub { color: rgba(255, 255, 255, 0.74); }

.sl-hl { font-weight: 700; }
.sl-sub .sl-hl { font-weight: 600; }

/* Only tabs get a word, because only tabs change what return does. */
.sl-badge {
  flex: none;
  font-family: var(--sl-mono);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--sl-tint);
  color: var(--sl-dim);
}

.sl-row[aria-selected="true"] .sl-badge {
  background: rgba(255, 255, 255, 0.20);
  color: var(--sl-on-accent);
}

/* ---------------------------------------------------------------- states */

.sl-empty {
  padding: 30px 24px 34px;
  text-align: center;
  font-size: 13px;
  line-height: 1.5;
  color: var(--sl-dim);
  border-top: 1px solid var(--sl-rule);
}

/* ---------------------------------------------------------------- footer */

.sl-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 38px;
  padding: 0 9px 0 7px;
  border-top: 1px solid var(--sl-rule);
  font-size: 10.5px;
  color: var(--sl-dim);
}

.sl-hints {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-right: 5px;
}

.sl-hint {
  display: flex;
  align-items: center;
  gap: 5px;
}

/*
 * The source toggles are also the legend for the rail: same three colours,
 * named. One element, so the colour coding never needs explaining twice.
 */
.sl-sources {
  display: flex;
  align-items: center;
  gap: 2px;
}

.sl-source {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  border-radius: 7px;
  cursor: default;
  user-select: none;
  color: var(--sl-ink);
  transition: background-color 90ms linear;
}

.sl-source:hover { background: var(--sl-tint); }

.sl-source[data-on="false"] { color: var(--sl-dim); }

.sl-dot {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: var(--sl-history);
  transition: box-shadow 90ms linear, background-color 90ms linear;
}

.sl-source[data-id="tab"] .sl-dot { background: var(--sl-tab); }
.sl-source[data-id="bookmark"] .sl-dot { background: var(--sl-bookmark); }
.sl-source[data-id="history"] .sl-dot { background: var(--sl-history); }

/* Off reads as hollow rather than merely faded, so it survives a glance. */
.sl-source[data-on="false"] .sl-dot {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--sl-dim);
  opacity: 0.7;
}

kbd {
  font-family: var(--sl-mono);
  font-size: 9.5px;
  line-height: 1;
  min-width: 8px;
  text-align: center;
  padding: 3px 5px;
  border-radius: 5px;
  background: var(--sl-tint);
  color: inherit;
}

/* ------------------------------------------------------------- keyframes */

@keyframes sl-veil {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes sl-enter {
  from { opacity: 0; transform: translateY(-6px) scale(0.975); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .sl-panel,
  .sl-backdrop { animation: none; }
  .sl-results[data-armed="true"] .sl-pill { transition: none; }
}

/* -------------------------------------------------- popup fallback mode */
/* Reached only on brave:// pages, where nothing may float over the page. */

:host([data-mode="popup"]) .sl-backdrop { display: none; }
:host([data-mode="popup"]) .sl-stage { padding: 0; }

:host([data-mode="popup"]) .sl-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  box-shadow: none;
  animation: none;
  background: var(--sl-solid);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

:host([data-mode="popup"]) .sl-results {
  flex: 1 1 auto;
  max-height: none;
}
`;
