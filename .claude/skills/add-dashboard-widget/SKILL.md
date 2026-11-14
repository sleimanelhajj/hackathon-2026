---
name: add-dashboard-widget
description: Add a new widget type (metric, list, chart) to the AI Workspace OS drag-and-drop dashboard. It must be computed from real synced data, validated by the shared zod spec, appear in the widget library, and render in the grid. Use when asked to show new information on the dashboard.
---

# Add a dashboard widget

## How the dashboard works

- A dashboard is **data**: `{ title, widgets[], layout[] }`, validated by `DashboardSpec` in `shared/spec.js` (used by both server and client).
- The canvas is **GridStack** (`src/dashboard/DashboardGrid.tsx`, `mode: "float"`): 12 columns, row unit 40px (24px + 16px gap). Cards stay where they are dropped, dropping onto a card pushes it down, and empty space is kept. The saved `layout[]` is the real `{i,x,y,w,h}` per widget. Under 640px wide GridStack switches to one column; changes made there are not saved.
- Numbers come from one server call, `GET /api/dashboard` (`server/dashboard.js`), shared with every widget through `DashboardDataProvider` / `useDashboardData()`.
- Layout changes are saved with `PUT /api/dashboards/default` (version-checked); undo and reset are separate endpoints.

## Principle

No widget may show a number the data can't support. If the source isn't connected, show an honest empty state with a call to action, never a guess. Facts are observed, derived, inferred (model, must be labelled) or unknown.

## Steps for a new widget type

1. **Data (server):** add the computation to `buildDashboard()` in `server/dashboard.js`. Keep it deterministic and bounded; exclude automated senders when counting people.
2. **Spec (shared):** in `shared/spec.js`:
   - add a variant to the `Widget` discriminated union. Keep its options narrow: enums and bounded numbers, never free-form queries.
   - add a `CATALOG` entry: `label`, `description`, default `size { w, h }` (w in 12ths: 3/4/6/8/12; h in rows of 24px + 16px gap: 6/9/12, number cards 3), and `create()`.
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

- Callbacks passed into the grid or into widgets are `useCallback`-stable; cards are `memo`ized, so a drag only re-renders what moves.
- Widgets never fetch on their own; they read the shared data context.
- Each widget is wrapped in `WidgetErrorBoundary` (done by `WidgetFrame`), so one failure doesn't blank the page.
- Drag and drop is **GridStack only**; don't add another drag library or HTML5 drag events. React renders one `.grid-stack-item` per widget; `DashboardGrid` registers new ones with `grid.makeWidget`, unregisters removed ones, and applies outside changes (keyboard moves, size inputs, reset) with `grid.update`. Finished gestures come back through GridStack's `change` and `dropped` events. Panel entries are registered with `GridStack.setupDragIn` (class `library-drag`, id `new:<type>`, catalogue size).
- The card drag handle (`.widget-handle`) must not be a `<button>`: GridStack ignores mousedown on buttons, inputs and selects. It is a `div role="button" tabIndex=0`.
- GridStack CSS overrides in `src/index.css` are prefixed with `.dashboard-canvas` so they win over the library stylesheet.
- The saved spec lives in react-query (`["dashboard-spec"]`); edits live in the page's `draft` ({ widgets, order, sizes }).

## Done means

- The widget can be added from the panel (drag **and** the + button), configured, moved (mouse and keyboard), resized with the size buttons, removed, saved, undone.
- It reads well at every width it can be set to, on narrow screens, and when folded.
- It works with sample data and a real Gmail account.
- `npx tsc --noEmit` and `npm run build` pass.
