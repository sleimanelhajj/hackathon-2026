@AGENTS.md

## Claude Code notes

- Project skills are in `.claude/skills/` (mirrored from `.agents/skills/`; edit there, then `npm run skills:sync`).
- `.claude/settings.json` registers the **impeccable** and **taste-skill** plugin marketplaces. Accept the prompt to install them when you open the project.
  - Use `/impeccable` for UI work. It reads `PRODUCT.md` and `.impeccable/config.json`.
  - taste-skill is for marketing/landing pages only, not the app screens.
- `.claude/launch.json` defines the `app` preview (`npm run dev`, port 5173) for the desktop app's browser pane.
- Personal overrides go in `.claude/settings.local.json` (git-ignored).
