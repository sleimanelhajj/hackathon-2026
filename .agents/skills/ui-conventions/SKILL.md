---
name: ui-conventions
description: Visual and interaction rules for the AI Workspace OS React app, covering tokens, components, calls to action, collapsible layout, copy, states and responsive checks. Use for any change to src/ UI, styling, layout or copy.
---

# UI conventions

Direction: **glass over sky** (decision #33). Frosted-glass work panes float over a cloudy-white-to-sky-blue ground. Layout, navigation and controls stay the standard ones, at the craft level of Linear and Attio. Glass marks the layers you work on (sidebar, widgets, panels, side panel, dialogs), never decoration. The Figma file shows the layouts: https://www.figma.com/design/XTZ64s5ZqMsk2ARqPw1C2h

## Tokens (in `src/index.css` `:root`)

- Sky: `--bg` (top, cloudy white) → `--bg-deep` (bottom, clear blue); `--surface-solid` when a pane must be opaque.
- Glass: a pane is `background: var(--glass); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);` with `border: 1px solid var(--glass-edge)` and `box-shadow: var(--shadow)`. Popovers and dialogs use `--glass-strong` and `--shadow-lift`. Fills inside panes: `--subtle`; row hover: `--hover`.
- Text: `--text`, `--text-2`, `--text-3`, all ≥4.5:1 on glass over any part of the sky.
- Sky blue `--accent` (`#0369a1`) for actions, the active nav item, links and the main data series.
- Amber-red `--signal` for urgency only: high priority, "waiting on you" counts, warnings. Text in it uses `--signal-text`; `--warning` maps to it.
- State: `--success`, `--danger` (+ `-subtle`). AI guesses: `--inferred`.
- Radius: `--radius-sm` 8, `--radius` 10, `--radius-lg` 16. Font: Inter Variable (self-hosted). Numbers in data use `.num` (tabular figures).
- Never hardcode a new hex in a component. Add a token instead. `tests/server/theme.test.mjs` fails if the palette, the glass or the contrast regress.
- Clouds drift only while a sync or AI run is working (`html[data-sky="busy"]`, set in `App.tsx`). Don't add other ambient motion.

## Components

| Use | Component / class |
|---|---|
| Next step / status message with one action | `Callout` (`tone`: default, ok, warn, danger) |
| Grouped content that can fold | `Panel` (stable `id`; state remembered in zustand + localStorage) |
| Buttons | `.btn` + `.btn-primary` / `-secondary` / `-ghost` / `-danger`, sizes `.btn-sm` / `.btn-lg` |
| Small status label | `.tag` with `data-tone` |
| Status dot | `.dot` with `data-tone` (ok, warn, error, busy) |
| Icons | `lucide-react` at 13–18px. No emoji, no unicode glyphs as icons |

## Interaction rules

1. **Every page answers "what do I do next?"** One `Callout` near the top with **one** primary button. Secondary options are secondary buttons.
2. **Collapsible by default.** The sidebar collapses to an icon rail (button or `[` key); sections are `Panel`s. Collapsed items keep a `title` tooltip and an `aria-label`.
3. **Destructive actions confirm inline** (see `ConfirmButton`): the first click arms, the second confirms, and the confirm label says what will happen ("Disconnect and delete imported email"). Avoid modals unless focus truly must be protected.
4. **Honest states:** loading = skeleton; syncing = spinner + "Syncing…" + polling; errors name the problem and the fix; sample data always shows its banner.
5. **Reduced motion is respected** (global rule in CSS). Motion is limited to sidebar width, panel open/close and the chevron.

## Copy

- Plain, short, second person: "Connect Gmail to see your dashboard".
- Buttons are verbs naming the result: "Sync now", "Review replies", "Remove sample data".
- No eyebrow/kicker labels above headings, no hype, no invented claims.

## Before you push

- Check 1440px and 390px widths: no horizontal scroll, no clipped text, callouts wrap cleanly.
- Keyboard: tab through nav, panel headers and buttons; focus ring visible.
- `npx tsc --noEmit` and `npm run build` pass.
- If Impeccable is installed: `impeccable detect --json src`. Inter is an accepted exception (see `.impeccable/config.json`).
