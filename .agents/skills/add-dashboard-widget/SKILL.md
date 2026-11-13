---
name: add-dashboard-widget
description: Add a metric, list, or chart to the AI Workspace OS dashboard so it is computed from real synced data, explains how it was counted, and links to its source. Use when asked to show new information on the dashboard.
---

# Add a dashboard widget

## Principle

A widget is **data the server derives** plus **a Panel that shows it**. No widget may show a number the data can't support. If the source isn't connected, show an honest empty state with a call to action ("Connect Google Calendar"), never a guess.

Every fact is one of:

| Kind | Meaning | Example |
|---|---|---|
| observed | read directly from the provider | an email's date |
| derived | computed by code | days since you last replied |
| inferred | predicted by a model (not used yet; label it clearly when added) | "likely a sales lead" |
| unknown | not enough evidence | invoice paid? (email can't prove it) |

## Steps

1. **Compute it on the server** in `server/dashboard.js` (`buildDashboard`). Keep it deterministic and bounded to the dashboard window (`windowDays`). Exclude automated senders with the `AUTOMATED` regex when counting people.
2. **Return plain JSON** and extend the `Dashboard` type in `src/lib/api.ts`.
3. **Render it** in `src/pages/DashboardPage.tsx` inside a `<Panel id="unique-id" title=… subtitle=…>`:
   - The `id` must be stable: it's the key for the remembered collapsed state.
   - The subtitle says what's included ("Last 14 days", "people only").
   - Add `<HowCounted>` when the rule isn't obvious.
   - Rows link to the source (`link`), or are marked as sample.
4. **States:** loading (skeleton is handled at page level), empty (a friendly sentence, not "No data"), error (the page-level Callout).
5. **If it calls for action** (something is waiting or overdue), consider adding or adjusting the top `Callout` with one primary button that scrolls to the panel via `scrollTo(id)`. That function also opens a folded panel.
6. **Charts:** use `recharts` with the CSS tokens `--chart-in` and `--chart-out` (add new tokens to `:root` in `src/index.css` if you need more series), no gridline clutter, and a tooltip.
7. Check the sample data still produces a sensible result; extend `server/sample.js` if the widget needs new fields (keep people fictional, with `.example` domains).

## Done means

- Works with sample data and with a real Gmail account.
- The empty state reads well.
- 1440px and 390px widths are clean.
- `npx tsc --noEmit` passes.
