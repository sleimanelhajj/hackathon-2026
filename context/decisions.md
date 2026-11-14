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
| 16 | 2026-11-14 | **Fetch everything:** Gmail sync uses `format=full` for all categories (last 30 days, max 300, configurable). Stores all headers, labels, flags, attachment metadata and plain-text body (≤20k chars) **encrypted with AES-256-GCM**; attachment contents are not downloaded | User decision: business rules need the full data |
| 17 | 2026-11-14 | Sync is **paced under the 6,000 units/user/min quota** with retries, fetches only new message IDs, and applies label changes/deletions via `history.list` | Full format costs 60 units/message; repeat syncs must be cheap |
| 18 | 2026-11-14 | **Default business rules** (see `business-rules.md`) computed in `server/dashboard.js`, exposed as widgets (number, rule list, breakdown); default layout now 12 widgets | Deterministic rules before the agentic layer |
| 19 | 2026-11-14 | **No inference in default rules:** removed keyword rules (invoices, contracts, urgent); meeting invites = calendar attachment only. 14 rules remain, all read Gmail fields. Old saved layouts drop removed widgets automatically. Added the **Email data** page showing every fetched email as stored | User decision: show what Gmail returned, nothing guessed; the agent will do inference later, labelled |
| 20 | 2026-11-14 | **Replaced react-grid-layout with @dnd-kit sortable on a CSS grid.** A dashboard is an ordered list of cards with preset sizes (width ¼–Full, height S/M/L); drop a card on another and that card moves along; nothing floats up on its own. Adding from the panel shows a placeholder at the drop spot. Keyboard dragging included | User feedback: grid dragging was choppy and widgets did not stay where placed |
| 22 | 2026-11-14 | **Dashboard canvas rebuilt on GridStack** (`gridstack` 14, `mode: "float"`), replacing react-grid-layout and @dnd-kit (both uninstalled). GridStack owns dragging, resizing, collision pushing and panel drag-in; React renders card contents and syncs through `makeWidget` / `update` / the `change` and `dropped` events. Card drag handles are `div role=button` because GridStack ignores mousedown on `<button>` | User request after repeated drag problems: adopt a proven open-source grid instead of patching |
| 10 | 2026-11-13 | Figma UI file: [AI Workspace OS — UI](https://www.figma.com/design/XTZ64s5ZqMsk2ARqPw1C2h) with 5 screens, tokens and components | Source of truth for the UI build |
| 21 | 2026-11-14 | **Free-position dashboard with corner resizing** using react-grid-layout v2, no compaction, actual x/y/w/h persistence, one grid engine for internal/external dragging, keyboard movement/resizing, and settings popovers. Supersedes #20 | User explicitly chose free placement with resizing; an ordered list cannot represent deliberate gaps or independent card positions |
| 22 | 2026-11-14 | **Layout editing is a transaction:** Cancel discards the draft, Reset replaces only the draft, and only Save writes it. Remount the grid at edit/reset/save boundaries; reject callbacks from discarded sessions. Library drags use a card preview aligned with the target | Fixes retained grid state after Cancel/Reset and the detached native preview reported by the user |

## Open questions

- [ ] Hackathon duration and team size / role split?
- [ ] LLM provider: Claude (Anthropic) or OpenAI?
- [ ] Google Cloud project + Gmail OAuth test users set up yet?
- [ ] Body retention period (how long encrypted body text is kept)?
- [ ] Final product name?

Answered: backend = Node + Express (#11), database = MongoDB Atlas (#11), email bodies = stored encrypted (#16).
