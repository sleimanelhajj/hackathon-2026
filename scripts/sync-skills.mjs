// Mirrors .agents/skills (source of truth, read by Codex) into .claude/skills (read by Claude Code).
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, ".agents", "skills");
const dest = join(root, ".claude", "skills");

if (!existsSync(src)) {
  console.error("No .agents/skills folder found.");
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("Synced .agents/skills -> .claude/skills");
