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
| `react-grid-layout` (v2) | **In use:** drag, drop and resize dashboard widgets |
| `@dnd-kit/react` | Installed for later: drag-to-reorder lists only (roadmap #5, #6) |
| `zod` | **In use:** dashboard spec validation (`shared/spec.js`) and every Gemini answer (`server/agent/classify.js`) |
| `@assistant-ui/react` | Installed for later: agent chat panel (roadmap #2) |
| `@xyflow/react` | Installed for later: automation graph (roadmap #9) |

Packages still to add, and when, are listed in [roadmap.md](roadmap.md#packages).

## Project layout

```
.
├── context/            ← project idea, decisions, stack
├── PRODUCT.md          ← product record (users, roles, principles)
├── server/
│   ├── index.js        ← Express routes
│   ├── db.js           ← MongoDB connection + indexes
│   ├── gmail.js        ← OAuth, token refresh, bounded sync, disconnect
│   ├── dashboard.js    ← derived numbers (waiting on you / them, activity, top people)
│   ├── dashboards.js   ← saved dashboard spec: get / save (versioned) / undo / reset
│   ├── sample.js       ← labelled sample data for demos
│   ├── scheduler.js    ← auto-sync: re-checks live Gmail every SYNC_INTERVAL_MINUTES, then runs AI analysis
│   ├── crypto.js       ← AES-256-GCM encryption for stored OAuth tokens
│   └── agent/
│       ├── llm.js      ← the only file that calls Gemini (JSON output, retries, friendly errors)
│       └── classify.js ← AI email analysis job: category, summary, reason, next step per thread (priority: shared/followup.js)
├── shared/
│   ├── spec.js         ← zod schema + widget catalogue + default dashboard (server AND client)
│   └── followup.js     ← follow-up rules: business days, "no reply", high/medium/low priority (decisions #25–#27)
├── src/
│   ├── App.tsx         ← shell + hash routing (#/dashboard, #/integrations), lazy dashboard
│   ├── components/     ← Sidebar (collapsible), Panel (collapsible), Callout, Gmail logo
│   ├── dashboard/      ← DashboardGrid (react-grid-layout), WidgetFrame, WidgetLibrary, layout helpers, data context
│   ├── widgets/        ← Stat, ThreadList, ActivityChart (lazy), TopPeople, InsightWidgets (AI list + category breakdown) + registry
│   ├── pages/          ← IntegrationsPage, DashboardPage (edit mode, save/undo/reset)
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
| GET | `/api/status` | DB health, whether Google OAuth and Gemini are configured, auto-sync schedule, Gmail connection + AI analysis state |
| GET | `/api/auth/google/start` | Redirects to Google consent |
| GET | `/api/auth/google/callback` | Stores encrypted tokens, starts first sync |
| POST | `/api/integrations/gmail/sync` | Re-imports last 30 days (deduplicated by Gmail message id) |
| POST | `/api/integrations/gmail/sample` | Loads labelled sample data |
| DELETE | `/api/integrations/gmail` | Revokes token, deletes imported messages and their AI labels |
| GET | `/api/dashboard` | Dashboard numbers and lists (shared by all widgets) |
| GET | `/api/dashboards/default` | Saved layout spec (widgets + desktop grid positions) |
| PUT | `/api/dashboards/default` | Save a new version (zod-validated; 409 if the version changed meanwhile) |
| POST | `/api/dashboards/default/undo` | Swap back to the previous version |
| POST | `/api/dashboards/default/reset` | Restore the default layout (undoable) |
| POST | `/api/analysis/run` | Start AI email analysis in the background (`{ "force": true }` re-sorts every thread). Also runs on its own after a sync or sample load |

## MongoDB collections

| Collection | Holds |
|---|---|
| `connections` | One doc per provider (tokens encrypted). `analysis` sub-doc: status, progress, counts, last run, error |
| `messages` | Synced Gmail metadata (unique on `gmailId`) |
| `extractions` | AI labels, one doc per thread (`_id` = threadId): category, summary, reason, suggestedAction, certainty (`inferred` or `derived`), model, promptVersion, lastMessageId. Priority isn't stored: `shared/followup.js` derives it when the dashboard loads |
| `dashboards` | Saved dashboard spec (`_id: "default"`), versioned, previous version kept for undo |

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
