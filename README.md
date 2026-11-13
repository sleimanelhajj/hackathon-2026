# AI Workspace OS (AlphaHack 2026)

Connect your tools, describe what matters, get a dashboard that helps you act. The starter connects **Gmail** (read-only) and shows who is waiting on your reply, which conversations went quiet, and how your inbox is trending.

## Quickstart

```bash
git clone https://github.com/sleimanelhajj/hackathon-2026.git
cd hackathon-2026
npm install
cp .env.example .env   # get the real values from a teammate (never commit .env)
npm run dev            # API :8787 + web :5173
```

Open http://localhost:5173 → **Integrations** → **Try with sample data** (or **Connect Gmail** once the Google OAuth keys are in `.env`).

## Where things are

| Need | Go to |
|---|---|
| The idea, scope, status | [`context/README.md`](context/README.md) |
| Decisions and open questions | [`context/decisions.md`](context/decisions.md) |
| Stack, API, Gmail OAuth setup | [`context/tech-stack.md`](context/tech-stack.md) |
| Users, roles, principles | [`PRODUCT.md`](PRODUCT.md) |
| UI designs | [Figma: AI Workspace OS UI](https://www.figma.com/design/XTZ64s5ZqMsk2ARqPw1C2h) |
| Rules for coding agents | [`AGENTS.md`](AGENTS.md) (Codex) · [`CLAUDE.md`](CLAUDE.md) (Claude Code) |
| Agent skills | [`.agents/skills/`](.agents/skills) (Codex) · [`.claude/skills/`](.claude/skills) (Claude Code) |

## Working with an AI agent

- **Claude Code:** open the folder. `CLAUDE.md`, the project skills and the Impeccable design plugin load from `.claude/`.
- **Codex:** run `codex` in the folder and trust the project. `AGENTS.md`, `.codex/config.toml` and `.agents/skills/` load automatically.

Edit skills in `.agents/skills/`, then run `npm run skills:sync` to update the Claude Code copy.
