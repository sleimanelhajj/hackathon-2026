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
| 10 | 2026-11-13 | Figma UI file: [AI Workspace OS — UI](https://www.figma.com/design/XTZ64s5ZqMsk2ARqPw1C2h) with 5 screens, tokens and components | Source of truth for the UI build |

## Open questions

- [ ] Hackathon duration and team size / role split?
- [ ] Backend language: Node/TypeScript (Express/Fastify) or Python (FastAPI)?
- [ ] LLM provider: Claude (Anthropic) or OpenAI?
- [ ] Database: PostgreSQL / Supabase, or SQLite for the demo?
- [ ] Google Cloud project + Gmail OAuth test users set up yet?
- [ ] Store raw email bodies, minimal excerpts, or only metadata + extractions?
- [ ] Final product name?
