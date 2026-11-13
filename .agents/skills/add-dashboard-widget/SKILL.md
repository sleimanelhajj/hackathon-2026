---
name: add-dashboard-widget
description: Add a new widget type (metric, list, chart) to the AI Workspace OS drag-and-drop dashboard. It must be computed from real synced data, validated by the shared zod spec, appear in the widget library, and render in the grid. Use when asked to show new information on the dashboard.
---

# Add a dashboard widget

## How the dashboard works

- A dashboard is **data**: `{ title, widgets[], layout[] }`, validated by `DashboardSpec` in `shared/spec.js` (used by both server and client).
- Widgets are placed by `react-grid-layout` v2 (`src/dashboard/DashboardGrid.tsx`). Only the 12-column desktop layout is saved; tablet (6 cols) and phone (2 cols) layouts are derived in `src/dashboard/layout.ts`.
- Numbers come from one server call, `GET /api/dashboard` (`server/dashboard.js`), shared with every widget through `DashboardDataProvider` / `useDashboardData()`.
- Layout changes are saved with `PUT /api/dashboards/default` (version-checked); undo and reset are separate endpoints.

## Principle

No widget may show a number the data can't support. If the source isn't connected, show an honest empty state with a call to action, never a guess. Facts are observed, derived, inferred (model, must be labelled) or unknown.

## Steps for a new widget type

1. **Data (server):** add the computation to `buildDashboard()` in `server/dashboard.js`. Keep it deterministic and bounded; exclude automated senders when counting people.
2. **Spec (shared):** in `shared/spec.js`:
   - add a variant to the `Widget` discriminated union. Keep its options narrow: enums and bounded numbers, never free-form queries.
   - add a `CATALOG` entry: `label`, `description`, `size { w, h, minW, minH, maxH? }` in grid units (1 row = 24px + 16px gap), and `create()`.
3. **Types:** extend the `Dashboard` type in `src/lib/api.ts` with the new data field.
4. **Component:** `src/widgets/<Name>Widget.tsx`:
   - wrap it in `memo` and read data with `useDashboardData()`
   - render only the body (the frame, title, drag handle and fold toggle come from `WidgetFrame`)
   - handle the empty state with `.widget-empty`
   - if it pulls in a heavy library, `export default` it and load it with `lazy()` in the registry (see `ActivityChartWidget`)
5. **Registry:** add it to `REGISTRY` in `src/widgets/registry.tsx`: `icon` (lucide), `component`, `collapsible`, and an optional single `setting` (a select shown in edit mode).
6. **Default layout:** add it to `DEFAULT_SPEC` only if every new user should see it.
7. **Sample data:** make sure `server/sample.js` produces a sensible result for it.

## React rules this codebase follows

- Callbacks passed into the grid or into widgets are `useCallback`-stable; grid children are built in `useMemo`. The grid re-renders on every drag frame.
- Widgets never fetch on their own; they read the shared data context.
- Each widget is wrapped in `WidgetErrorBoundary` (done by `WidgetFrame`), so one failure doesn't blank the page.
- Never feed intermediate layouts back into the grid during a drag: commit on `onDragStop`/`onResizeStop` only (see `DashboardGrid`). The saved spec lives in react-query (`["dashboard-spec"]`); edits live in the page's `draft`.
- Grid CSS overrides must be prefixed with `.grid-host` (the library stylesheet loads later and wins ties).
- `react-grid-layout` is pinned to 2.3.0. `DashboardGrid` passes a fresh `onDrag`/`onResize` each move (the `nudge` workaround) because that version only redraws the dragged item when it changes grid cell. Re-test drag smoothness before upgrading.

## Done means

- The widget can be added from the library (drag **and** the Add button), configured, moved, resized, removed, saved, undone.
- It reads well at desktop, tablet (derived 6 columns) and phone (2 columns) widths, and when folded.
- It works with sample data and a real Gmail account.
- `npx tsc --noEmit` and `npm run build` pass.
