# Interactive paints — immediate-mode Paint API + input swallowing

Approved design (2026-07-14). RSBot/iDungeon-style interactive paints: a bot
draws a docked panel (typically over the chatbox) with tabs, buttons and
meters, and mouse input inside the panel goes to the panel — never through to
the game client underneath. First user: RockCrab.

## Paint API (immediate-mode)

`Paint.begin(ctx, {dock})` in `onPaint` returns a frame context; widget calls
draw AND report interaction; `p.end()` publishes the frame's hit regions to
the input layer. No widget lifecycle — state (active tab, collapse, queued
clicks) lives in a store keyed by widget id, cleared on script stop.

- Docks: `chatbox` (over the chat area, iDungeon-style), `topleft` (legacy
  status-box position), or an explicit rect. 765×503 client space.
- Widgets v1: `title(text, accent)` with collapse toggle (collapsed = title
  bar only), `tabs(names)` → active name, `text(line)`, `row(...cols)`,
  `bar(label, fraction, color?)`, `button(label)` → clicked this frame,
  `select(label, options, current)` → next option on click | null.
- Cursor-based vertical layout; theme constants (dark, 12px monospace,
  accent per bot). `drawStatusBox` remains for non-interactive bots.

## Input layer

Capture-phase listeners (`mousedown/mouseup/pointerdown/pointerup/click/
pointermove/contextmenu/wheel`) on the game canvas — the client binds level-0
bubble handlers (`canvas.onmousedown = …`, GameShell), so capture fires first
and `stopImmediatePropagation()+preventDefault()` swallows anything inside
the paint's regions. Outside regions events flow untouched. CSS-pixel →
765×503 logical mapping via getBoundingClientRect (matches getMousePos).
Clicks are queued per widget id and consumed by the next frame's widget call
(immediate-mode standard). Keyboard is untouched.

## RockCrab paint (first user)

Chatbox dock. Tabs: Overview (runtime, kills, XP/hr, food, HP bar, style +
quiver/casts line), Loot (loot counts, bank trips), Clues (solved + live leg
progress). Controls: Pause/Resume, Stop (ScriptRunner), combat-style select —
live: changing it mid-run updates STYLE + persists the setting; the existing
gear/banking/autocast tasks converge on the new style on their own.

## Testing

- Pure logic (`paintLogic.ts`): layout cursor, region hit-tests, widget state
  transitions, event→click queue routing, coordinate scaling — bun tests.
- DOM: capture listener swallows inside-region events, passes outside ones
  (happy-dom synthetic events).
- Live: screenshots of the RockCrab paint; playwright clicks its tabs and
  Pause and asserts the reaction.

## Out of scope (v1)

Dragging/resizing panels, popup dropdowns, text input in paint, per-widget
theming, multiple simultaneous panels, touch.
