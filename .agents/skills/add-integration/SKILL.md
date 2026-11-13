---
name: add-integration
description: Add a new connector (Google Calendar, Slack, HubSpot, Sheets, …) to AI Workspace OS following the Gmail pattern, covering OAuth, bounded sync, MongoDB storage, status, disconnect and the Integrations UI. Use whenever a new data source or provider is requested.
---

# Add an integration

Gmail (`server/gmail.js`) is the reference implementation. Copy its shape; don't invent a new one.

## Before coding

- Confirm the integration is in scope (`context/README.md`, `context/decisions.md`). If it's new scope, log it with the `record-decision` skill.
- Pick the **smallest scope set** that answers the product question. Read-only first.
- Check the provider's current docs for scopes, rate limits and verification requirements, and write what you found into `context/tech-stack.md`.

## Server checklist (`server/<provider>.js`)

1. **Config check:** `<provider>Configured()` reads env vars. Add new vars to `.env.example` with placeholders, never real values.
2. **Authorize:** build the consent URL with a random `state` stored server-side (see `pendingStates` in gmail.js), and validate it in the callback.
3. **Store the connection** in `connections` with `{ provider, mode: "live", email/account, scopes, tokens: encrypt(tokens), status, error, lastSyncAt, lastSyncCount, createdAt, updatedAt }`. Tokens **must** go through `encrypt()` from `server/crypto.js`.
4. **Refresh tokens** before expiry (see `accessToken()` in gmail.js).
5. **Bounded sync:** a fixed lookback and a max item count, paginated, with limited concurrency (`mapLimit`). Upsert by the provider's stable ID so re-syncs never double count. Set `status: "syncing"` → `"connected"` / `"error"` with a human-readable `error`.
6. **Normalize** into its own collection (e.g. `events`), with a unique index on the provider ID in `server/db.js`. Keep a `source` field and enough IDs to build a deep link back to the provider.
7. **Disconnect:** revoke the token (best effort), delete the imported data and the connection doc.
8. **Routes** in `server/index.js`: `/api/auth/<provider>/start`, `/callback`, `POST /api/integrations/<provider>/sync`, `DELETE /api/integrations/<provider>`, and extend `/api/status`. Wrap handlers with `wrap()`.

## UI checklist

1. Types in `src/lib/api.ts`; hooks in `src/lib/queries.ts` (invalidate `status` + `dashboard` on mutation).
2. On `IntegrationsPage`, add a card that mirrors `GmailCard`: status tag, one primary action, facts (account, last synced, items imported), and a plain list of what we can and can't do with their data.
3. Update `Steps`/`NextStep` only if the new connector changes onboarding.
4. Move the provider out of the "More integrations" list.
5. The sidebar connection footer: show the most important connection, or a summary.

## Done means

- Connect → sync → dashboard works with a real test account; disconnect removes the data.
- A second sync doesn't change counts.
- A revoked or expired token shows "Needs attention" with a reconnect action, not a crash.
- `npm run build` passes; `context/tech-stack.md` and `context/decisions.md` are updated.
