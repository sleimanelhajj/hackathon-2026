# Codex setup for this repo

| What | Where | Notes |
|---|---|---|
| Instructions | [`AGENTS.md`](../AGENTS.md) | Codex reads it automatically from the repo root |
| Project config | [`config.toml`](config.toml) | Sandbox + approvals; Codex uses it once you trust the project |
| Skills | [`.agents/skills/`](../.agents/skills) | Where Codex discovers repo skills (`<name>/SKILL.md`). Mirrored to `.claude/skills/` for Claude Code |

## Getting started with Codex

```bash
git pull
npm install
cp .env.example .env    # get real values from a teammate privately
codex                   # trust the project when asked
```

Then try: "Use the run-and-verify skill to start the app."

## Skills

- `run-and-verify`: start, check, debug
- `add-integration`: new connector, following the Gmail pattern
- `add-dashboard-widget`: new metric, list or chart
- `ui-conventions`: tokens, components, copy, responsive checks
- `record-decision`: keep `context/` up to date

## Optional: Impeccable design skill

The team uses Impeccable (https://github.com/pbakaus/impeccable) for UI work. It supports Codex; install it by following its README. Project inputs it reads: `PRODUCT.md` and `.impeccable/config.json`.
