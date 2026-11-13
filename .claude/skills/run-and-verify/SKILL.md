---
name: run-and-verify
description: Start AI Workspace OS locally (API + web), set up .env, and verify a change end to end in the browser. Use when asked to run, start, test, demo or debug the app, or before pushing any change.
---

# Run and verify

## 1. First-time setup

```bash
npm install
cp .env.example .env
```

Fill `.env` (get real values from a teammate privately; never commit them):

| Variable | Notes |
|---|---|
| `MONGODB_URI` | Atlas connection string. Your IP must be allowed in Atlas → Network Access |
| `MONGODB_DB` | `ai_workspace_os` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional at first. Without them, use sample data |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8787/api/auth/google/callback` |
| `TOKEN_SECRET` | 64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Everyone sharing one DB must use the **same** value, or stored Gmail tokens can't be decrypted |
| `APP_URL` | `http://localhost:5173` |
| `API_PORT` | `8787` (deliberately not `PORT`) |

## 2. Run

```bash
npm run dev
```

- API: http://localhost:8787 (logs `API ready … (MongoDB connected)`)
- Web: http://localhost:5173 (Vite proxies `/api` to the API)

Quick health check: `curl -s localhost:8787/api/status` → `{"database":true,"googleConfigured":…,"gmail":…}`

## 3. Verify a change

1. `npx tsc --noEmit` must pass.
2. Open http://localhost:5173. With nothing connected you should land on `#/integrations`.
3. Exercise the flow you touched:
   - No Google keys: **Try with sample data** → the "Sample data" banner appears → **Open dashboard**.
   - With Google keys: **Connect Gmail** → Google consent → back on Integrations with "Gmail connected" → the sync finishes → Dashboard.
   - Collapse the sidebar (button or `[`) and a section; reload; both states persist.
4. Check 1440px and 390px widths: no overflow, no clipped text.
5. `npm run build` must pass before you push.
6. If you loaded sample data into a shared database, remove it afterwards (**Remove sample data**) unless the team is using it for the demo.

## Common problems

| Symptom | Fix |
|---|---|
| `EBADDEVENGINES … pnpm` on npm install | A parent folder has a `package.json`. Run npm inside the project folder |
| Web shows "Can't reach the server" | The API isn't running, or it bound to the wrong port. Check `API_PORT` |
| `Could not connect to MongoDB` | Wrong `MONGODB_URI`, or your IP isn't allowlisted in Atlas |
| Connect Gmail button locked | `GOOGLE_CLIENT_ID`/`SECRET` are missing; restart after adding them |
| Google says "access blocked" | Add your Gmail as a test user on the OAuth consent screen |
| "Unsupported state or unable to authenticate data" | `TOKEN_SECRET` differs from the one that stored the tokens. Reconnect Gmail |
