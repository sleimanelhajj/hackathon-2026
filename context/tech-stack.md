# Tech Stack & Setup

## What runs

| Part | Tech | Where |
|---|---|---|
| Web app | React 19 + Vite + TypeScript | `src/` (port 5173) |
| API | Node + Express | `server/` (port 8787, proxied at `/api`) |
| Database | MongoDB Atlas, db `ai_workspace_os` | connection string in `.env` |
| Gmail | Google OAuth (`gmail.readonly`) + Gmail REST API | `server/gmail.js` |
| AI | Google Gemini REST API (`generateContent`, plain fetch), model from `GEMINI_MODEL` | `server/agent/` |

## Frontend libraries

| Package | Used for |
|---|---|
| `@tanstack/react-query` | API fetching, caching, polling while syncing |
| `zustand` | UI state (collapsed sidebar and sections, remembered in localStorage) |
| `recharts` | Email activity chart |
| `lucide-react` | Icons |
| `@fontsource-variable/inter` | Self-hosted Inter font |
| `gridstack` 14 | **In use:** the dashboard canvas: free placement (`mode: "float"`), push on collision, corner resize, drag-in from the widget panel, touch support, one-column layout on narrow screens |
| `react-is` | Required by recharts (was previously pulled in indirectly) |
| `zod` | **In use:** dashboard spec validation (`shared/spec.js`) and every Gemini answer (`server/agent/classify.js`) |
| `unpdf` | **In use:** text out of PDF attachments for the AI (`server/agent/content.js`); pure JS, no native build |
| `mammoth` | **In use:** fallback reader for Word (.docx); the main reader is `server/agent/files.js`, which keeps tables as rows |
| `@radix-ui/react-select` | **In use:** every dropdown, through `src/components/Select.tsx` (keyboard and screen-reader support, styleable menu) |
| `pg` | **In use:** Postgres connector for the Sales page (`server/sales/db.js`); `POSTGRES_URL` in `.env` |
| `react-big-calendar` + `dayjs` | **In use:** the Schedule page (`src/pages/SchedulePage.tsx`), restyled with our tokens; only the dayjs adapter is imported |
| `pdf-lib` | **In use:** deterministic invoice PDFs on the server; the model never writes PDF code or HTML. Also builds dashboard PDF reports in the browser (#61) |
| `html-to-image` | **In use:** draws a dashboard as a PNG for Export (#61), in the browser; nothing is uploaded |
| `telegram` (GramJS) | **In use:** Telegram sign-in, reading the followed chats and sending confirmed messages over MTProto (web connection), on the server only (#64) |
| `@langchain/langgraph` (+ `@langchain/core`) | **In use:** the assistant's agent graph (`server/agent/sales-agent.js`): model → tools → human confirmation via `interrupt()`, per-thread checkpoints. Gemini is still called through `llm.js`, not a LangChain model wrapper |
| `@assistant-ui/react` | Installed for later: agent chat panel (roadmap #2) |
| `@xyflow/react` | Installed for later: automation graph (roadmap #9) |

Packages still to add, and when, are listed in [roadmap.md](roadmap.md#packages).

Regression checks: `npm test` runs pure coordinate tests plus Vitest/jsdom and React Testing Library tests against the real grid. These cover Cancel, Reset, explicit Save, and library preview alignment without writing to the connected database.

## Project layout

```
.
├── context/            ← project idea, decisions, stack
├── PRODUCT.md          ← product record (users, roles, principles)
├── server/
│   ├── index.js        ← Express routes
│   ├── db.js           ← MongoDB connection + indexes
│   ├── gmail.js        ← OAuth, token refresh, bounded sync, disconnect
│   ├── dashboard.js    ← business rules engine: every number, list and breakdown the widgets show
│   ├── gmail-parse.js  ← Gmail message (format=full) → canonical doc: headers, flags, body, attachments
│   ├── dashboards.js   ← saved dashboard spec: get / save (versioned) / undo / reset
│   ├── sample.js       ← labelled sample data for demos
│   ├── crypto.js       ← AES-256-GCM encryption for stored OAuth tokens
│   ├── agent/
│   │   ├── llm.js      ← the only file that calls Gemini (JSON output, retries, friendly errors)
│   │   ├── classify.js ← AI email analysis job: category, priority, summary, reason, next step per thread
│   │   ├── content.js  ← what the AI may read: cleaned bodies + attachment text (which files, cache, limits)
│   │   ├── files.js    ← attachment readers: PDF, Word, Excel, PowerPoint, .ics, ZIP (with zip-bomb limits), text/HTML
│   │   ├── vision.js   ← images and scanned PDFs read by Gemini vision: visible text + a short description
│   │   ├── reply.js    ← AI reply drafts (sent only after two clicks)
│   │   ├── chat.js     ← company-data Q&A, verified sources and invoice orchestration (older endpoint)
│   │   ├── sales-agent.js ← the assistant: LangGraph graph (model → tools → confirm)
│   │   ├── sales-tools.js ← read-only Postgres tools + invoice drafts from database facts
│   │   ├── widget-builder.js ← sub-agent: plain request → validated custom sales widget
│   │   ├── assistant.js   ← wires Gemini, tools, the widget builder and invoice storage for the API
│   │   └── invoice.js  ← validated invoice maths + deterministic PDF rendering
│   ├── company-data/   ← bounded read-only gateway + provider.js handoff for the real company database
│   └── sales/          ← Postgres sales data: connection, demo seed, metrics, custom widget queries (custom.js)
├── shared/
│   └── spec.js         ← zod schema + widget catalogue + default dashboard (server AND client)
├── src/
│   ├── App.tsx         ← shell + hash routing (#/dashboard, #/integrations), lazy dashboard
│   ├── agent/          ← floating assistant bubble/panel, source chips and reviewed invoice delivery
│   ├── components/     ← Sidebar (collapsible), Panel (collapsible), Callout, Gmail logo
│   ├── dashboard/      ← DashboardGrid (GridStack), WidgetFrame, WidgetLibrary, layout model, data context
│   ├── widgets/        ← Stat, ThreadList, ActivityChart (lazy), TopPeople, rule lists, breakdowns, InsightWidgets (AI list + category breakdown) + registry
│   ├── pages/          ← IntegrationsPage, DashboardPage (edit mode, save/undo/reset), DataPage (emails as fetched)
│   └── lib/            ← api client, react-query hooks, UI store
├── .env                ← secrets (git-ignored, never commit)
└── .env.example        ← template for teammates
```

## Running locally

```bash
npm install
cp .env.example .env   # then fill in values
npm run dev            # starts API (8787) and web app (5173) together
```

Open http://localhost:5173. With nothing connected you land on Integrations.

## API

| Method | Path | Does |
|---|---|---|
| GET | `/api/agents` | The AI team: names, roles, avatars, who is above whom (#67) |
| GET | `/api/logs/usage?days=` | Gemini calls, tokens and cost for 1–90 days: totals, by agent, by model, by day, latest 100 calls, price list (#67) |
| GET | `/api/logs/runs?days=&limit=` | Latest top-level agent runs with their steps and sub-agent runs nested (#67) |
| GET | `/api/health` | 200 when MongoDB answers, 503 when not (uptime checks) |
| GET | `/api/integrations/telegram` | Telegram status: configured, connected, account (masked phone), last read, sign-in step (#64) |
| POST | `/api/integrations/telegram/code` · `/verify` · `/password` · `/cancel` | Sign-in steps: phone → code → two-step password. Never stores the code or password |
| POST | `/api/integrations/telegram/sync` | Reads recent chats (bounded) |
| DELETE | `/api/integrations/telegram` | Signs out of Telegram and deletes its chats here |
| PUT | `/api/integrations/telegram/people` | Who to follow: `{ people: string[] }` (names, max 30); reads chats again in the background (#65) |
| GET · POST | `/api/telegram/chats/:id/insight` | AI insight for one followed chat: saved one (GET, made if out of date) or a new one (POST) (#65) |
| POST | `/api/telegram/chats/:id/send` | Sends one message the user confirmed (`{ text, confirmed: true }`), followed chats only (#65) |
| GET | `/api/telegram/chats` · `/api/telegram/chats/:id/messages` | Chat list (no text) · one chat's messages (decrypted) |
| GET | `/api/status` | DB health, whether Google OAuth and Gemini are configured, Gmail connection + AI analysis state |
| GET | `/api/auth/google/start` | Redirects to Google consent |
| GET | `/api/auth/google/callback` | Stores encrypted tokens, starts first sync |
| POST | `/api/integrations/gmail/sync` | Re-imports last 30 days (deduplicated by Gmail message id) |
| POST | `/api/integrations/gmail/sample` | Loads labelled sample data |
| DELETE | `/api/integrations/gmail` | Revokes token, deletes imported messages and their AI labels |
| GET | `/api/dashboard` | All business-rule results: totals, lists, breakdowns (shared by all widgets) |
| GET | `/api/messages?q=&direction=&from=&status=&priority=&category=&page=0&limit=25` | Stored emails, searchable, filterable and paged (no body, no headers), each with its AI label (`ai`); used by the Email data page |
| GET | `/api/messages/:gmailId` | One stored email with all headers and the decrypted body |
| GET | `/api/messages/people` | Everyone in the stored email with message counts (Email data person filter) |
| POST | `/api/replies/draft` | `{ threadId }` → AI-drafted reply (to, subject, body, note). Drafts only, never sends |
| GET | `/api/threads/:threadId` | One conversation in full for the email viewer: bodies (decrypted on the server), files, AI summary |
| GET | `/api/sales/status` | Postgres connection state and table counts (no secrets) |
| POST | `/api/sales/seed` | Creates the database/schema if needed and loads the demo sales data (replaces it) |
| GET | `/api/sales/dashboard?months=1\|3\|6\|12` | KPIs with previous-period comparison, monthly trend, category/region, top products/customers, reps vs target, pipeline, recent orders |
| POST | `/api/replies/send` | Sends a reply the user edited and approved (`approved: true`); threading headers come from the store |
| GET | `/api/attachments/:gmailId/:attachmentId` | Downloads one attachment from Gmail (always as a download) |
| GET | `/api/dashboards/:board` | Saved layout spec (widgets + desktop grid positions) |
| PUT | `/api/dashboards/:board` | Save a new version (zod-validated; 409 if the version changed meanwhile) |
| POST | `/api/dashboards/:board/undo` | Swap back to the previous version |
| POST | `/api/dashboards/:board/reset` | Restore the default layout (undoable) |
| POST | `/api/analysis/run` | Start AI email analysis in the background (`{ "force": true }` re-sorts every thread). Also runs on its own after a sync or sample load |
| POST | `/api/agent/chat` | Last 10 text turns → answer from bounded company-data records, verified sources and optional stored invoice draft |
| POST | `/api/assistant/message` | `{ threadId, message }` → the LangGraph assistant's reply, tools used, and an invoice draft waiting for confirmation (if any) |
| POST | `/api/sales/custom` | `{ query }` (a custom widget's typed query) → rows, total, previous-period total and what it counts; fixed, parameterized, read-only SQL |
| DELETE | `/api/dashboards/:board/widgets/:id` | Removes one widget (the chat's Remove button for an assistant-made widget) |
| (script) | `npm run db:backup` / `npm run db:restore -- --yes` | Back up / restore the demo sales data and dashboard layouts (`backups/`); never email data |
| PUT | `/api/integrations/gmail/auto-sync` | `{ enabled }` → turns the every-minute new-mail check on or off |
| GET | `/api/files` | The attachment library: folders per contact with each file's AI summary and figures; starts reading files not read yet (#56) |
| GET | `/api/payments` | Invoices to pay and to collect with due dates, status and priority (#59) |
| GET | `/api/inventory/changes` | Invoices that moved stock, newest first, with the lines matched and not matched (#58) |
| POST | `/api/inventory/changes/:key/undo` | `{ approved: true }` → reverses one invoice's stock change and removes its order or purchase |
| GET/POST | `/api/dashboard-pages` | The main Dashboard's pages; POST `{ name }` adds one (#60) |
| PATCH/DELETE | `/api/dashboard-pages/:id` | Rename (`{ name }`) or delete a page (not the first) |
| POST | `/api/email/custom` | `{ query }` → data for a custom email chart (a typed query over the synced mail, #60) |
| GET | `/api/schedule?tz=` | The email schedule: reply tasks, follow-ups, meetings and deadlines built from Gmail data, each with `why` and a Gmail link, plus calendar sync status |
| POST | `/api/schedule/sync` | `{ approved: true, tz }` → writes the schedule to the app's own Google calendar ("AI Workspace OS"); needs the `calendar.app.created` scope |
| PUT | `/api/meetings/availability` | `{ availability: { weekly, dates }, tz }` → saves the user's availability; the first save switches meeting requests on (#55) |
| POST | `/api/meetings/requests/:id/answer` | `{ accept, approved: true }` → accepts ("works for me") or declines (with free times) a request waiting for the user; sends the email |
| POST | `/api/meetings/requests/:id/retry` | `{ approved: true }` → sends a failed automatic reply again |
| POST | `/api/assistant/confirm` | `{ threadId, approve }` → confirms the waiting draft (stores the invoice, returns its PDF link) or hands it back for changes |
| GET | `/api/invoices/:id/pdf` | Download a deterministic PDF generated from one stored invoice draft |
| POST | `/api/invoices/:id/send` | Send the reviewed PDF through Gmail; requires edited subject/body and `approved: true`, and cannot be called by the model |

## MongoDB collections

| Collection | Holds |
|---|---|
| `connections` | One doc per provider (tokens encrypted). `analysis` sub-doc: status, progress, counts, last run, error |
| `messages` | Synced Gmail metadata (unique on `gmailId`) |
| `agent_runs` | One document per agent run: agent, task label, trigger, parent/root run, tokens, cost, steps (model calls, tools, hand-overs). TTL 90 days. No message content (#67) |
| `telegram_chats` | Followed Telegram chats: title, kind, unread, last message time, count. No message text; `insight` holds the AI insight encrypted (`enc`) with the message id it was based on (#64, #65) |
| `telegram_messages` | Telegram messages (unique on chatId + id): date, out, sender name, hasMedia, `textEnc` (encrypted) |
| `sent_replies` | Metadata of replies sent from the app (threadId, Gmail id, recipients, subject, time). No text |
| `attachment_text` | Text extracted from attachments for the AI, one doc per `gmailId:partId`: status (`ok`/`empty`/`failed`), `textEnc` (encrypted), kind (`pdf`, `docx`, `xlsx`, `pptx`, `image`, `calendar`, `zip`, `html`, `text`), chars, `reader` (version; older entries without text are read again). Temporary Gemini failures and images read without a key aren't cached. Deleted on disconnect |
| `extractions` | AI labels, one doc per thread (`_id` = threadId): category, priority, needsReply, summary, reason, suggestedAction, certainty (`inferred` or `derived`), model, promptVersion, lastMessageId |
| `dashboards` | Saved dashboard spec (`_id: "default"`), versioned, previous version kept for undo |
| `invoices` | App-owned invoice drafts, computed totals, delivery status and source ids. This is not the company database |
| `audit_events` | Content-free agent/tool and approved-action audit metadata |
| `attachment_docs` | One doc per attachment (`gmailId:partId`): contact folder, file meta, AI summary, type and figures (number, dates, total, issuer, billed to, lines), status, model, version (#56) |
| `dashboard_pages` | The main Dashboard's pages: `_id` (`main` or `page-xxxxxx`), name, order; each page's layout is a board in `dashboards` (#60) |

Postgres (sales schema) also has, since #58: `invoice_changes` (one row per invoice applied: key, kind sale/purchase, number, counterparty, total, order or purchase id, unmatched lines, applied/undone), `stock_movements`, `purchases` + `purchase_items`, and `inventory_settings` (when email-read invoices started to count). Created in place at server start; cleared by `db:restore` and Reload demo data.
| `meeting_settings` | `_id: "gmail"`: the user's availability (weekly hours + date changes), time zone, `activatedAt` (first save; only later requests are answered) |
| `meeting_requests` | One decision per meeting request (`_id` from conversation + time): status (`accepted`, `pending`, `auto-declined`, `confirmed`, `declined`, `superseded`), reason, and the email sent about it (text, sent time, error, dry run) |

## Company database handoff

`server/company-data/provider.js` is intentionally unconnected. The teammate responsible for the real company database implements its `configured`, `describe` and `getContext` functions using a read-only account and parameterized, allow-listed queries. `server/company-data/index.js` caps the result at 25 records and validates every profile, fact, record kind and HTTP(S) source link before Gemini can see it. Provider-specific environment variables and setup must be documented here when that provider is chosen.

## Gemini setup

1. Create a key at https://aistudio.google.com/apikey. Use a billing-enabled key before analysing a real inbox.
2. Put it in `.env` as `GEMINI_API_KEY`. Optionally change `GEMINI_MODEL` (default `gemini-3.8-flash`) and `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`, used when the main model is overloaded, rate-limited or slow; `none` turns it off). A model that fails from overload is skipped for 5 minutes.
3. Restart `npm run dev`. Syncing Gmail or loading sample data now also sorts the email. The Integrations page says what is sent.

## Gmail OAuth setup (one time)

1. Google Cloud Console → new project → enable **Gmail API**.
2. OAuth consent screen → External, testing mode → add your Gmail as a test user.
3. Credentials → OAuth client ID (Web application) → redirect URI `http://localhost:8787/api/auth/google/callback`.
4. Put the client ID and secret in `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and restart `npm run dev`.

## Gotchas

- If `npm install` fails with `EBADDEVENGINES ... pnpm`, a stray `package.json` in a parent folder is being picked up. Run npm from inside this project folder.
- The API uses `API_PORT`, not `PORT`, because some dev tools set `PORT` for the web server.
- MongoDB Atlas must allow your IP (Atlas → Network Access).
- `.impeccable/` is a local plugin cache and is git-ignored.
