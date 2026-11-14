---
name: glassmorphism
description: How to build frosted-glass surfaces in AI Workspace OS (white glass over soft coloured light) with the project's CSS tokens, not Tailwind. Use when adding or restyling a card, panel, popover, menu, dialog, tooltip or any floating element, or when something "should look like glass".
---

# Glass surfaces in AI Workspace OS

The app's look is **white frosted glass floating over soft blue, lavender and pink light, dark blue for actions**
(decision #39, see the `ui-conventions` skill). Glass marks the layers you work on (sidebar, widgets, panels, the side panel, dialogs and
dropdown menus). It is never decoration on its own.

Styles live in `src/index.css`. There is no Tailwind in this project; use the tokens below, never hardcoded colours.
`tests/server/theme.test.mjs` fails if the glass, the palette or the contrast regress, so run `npm test` after changes.

## The tokens

| Token | What it is |
|---|---|
| `--glass` | Translucent white for panes (sidebar, widgets, cards) |
| `--glass-strong` | Nearly opaque white for things closer to you: menus, popovers, dialogs, tooltips |
| `--glass-edge` | The bright 1px edge that makes glass read as glass |
| `--glass-sheen` | The soft top-left highlight every pane carries (`background-image`) |
| `--glow-blue`, `--glow-lavender`, `--glow-pink` | The soft coloured light behind the glass (only in the page background, `body::before`) |
| `--radius-xl` | Corners of the big floating panels (sidebar, edit panel) |
| `--blur` | The frosting (`backdrop-filter`), for floating layers only |
| `--shadow` | Pane depth, including the white top-edge highlight |
| `--shadow-lift` | Deeper shadow for floating things, same top-edge highlight |
| `--surface-solid` | Plain white, for when a pane must be opaque |

Under `prefers-reduced-transparency: reduce` the glass tokens switch to solid white and the blur turns off
automatically. Don't override that.

## Three strengths

**Pane** (sits on the page): widgets, panels, cards, the sidebar.
```css
.my-pane {
  background: var(--glass);
  background-image: var(--glass-sheen);
  border: 1px solid var(--glass-edge);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}
```
Or just add the existing `surface` class to the element. **No `backdrop-filter` on panes** (decision #40): the
light behind them is already smooth, so the blur is invisible but re-runs on every scroll, drag and resize frame.

**Floating** (sits above panes): dropdown menus, popovers, the widget settings box, tooltips, dialogs.
```css
.my-popover {
  background: var(--glass-strong);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  border: 1px solid var(--glass-edge);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lift);
}
```

**Inside a pane** (rows, chips, fills): no second layer of glass. Nested blur looks muddy and costs performance.
Use `--subtle` for fills, `--hover` for row hover and `--border` for dividers.

## Readability

- Text on glass uses `--text`, `--text-2` or `--text-3` only. They're checked at 4.5:1 or better against glass over
  the base ground and over every coloured glow. Never put text in a series or accent fill colour.
- Dark blue (`--accent`) is for actions and selection; amber (`--signal`) is only for warnings and things waiting on
  the user, with text in `--signal-text`.
- Long reading (an email body, a table) belongs on `--surface-solid` or `--glass-strong`, not `--glass`: the less
  see-through, the easier to read.

## Performance

`backdrop-filter` re-blurs whatever is behind it on every frame.
- Blur only floating layers (menus, popovers, the settings box, dialogs, the open phone sidebar). Panes never blur.
- Never `background-attachment: fixed`; the page's light lives in the fixed `body::before` layer.
- Charts: `ResponsiveContainer` gets a `debounce`, series get `isAnimationActive={false}`.
- Don't stack glass inside glass.
- Don't animate size or position of large glass areas. Fades and small transforms are fine.
- Nothing moves behind the glass except the background glows, and those drift only while a sync or AI run is
  working (`html[data-sky="busy"]`).

## Checklist

- [ ] Uses `--glass` / `--glass-strong`, `--glass-edge` and `--shadow` / `--shadow-lift`; `--blur` (with the `-webkit-` line) only on floating layers
- [ ] No hardcoded colours, no Tailwind classes
- [ ] No glass nested inside glass
- [ ] Text uses the text tokens and stays readable
- [ ] Corners use `--radius`, `--radius-lg` or `--radius-sm`
- [ ] `npm test` passes (theme, contrast and UI rules)

Inspired by the "glassmorphism" skill in github.com/ainergiz/design-inspirations (pattern ideas only; rewritten for
this project's tokens and light theme).
