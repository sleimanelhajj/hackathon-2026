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

## Open questions

- [ ] Hackathon duration and team size / role split?
- [ ] Backend language: Node/TypeScript (Express/Fastify) or Python (FastAPI)?
- [x] LLM provider: Claude (Anthropic) or OpenAI? → Gemini (#16)
- [ ] Database: PostgreSQL / Supabase, or SQLite for the demo?
- [ ] Google Cloud project + Gmail OAuth test users set up yet?
- [ ] Store raw email bodies, minimal excerpts, or only metadata + extractions?
- [ ] Final product name?
