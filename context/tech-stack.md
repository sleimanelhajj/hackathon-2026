# Tech Stack & Setup

## What runs

| Part | Tech | Where |
|---|---|---|
| Web app | React 19 + Vite + TypeScript | `src/` (port 5173) |
| API | Node + Express | `server/` (port 8787, proxied at `/api`) |
| Database | MongoDB Atlas, db `ai_workspace_os` | connection string in `.env` |
| Gmail | Google OAuth (`gmail.readonly`) + Gmail REST API | `server/gmail.js` |

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
| `zod` | **In use:** dashboard spec validation (`shared/spec.js`); later also AI output |
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
│   └── crypto.js       ← AES-256-GCM encryption for stored OAuth tokens
├── shared/
│   └── spec.js         ← zod schema + widget catalogue + default dashboard (server AND client)
├── src/
│   ├── App.tsx         ← shell + hash routing (#/dashboard, #/integrations), lazy dashboard
│   ├── components/     ← Sidebar (collapsible), Panel (collapsible), Callout, Gmail logo
│   ├── dashboard/      ← DashboardGrid (GridStack), WidgetFrame, WidgetLibrary, layout model, data context
│   ├── widgets/        ← Stat, ThreadList, ActivityChart (lazy), TopPeople + registry
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
| GET | `/api/status` | DB health, whether Google OAuth is configured, Gmail connection state |
| GET | `/api/auth/google/start` | Redirects to Google consent |
| GET | `/api/auth/google/callback` | Stores encrypted tokens, starts first sync |
| POST | `/api/integrations/gmail/sync` | Re-imports last 30 days (deduplicated by Gmail message id) |
| POST | `/api/integrations/gmail/sample` | Loads labelled sample data |
| DELETE | `/api/integrations/gmail` | Revokes token, deletes imported messages |
| GET | `/api/dashboard` | All business-rule results: totals, lists, breakdowns (shared by all widgets) |
| GET | `/api/messages?q=&direction=in|out&page=0&limit=25` | Stored emails, searchable and paged (no body, no headers); used by the Email data page |
| GET | `/api/messages/:gmailId` | One stored email with all headers and the decrypted body |
| GET | `/api/dashboards/default` | Saved layout spec (widgets + desktop grid positions) |
| PUT | `/api/dashboards/default` | Save a new version (zod-validated; 409 if the version changed meanwhile) |
| POST | `/api/dashboards/default/undo` | Swap back to the previous version |
| POST | `/api/dashboards/default/reset` | Restore the default layout (undoable) |

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
