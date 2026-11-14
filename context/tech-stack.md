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
| `pdf-lib` | **In use:** deterministic invoice PDFs on the server; the model never writes PDF code or HTML |
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
| POST | `/api/assistant/confirm` | `{ threadId, approve }` → confirms the waiting draft (stores the invoice, returns its PDF link) or hands it back for changes |
| GET | `/api/invoices/:id/pdf` | Download a deterministic PDF generated from one stored invoice draft |
| POST | `/api/invoices/:id/send` | Send the reviewed PDF through Gmail; requires edited subject/body and `approved: true`, and cannot be called by the model |

## MongoDB collections

| Collection | Holds |
|---|---|
| `connections` | One doc per provider (tokens encrypted). `analysis` sub-doc: status, progress, counts, last run, error |
| `messages` | Synced Gmail metadata (unique on `gmailId`) |
| `sent_replies` | Metadata of replies sent from the app (threadId, Gmail id, recipients, subject, time). No text |
| `attachment_text` | Text extracted from attachments for the AI, one doc per `gmailId:partId`: status (`ok`/`empty`/`failed`), `textEnc` (encrypted), kind (`pdf`, `docx`, `xlsx`, `pptx`, `image`, `calendar`, `zip`, `html`, `text`), chars, `reader` (version; older entries without text are read again). Temporary Gemini failures and images read without a key aren't cached. Deleted on disconnect |
| `extractions` | AI labels, one doc per thread (`_id` = threadId): category, priority, needsReply, summary, reason, suggestedAction, certainty (`inferred` or `derived`), model, promptVersion, lastMessageId |
| `dashboards` | Saved dashboard spec (`_id: "default"`), versioned, previous version kept for undo |
| `invoices` | App-owned invoice drafts, computed totals, delivery status and source ids. This is not the company database |
| `audit_events` | Content-free agent/tool and approved-action audit metadata |

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
