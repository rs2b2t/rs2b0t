[Manual](../README.md) › [Scripting API](../API.md) › Paint

# Paint

The immediate-mode overlay HUD a bot draws from `onPaint`. Every widget is
redrawn each frame; the only retained state is scroll offsets, the active tab
and the collapse flag, which live in `paintState` keyed by widget id.

```ts
override onPaint(ctx: CanvasRenderingContext2D): void {
    const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c8a2ff' });
    p.title(`MyBot — ${this.status}`);
    const tab = p.tabs('mybot', ['Queue', 'Session']);
    ...
    p.end();
}
```

`begin` and `end` bracket the frame: `end` publishes the hit regions that make
clicks and wheel notches land on widgets instead of the game behind them.

## Widgets

| Method | Draws |
|---|---|
| `title(text)` | title bar with the collapse toggle; call it first |
| `tabs(id, names)` | tab strip; returns the active name |
| `text(line, color?)` | one line, clipped to the panel |
| `row(...cols)` | evenly split columns, each clipped to its slot |
| `cells(cells)` | weighted columns, each with its own colour |
| `wrap(text, color?, indent?)` | one string spilled onto indented continuation lines |
| `list(id, lines, rows, opts?)` | scrollable window of `rows` lines |
| `fill(id, lines, opts?)` | `list` sized to the panel height that is left |
| `grid(id, lines, columns, opts?)` | `fill` laid `columns` across |
| `bar(label, fraction, color?)` | labelled progress bar |
| `buttons(items)` | button row; returns the clicked id or null |
| `select(id, label, options, current)` | one-click cycle through options |
| `stepper(id, label, options, current)` | `◀ label: current ▶` |
| `gap(px?)` | vertical space |
| `cols()` | characters of monospace text the panel fits |

## Nothing draws outside the panel

Every text widget clips to the panel — a long line ends in `…` rather than
painting across the game view. `cells` clips each column into its own slot and
leaves a character of gutter, so a clipped column never runs into the next.

Use `wrap` when the full string matters (a blocking reason, an error) and
clipping would hide the part you need. Use `cols()` to wrap text yourself
before handing it to a list.

```ts
p.cells([
    { text: quest.name, weight: 3, color: '#ffffff' },
    { text: quest.reason, weight: 2, color: '#8a919a' }
]);
p.wrap(this.stepDesc);
```

## Scrolling lists

`list` and `fill` take `PaintLine[]` — bare strings, or `{ text, color }` for
per-row colour. Both register a scroll region, so the wheel over the list moves
it by `WHEEL_ROWS` and the canvas swallows the event instead of zooming the
game. A list longer than its window draws a thumb on the right edge and a
`12–17 of 61` counter beneath it.

```ts
p.fill('queue', rows.map(r => ({ text: r.label, color: r.colour })), {
    reserve: 26,                     // pixels held back for the button row
    focus: rows.findIndex(r => r.running)
});
```

`focus` keeps one row on screen. Scrolling detaches the list so the user keeps
control; a **change** of focus row re-attaches it, so the queue follows the bot
onto the next quest after you have finished reading.

`fill` sizes itself to the panel height left below the cursor, minus `reserve`.
Reserve whatever is drawn after it, or the buttons land on top of the last row.

`footer` rides along with the scroll counter rather than costing a row of its
own — `13–20 of 61 · QP 44 · done 12/61 · stuck 5`.

## Grids

The chatbox dock is short and wide: a single column shows four entries and
leaves half the panel empty. `grid` lays the same list `columns` across,
reading left to right, and holds that many times the entries in the same
height. The wheel still moves a full row, so the reading order never breaks,
and `focus` still takes an entry index rather than a row.

```ts
p.grid('queue', lines, 2, { reserve: 26, focus: runningIndex, footer: summary });
```

## Docking

`dock` is `'chatbox'` (506×150 over the chat area, the default), `'topleft'`,
or an explicit `{ x, y, w, h }`. The chatbox dock never covers the game view,
which is why the paint scrolls rather than growing.

## See also

- [Bots](api-bots.md) — the `onPaint` hook and the rest of the bot surface
- [Compare path paint](../how-to/compare-path-paint.md) — the webwalk path overlay
