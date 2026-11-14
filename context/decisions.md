# Decisions Log

Newest at the bottom. Add an entry whenever the team makes a choice that affects scope or architecture.

| # | Date | Decision | Why |
|---|---|---|---|
| 1 | 2026-11-13 | Project name placeholder: **AI Workspace OS** | From blueprint; final brand still open |
| 2 | 2026-11-13 | **Gmail-first**, Google Calendar as stretch second connector | One source is enough to demo the full loop |
| 3 | 2026-11-13 | Frontend is **plain React (Vite + TypeScript)**, **not Next.js** | Team preference: React only |
| 4 | 2026-11-13 | Dashboards are **validated JSON specs** (zod) rendered by fixed widget components | Safety + reliability; no model-authored code |
| 5 | 2026-11-13 | Actions are **draft-only** in MVP, always behind user approval | Safety; matches blueprint principles |
| 6 | 2026-11-13 | Code lives in `github.com/sleimanelhajj/hackathon-2026`, branch `main` | Team repo |
| 7 | 2026-11-13 | Design tooling: **Impeccable** and **taste-skill** Claude Code plugins installed | UI polish for the demo |
| 8 | 2026-11-13 | **RBAC**: super admin, admin and member. The super admin tailors a dashboard per person; the member customizes it via the agent and drag-and-drop | Core product model (user decision) |
| 9 | 2026-11-13 | Visual direction: **category standard** (clean SaaS, Linear/Attio/HubSpot craft bar), Inter, indigo accent, certainty colours (observed/derived/inferred/unknown) | User choice in the design round |
| 11 | 2026-11-13 | Backend: **Node + Express** (`server/`), database **MongoDB Atlas** (db `ai_workspace_os`). Secrets live only in git-ignored `.env` | Browser can't talk to MongoDB directly; smallest backend that works |
| 12 | 2026-11-13 | Starter scope: **Integrations + Dashboard, Gmail only**. Read-only scope (`gmail.readonly`), last 30 days, max 300 messages, metadata only. Numbers are computed by plain code, not an LLM | User request; honest, explainable numbers |
| 13 | 2026-11-13 | Clearly labelled **sample data** mode for rehearsing the demo before Google OAuth is set up | Lets the team demo without OAuth keys |
| 14 | 2026-11-13 | Agent setup committed to the repo: `AGENTS.md` (shared rules), `CLAUDE.md` (imports it), skills in `.agents/skills/` (Codex) mirrored to `.claude/skills/`, `.claude/settings.json` (Impeccable + taste-skill plugins), `.codex/config.toml` | Teammates and their agents follow the same rules from the first pull |
| 15 | 2026-11-13 | Drag-and-drop dashboard built on **react-grid-layout v2**. Spec validated by zod in `shared/spec.js`; only the desktop layout is stored and editable, tablet/phone are derived; one dashboard (`default`) until RBAC lands | Simplest model that stays correct at every width; per-person copies come with roadmap #6 |
| 10 | 2026-11-13 | Figma UI file: [AI Workspace OS — UI](https://www.figma.com/design/XTZ64s5ZqMsk2ARqPw1C2h) with 5 screens, tokens and components | Source of truth for the UI build |
| 16 | 2026-11-13 | LLM provider: **Google Gemini** via the `@google/genai` SDK, called only from the server. Model name comes from an env var; the key (`GEMINI_API_KEY`) lives only in `.env` | Team choice for the agent (roadmap #2–4) |
| 17 | 2026-11-14 | Gemini is called with **plain `fetch` on the REST `generateContent` endpoint** (`server/agent/llm.js`), not the `@google/genai` SDK. Default model `gemini-3.8-flash` (stable) | No new dependency, same pattern as `gmail.js`; all Gemini code is in one file so moving to the newer Interactions API later is a one-file change |
| 18 | 2026-11-14 | **AI email analysis** (roadmap #4, first cut): after each sync, threads from the last 30 days are sorted by Gemini into a category (lead, proposal, request, scheduling, billing, support, internal, automated, other), a priority, a summary, the reason and a suggested action. Stored per thread in `extractions`, labelled *inferred*; automated senders are labelled by a rule (*derived*) with no model call. Only new/changed threads are re-sent | Turns raw email into dashboard widgets with evidence; incremental keeps cost and data sent low |
| 19 | 2026-11-14 | **Data sent to Gemini:** sender name + domain, subject, up to 300 characters of Gmail's snippet, and message age. No email addresses, no bodies. Email text is wrapped as untrusted data and the output is schema-checked by zod | Data minimisation and prompt-injection defence (AGENTS.md rules 3 and 6) |
| 20 | 2026-11-14 | Gemini calls **fall back** to `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`) when the main model returns 503/429 or times out; labels record the model that answered | On first real run `gemini-3.8-flash` was overloaded (503, then 60s+ timeouts) while other models answered in 1–6s |
| 21 | 2026-11-14 | The dashboard **hides widget types it doesn't know** (with a notice) and disables editing in that case, instead of crashing | The shared database held a layout saved by a teammate's newer, unpushed code; saving from older code would have deleted their widgets |
| 22 | 2026-11-14 | **Gmail auto-sync** (roadmap #7) is scheduled polling inside the API process (`server/scheduler.js`, plain timers, no `node-cron`): every `SYNC_INTERVAL_MINUTES` (default 15, min 5, 0 = off) a live connection is re-synced, then analysed. Skips if synced recently, stops after "Reconnect Gmail" errors, backs off on failures. UI says "Next check in N min", never "real-time" | Smallest thing that makes the dashboard stay current; Gmail push (Pub/Sub + `history.list`) needs a public HTTPS endpoint, so it's later |
| 23 | 2026-11-14 | **One persona: a sales rep** who follows up from Gmail on three kinds of email: **proposals, invoices (accounting) and shipments**. Founders, operators and teams are out for the weekend | AlphaHack feedback #04: "employees that want to manage their data" was too broad; pick one person |
| 24 | 2026-11-14 | **Gmail only** for the hackathon weekend. No WhatsApp or other channels; Google Calendar moves from "stretch" to "after the weekend" | Feedback #04: the trigger mixed Gmail and WhatsApp |
| 25 | 2026-11-14 | **"No reply"** = the last message in a thread is one you sent to someone outside your company (not an automated address), and **3 business days** (Mon–Fri) have passed without an answer | Feedback #04 asked for a one-sentence definition. Code still counts 3 *calendar* days (`server/dashboard.js`); to change, see roadmap #4 |
| 26 | 2026-11-14 | **Priority:** *high* = a customer is waiting on you about a proposal, payment or delivery problem; *medium* = you've had no reply for 3+ business days on a proposal, invoice or shipment; *low* = automated or on-track updates, or still inside 3 business days. **One trigger:** a thread crossing one of these lines appears in "Needs a follow-up" with a draft that waits for approval | Feedback #04 asked for one-sentence priority rules. The Gemini prompt (`server/agent/classify.js`) must be aligned to these words; see roadmap #4 |

| 27 | 2026-11-14 | Implemented #25–#26 in `shared/followup.js`. **Priority is derived by code at read time** (not by Gemini, not stored), from the AI's category plus who wrote last and business days elapsed; each row shows the rule that applied. Medium also covers a customer waiting on you about a meeting or smaller request, and new inquiries count as high. Categories now fit the persona: `proposal`, `billing`, `shipping` (new), `lead`, `request` (absorbs the old `support`), `scheduling`, `internal`, `automated`, `other`. Prompt version 2 | "3 business days" passes without new email, so stored priorities would go stale; code rules are exact and testable (20 tests). The rules needed one more case than #26 covered |

## Open questions

- [ ] Hackathon duration and team size / role split?
- [x] Backend language: Node/TypeScript (Express/Fastify) or Python (FastAPI)? → Node + Express (#11)
- [x] LLM provider: Claude (Anthropic) or OpenAI? → Gemini (#16)
- [x] Database: PostgreSQL / Supabase, or SQLite for the demo? → MongoDB Atlas (#11)
- [ ] Google Cloud project + Gmail OAuth test users set up yet?
- [ ] Store raw email bodies, minimal excerpts, or only metadata + extractions?
- [ ] Final product name?
- [ ] Pitch numbers: feedback #04 caught a sum on the AUP card ("1 hour each time × 500 times a month" is 500 hours a month). Recheck every number on the card before the pitch, and don't put unverified numbers in these docs
