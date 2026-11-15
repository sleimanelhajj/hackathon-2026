# Hand-off: where the project stands (2026-11-14)

Read this first if you are picking the project up (human or agent). It is the short version of what exists, how to
run it, where things live, and what to do next. The rules are in [../AGENTS.md](../AGENTS.md); every decision with its
reason is in [decisions.md](decisions.md) (#36–#53 cover the work summarised here).

Branch: `feature/freeform-dashboard` (pushed to GitHub `sleimanelhajj/hackathon-2026`). `main` is behind it.

---

## 1. What the app does today

| Area | What it does | Where |
|---|---|---|
| **Gmail** | Connect (OAuth, read-only + send for approved replies), sync the last 30 days (≤ 300 messages), bodies stored encrypted. **Auto-sync**: every 60 s a 1-quota-unit check; a full sync + AI sorting only when the mailbox changed (#52). | `server/gmail.js`, `server/autosync.js` |
| **AI email analysis** | Gemini sorts each thread: category, priority, needs-reply, summary, reason, next step, and **`when`** (a meeting time or deadline the text states, #51). Reads bodies and attachments (PDF, Word, Excel, PowerPoint, .ics, ZIP, images via vision). | `server/agent/classify.js`, `content.js`, `files.js`, `vision.js` |
| **Email dashboard** | Customisable GridStack board (drag, resize, add, remove with confirm, undo). Widgets: waiting on you/them, AI-sorted lists, topics, contacts, attachments, activity… | `src/dashboard/`, `src/widgets/`, `server/dashboard.js` |
| **All email** | Searchable, filterable list of synced mail with a full-email viewer and AI reply drafts (sent only after two clicks). | `src/pages/DataPage.tsx`, `src/components/EmailViewer.tsx`, `ReplyModal.tsx` |
| **Sales** | A second customisable board over **Postgres** demo data: a small fictional Lebanese solar shop, about $10K of sales a month (#66). | `src/pages/SalesPage.tsx`, `server/sales/` |
| **Assistant (chat bubble)** | LangGraph agent (#47): read-only sales tools, product recommendations, invoices (draft → user confirms → PDF), customers who stopped ordering, any figure by any grouping. A **widget-builder sub-agent** adds custom charts to the Sales board from plain requests (#48); it can also remove widgets (#49) and resize them ("make the pipeline full width", #54). | `server/agent/sales-agent.js`, `sales-tools.js`, `widget-builder.js`, `assistant.js`, `src/agent/AgentAssistant.tsx` |
| **Schedule** | Calendar (react-big-calendar) built from Gmail: urgent replies 2 h after the email, normal next working morning, low within 3 working days, follow-ups, meetings (invites + text), deadlines. Opt-in sync to the app's **own** Google calendar "AI Workspace OS" (scope `calendar.app.created`, confirm first) (#51). All 24 hours; **availability** and **meeting requests**: past/clashing ones get an automatic reply with free times, ones outside availability wait for Accept/Decline (each sends an email) (#55). Use `MEETING_EMAILS=dry-run` on test databases. |
| **Files** | A folder per contact with an AI summary and the figures of every attachment; the assistant searches them (#56). Invoices among them feed **Payments** (#59) and move **stock and Sales** automatically, with an undo log on the Sales page (#58). Reply drafts use live stock (#57). | `server/documents.js`, `inventory.js`, `payments.js`, `agent/reply-inventory.js`, `src/pages/FilesPage.tsx` |
| **Dashboard pages** | Dashboard = a main board of email and sales widgets with pages; Email dashboard (`#/email`) and Sales stay separate. The assistant creates pages, adds ready-made widgets and custom email or sales charts (#60). Export any dashboard as PNG or PDF (#61). | `server/pages.js`, `widget-kinds.js`, `email-custom.js`, `src/pages/MainDashboardPage.tsx`, `src/dashboard/ExportButton.tsx` | `server/schedule.js`, `schedule-data.js`, `meetings.js`, `meeting-data.js`, `gcal.js`, `src/pages/SchedulePage.tsx`, `src/schedule/` |
| **Look** | Glassmorphism over soft coloured light (#39), fast: no backdrop blur on panes (#40), page-shaped skeletons, sidebar that slides with the page. | `src/index.css` (tokens at the top) |

## 2. Run it

```bash
npm install
cp .env.example .env      # fill in the values (ask a teammate; never commit .env)
npm run db:restore -- --yes   # optional: load the committed demo sales data and dashboard layouts
npm run dev               # API :8787 + web :5173
npm test                  # Node tests + Vitest; must pass before you push
npm run build             # type-check + production build
```

`.env` needs: `MONGODB_URI`, `TOKEN_SECRET`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`,
`GEMINI_API_KEY` (+ optional `GEMINI_MODEL`), `POSTGRES_URL` (local Postgres; the Sales page's "Load demo data"
creates the database and tables), and optionally `TIME_ZONE` (default `Asia/Beirut`) and `GMAIL_POLL_SECONDS` (default 60).

**Google Cloud setup** for the calendar sync: enable the Google Calendar API, and add the scope
`https://www.googleapis.com/auth/calendar.app.created` to the OAuth consent screen. Then "Allow calendar access" on the
Schedule page.

## 3. Data: where it lives and what is backed up

| Store | Collections / tables | Backed up in git? |
|---|---|---|
| **Postgres** `ai_workspace_sales`, schema `sales` | `reps`, `customers`, `products`, `orders`, `order_items`, `deals`, `store_profile` (all fictional demo data) | **Yes**: `backups/sales.json` (`npm run db:backup` / `db:restore`) |
| **MongoDB** `ai_workspace_os` | `dashboards` (layouts), `invoices` (demo invoice drafts) | **Yes**: `backups/mongo-safe.json` |
| | `messages`, `connections` (encrypted tokens), `extractions` (AI labels), `attachment_text`, `labels`, `calendar_invites`, `calendar_sync`, `audit_events` | **Never** (personal email data or secrets, #53). A new person connects and syncs their own Gmail. |

The demo data is also reproducible from code: `generateSalesData({ seed: 42 })` in `server/sales/seed.js`; tests pin
each story in it (solar boom, generators declining, heaters in winter, pumps in summer, a customer who stopped
ordering, Online gaining share…).

## 4. How the AI parts are kept safe

- Email text and tool results are **data, never instructions** (prompts say so; outputs are zod-validated).
- The assistant's database tools are fixed, parameterized, **READ ONLY** queries picked from allow-lists; no tool name
  contains query/sql/send/delete (a test enforces it).
- Anything that leaves the workspace needs an explicit click: invoice PDF (confirm draft), sending a reply or invoice
  (review + send), Google Calendar sync (confirm dialog). Dashboard widget add/remove is internal and undoable.
- Money, tax, discounts and dates on invoices are computed in code from the database, never by the model.

## 5. Known issues and loose ends

- **A teammate's older server can overwrite the AI labels** if it points at the same MongoDB (it writes without
  `when`/priority). Fix: everyone on this branch, or a separate `MONGODB_DB`.
- **Assistant conversations are in memory** (LangGraph `MemorySaver`): a server restart forgets open chats and any
  invoice draft waiting for confirmation. Use a Mongo/Postgres checkpointer for production.
- **Auto-sync is polling, not push.** Gmail push needs Pub/Sub + a public HTTPS URL; swap in when deployed.
- **Schedule times are suggestions**; dates read from email text are AI-inferred and labelled as such.
- `server/agent/chat.js` + `server/company-data/` (company-data chat from the merged branch) are still wired at
  `POST /api/agent/chat` but the bubble uses `/api/assistant/*` now; remove or connect the provider.
- The first Google Calendar sync sends one request per event (~100), so it takes about a minute.

## 6. Good next steps

1. **Deploy** (public HTTPS) → switch auto-sync to Gmail push, and persistent LangGraph checkpoints.
2. **Prompt-generated dashboards** for the email board (roadmap #3); the widget-builder sub-agent is the pattern.
3. **User corrections** for AI labels and schedule items (never overwritten on re-sort).
4. **Sign-in, workspaces, RBAC** (roadmap #6) before more than one person uses one deployment.
5. Optional: read the user's real calendar (`calendar.readonly`) so tasks avoid existing meetings (new scope = new decision).

## 7. Conventions worth knowing

- **Test-first** (#34): server tests in `tests/server/*.test.mjs` (Node test runner; Postgres tests skip without
  `POSTGRES_URL`), UI tests in `tests/*.test.tsx` (Vitest). The theme's palette, glass and contrast are pinned by tests.
- **UI:** plain words for non-technical users, the shared `Select` (never a native `<select>`), lucide icons, colour
  tokens only, check 1440 px and 390 px. See the `ui-conventions` and `glassmorphism` skills.
- **Docs:** add a row to `decisions.md` for any product/architecture decision; update `tech-stack.md` for new
  dependencies, routes, collections or env vars.
