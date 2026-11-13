# Implementation Roadmap

Everything we still need to build, **in order**, with **how** to build it and **which packages** to use.
Product rules (no fabricated numbers, approval before any external action, least privilege) are in [`../AGENTS.md`](../AGENTS.md) and apply to every item.
Screens for each feature are in [Figma](https://www.figma.com/design/XTZ64s5ZqMsk2ARqPw1C2h).

Status key: ✅ done · 🟡 next · ⬜ planned · 💤 stretch

| # | Feature | Status | Demo-critical | Figma screen |
|---|---|---|---|---|
| 0 | Gmail connect + sync + derived dashboard, collapsible UI | ✅ | yes | 1, 2, 7 |
| 1 | Dashboard as saved widget spec + **drag-and-drop layout** | ✅ | yes | 3 |
| 2 | Agent chat panel (ask questions, edit the dashboard) | 🟡 | yes | 2 |
| 3 | Generate a dashboard from a prompt (onboarding) | ⬜ | yes | 1 |
| 4 | AI extraction: leads, follow-ups, tasks (with certainty labels) | 🟡 first cut built | yes | 2, 6 |
| 5 | Action center + approval-gated Gmail drafts | ⬜ | yes | 4, 6 |
| 6 | Sign-in, workspaces, RBAC, admin tailors dashboards per person | ⬜ | strong | 5 |
| 7 | Scheduled sync + freshness | ⬜ | nice | – |
| 8 | Google Calendar connector | 💤 | stretch | 7 |
| 9 | Automations / workflow view | 💤 | after hackathon | – |

---

## Packages

| Package | Status | Used for (feature #) |
|---|---|---|
| `react`, `react-dom`, `vite`, `typescript` | installed | everything |
| `@tanstack/react-query` | installed, in use | all server data (0–9) |
| `zustand` | installed, in use | UI state: sidebar, panels, edit mode (0, 1) |
| `recharts` | installed, in use | charts inside widgets (0, 1) |
| `lucide-react` | installed, in use | icons |
| `express`, `mongodb`, `dotenv` | installed, in use | API + database |
| **`react-grid-layout`** v2 (+ its dependency `react-resizable`) | installed | **drag, drop and resize dashboard widgets (1)** |
| **`@dnd-kit/react`** | installed | **drag-to-reorder lists**: action queue, widget toggles in admin, sidebar dashboards (5, 6) |
| **`zod`** | installed | validate widget specs and every AI-produced JSON, on the server and the client (1–5) |
| **`@assistant-ui/react`** | installed | agent chat panel UI: thread, composer, tool-call rendering (2) |
| **`@xyflow/react`** | installed | node graph for automations (9) |
| LLM SDK: `@google/genai` (Gemini, decision #16) | to add | agent, dashboard generation, extraction (2–4) |
| `express-session` + `connect-mongo` | to add | login sessions stored in MongoDB (6) |
| `node-cron` | to add | scheduled sync (7) |

**One drag-and-drop system per job:** `react-grid-layout` owns the dashboard grid (moving, resizing, dropping new widgets in from the library). `@dnd-kit/react` is only for reordering vertical lists. Don't mix them on the same surface.

---

## 1. Dashboard as a widget spec + drag-and-drop ✅

> **Built (2026-11-13).** What shipped, which differs slightly from the original plan below:
> - Schema in `shared/spec.js` (plain JS + zod, imported by server and client). Widget types: `stat`, `thread-list`, `activity-chart`, `top-people`, 8 default widgets.
> - Only the **desktop (12-column) layout is saved**. Tablet (6 cols) and phone (2 cols) are derived in `src/dashboard/layout.ts`, and editing is desktop-only.
> - Data stays one call (`GET /api/dashboard`) shared through a React context, instead of one request per widget.
> - Endpoints: `GET/PUT /api/dashboards/default` (version check → 409 on conflict), `POST …/undo`, `POST …/reset`.
> - Edit mode: drag by the grip, resize from the corner, an **"Add widgets" panel on the right** (search, drag in or press +, with Save / Cancel / Reset at its foot), one setting per widget, remove, Undo after save, and a warning before leaving with unsaved changes. The sidebar folds while editing and comes back afterwards.
> - Smoothness: the layout is read only on drag/resize **stop** (`onDragStop`/`onResizeStop`), never fed back mid-drag. Grid CSS overrides are prefixed with `.grid-host`, because the library stylesheet loads later.
> - Widgets fold in view mode (the grid shrinks them to their header); stats don't fold.
> - The dashboard page and the chart are lazy-loaded chunks.
>
> The original plan is kept below for reference.

**Goal:** the dashboard is data, not hard-coded JSX. The user clicks **Edit layout**, drags widgets by a handle, resizes from the corner, adds widgets from a library, and clicks **Save**. The layout persists per person. See Figma screen 3.

### Data model (MongoDB `dashboards` collection)

```ts
// src/lib/spec.ts (shared shape; validate with zod on both sides)
const WidgetType = z.enum(["stat", "thread-list", "activity-chart", "top-people", "insight", "meeting-list"]);
const Widget = z.object({
  id: z.string(),                    // stable; used as the react-grid-layout key "i"
  type: WidgetType,                  // must exist in the widget registry
  title: z.string().max(60),
  query: z.object({                  // bounded, never raw SQL or Mongo
    metric: z.enum(["awaitingYou", "awaitingThem", "received", "sent", "people", "activity", "topPeople"]),
    windowDays: z.number().int().min(1).max(90).default(30),
    excludeAutomated: z.boolean().default(true),
  }),
});
const LayoutItem = z.object({ i: z.string(), x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int() });
const Dashboard = z.object({
  _id: z.string(), workspaceId: z.string(), ownerId: z.string(),
  title: z.string(), version: z.number().int(),
  templateId: z.string().optional(), // set when an admin tailored it (feature 6)
  widgets: z.array(Widget),
  layouts: z.object({ lg: z.array(LayoutItem), md: z.array(LayoutItem), sm: z.array(LayoutItem) }),
});
```

### Server

- `GET /api/dashboards/:id` returns the spec. `PATCH /api/dashboards/:id` validates with zod, rejects unknown widget types, and does `version + 1` (keep the previous version in `dashboard_versions` for undo).
- `GET /api/widgets/:id/data` runs the widget's `query` through a **fixed metric catalogue** (move today's code from `server/dashboard.js` into one function per metric).
- Seed a default "Gmail overview" spec that reproduces today's dashboard, so nothing regresses.

### Client

- `src/widgets/registry.tsx` maps each `type` to a component. Today's panels (stat strip, thread lists, activity chart, top people) become widgets.
- `src/pages/DashboardPage.tsx`:

```tsx
import { Responsive, useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const { width, containerRef, mounted } = useContainerWidth();
<div ref={containerRef}>
  {mounted && (
    <Responsive
      width={width}
      layouts={draft.layouts}
      breakpoints={{ lg: 1100, md: 760, sm: 0 }}
      cols={{ lg: 12, md: 6, sm: 1 }}
      gridConfig={{ rowHeight: 40, margin: [20, 20] }}
      dragConfig={{ enabled: editing, handle: ".widget-handle" }}
      resizeConfig={{ enabled: editing }}
      dropConfig={{ enabled: editing, defaultItem: { w: 6, h: 6 } }}
      onLayoutChange={(_current, all) => setDraftLayouts(all)}
      onDrop={(layout, item) => addWidgetFromLibrary(item)}
    >
      {draft.widgets.map((w) => <div key={w.id}><WidgetFrame widget={w} editing={editing} /></div>)}
    </Responsive>
  )}
</div>
```

  Check the `Responsive` prop names against `node_modules/react-grid-layout/README.md` (v2 API) while implementing.
- **Edit mode** lives in zustand (`editing`, `draft`). Outside edit mode, drag and resize are off, so content stays clickable.
- **Widget library drawer:** each item has `draggable` and sets its type on `dataTransfer`; the grid's `onDrop` reads it and creates a widget. Also offer a click-to-add button for keyboard users.
- Toolbar: **Save layout** (PATCH), **Cancel** (discard draft), **Reset to admin default** (feature 6).
- Keep the `Panel` collapse inside each widget frame. Drag only from the `.widget-handle` grip, never from the whole card.

**Done when** you can reorder, resize, add and remove widgets, reload and see the same layout, and it works at 1440px and 390px (one column on phones, drag disabled).

---

## 2. Agent chat panel 🟡

> **Detailed build plan (Gemini): [agent-plan.md](agent-plan.md).** The notes below are the original outline.

**Goal:** a right-hand panel where the user asks questions ("who's waiting on me?") and edits the dashboard ("move follow-ups to the top"). See Figma screen 2.

- **UI:** `@assistant-ui/react` with a custom runtime that calls our API; collapsible like the sidebar. Show tool activity ("Searched 412 threads") and an **Undo** chip after any change.
- **Server:** `POST /api/agent/chat` streams the reply. The LLM gets **tools**, not raw data access:
  - `get_dashboard()`, `query_metric(metric, windowDays)` (same catalogue as feature 1)
  - `search_threads(query, limit ≤ 20)` returns metadata and snippets only
  - `propose_dashboard_change(diff)`: the server validates it with zod, saves a new version, and returns a summary
- **Safety:** email text is passed as quoted data, never as instructions. The model can't call anything that sends, deletes or changes Gmail. Log every tool call to `audit_events`.
- **Answers cite sources:** every list item links to its thread.

## 3. Generate a dashboard from a prompt ⬜

- In onboarding (Figma screen 1), the user's sentence goes to `POST /api/dashboards/generate`.
- The LLM must return a `Dashboard` spec (structured output / JSON schema from the zod schema). The server validates it, drops unknown widgets, and fills in the layout.
- If the request needs a source we don't have (e.g. invoices, Calendar), return a widget that shows "Connect X" instead of inventing data.

## 4. AI extraction (leads, follow-ups, tasks) 🟡

> **First cut built (2026-11-14), not yet run end to end.** `server/agent/classify.js` sorts each thread (not each message) into a category, priority, needsReply, summary, reason and suggested action. Results go to `extractions` (one doc per thread). It runs after sync and sample load, or via `POST /api/analysis/run`, and only re-sends threads with a new message. Automated senders are labelled by a rule with no model call. Widgets: `insight-list` and `category-breakdown`. The sample data includes a prompt-injection email.
> **Still to do:** user corrections ("not a lead") stored in `correction` (the field is reserved and never overwritten), deadline extraction, a hand-labelled test set.

- Batch job after each sync, over new messages only (metadata + snippet; fetch full bodies only if a decision allows it).
- Output goes to an `extractions` collection: `{ messageId, kind: "lead" | "follow_up" | "task" | "deadline", value, certainty: "inferred", modelVersion, createdAt }`.
- The UI shows certainty badges: observed / derived / inferred / unknown (colours already in the Figma tokens).
- Users can correct a label ("not a lead"); store it and never overwrite it on re-run.
- Test with a small hand-labelled set: autoresponders, internal threads saying "proposal", messages with several dates.

## 5. Action center + approval-gated Gmail drafts ⬜

- **Needs scope `gmail.compose`.** This is a decision: log it and update the "What we can do with your Gmail" list in the UI.
- `action_requests` collection: `{ type: "gmail_draft", target, payload, payloadHash, state: "suggested" | "needs_review" | "approved" | "completed" | "failed" | "dismissed", idempotencyKey }`.
- Flow: preview → user edits → **Approve** stores an `approvals` doc bound to `payloadHash` → server re-checks permission → calls `users.drafts.create` → saves the draft ID and link → UI shows a receipt.
- Never send. Retries reuse the idempotency key.
- Action center page (Figma screen 6): tabs by state; reorder the queue with `@dnd-kit/react` if needed.

## 6. Sign-in, workspaces, RBAC, admin tailoring ⬜

- **Sign-in:** Google Sign-In (OpenID `openid email profile`), kept **separate** from the Gmail data connection. Sessions use `express-session` + `connect-mongo`, with an httpOnly cookie.
- **Collections:** `users`, `workspaces`, `memberships { userId, workspaceId, role: "super_admin" | "admin" | "member" }`. Scope every query by `workspaceId`, and check the role **on the server** for every route.
- **Tailoring (Figma screen 5):** the super admin builds a template dashboard for a person and publishes it. The member gets a copy with `templateId`. Their drag-and-drop changes stay on their copy, and **Reset to admin default** re-copies the template.
- Connections belong to a user; one person's Gmail data is never shown to another member unless they explicitly share it.

## 7. Scheduled sync ⬜

- `node-cron` in the API process: every 15 minutes, `syncGmail()` for each live connection, with backoff on errors.
- Later: Gmail push notifications (Pub/Sub) plus `history.list` incremental sync. Keep showing an honest "Synced X min ago" either way.

## 8. Google Calendar 💤

- Follow the `add-integration` skill. Scope `calendar.readonly`, store events in an `events` collection, add a meeting-list widget, and match attendees to Gmail contacts by email.

## 9. Automations 💤

- Rules stored as JSON (`trigger`, `conditions`, `steps`), validated by zod; see blueprint §7.5.
- `@xyflow/react` shows the rule as a node graph. Any external step still needs approval.

---

## Definition of done (every feature)

1. Works with sample data **and** a real Gmail test account.
2. Empty, loading and error states read well; every page has one clear next action.
3. 1440px and 390px widths are clean; keyboard focus works.
4. `npm run build` passes.
5. `context/decisions.md` and `context/tech-stack.md` are updated, and this table's status is changed.
