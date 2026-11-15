// Logs (decision #67): the Costs view (tokens and dollars per agent, model, day and call), the AI team with who is
// above whom, the agent map, and the step-by-step replay of a task.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Agent, type AgentRun, type LogUsage } from "../src/lib/api";
import LogsPage from "../src/pages/LogsPage";
import { buildAgentMap } from "../src/logs/graph";
import { replay } from "../src/logs/RunReplay";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const agent = (id: string, name: string, role: string, parent: string | null, relation: Agent["relation"], extra: Partial<Agent> = {}): Agent =>
  ({ id, name, role, parent, relation, icon: "sparkles", hue: "sky", runs: "When you ask", does: `${name} does useful work for the workspace every day.`, reads: [], ...extra });
const TEAM: Agent[] = [
  agent("layla", "Layla", "Lead assistant", null, null),
  agent("sami", "Sami", "Dashboard builder", "layla", "sub-agent", { reads: ["Sales database"] }),
  agent("nadia", "Nadia", "Email analyst", "layla", "team", { reads: ["Gmail"] }),
];
const now = new Date().toISOString();
const row = (n: Partial<LogUsage["totals"]> = {}) => ({ calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0, failed: 0, unpriced: 0, ...n });
const USAGE: LogUsage = {
  period: { days: 30, from: now, to: now },
  totals: row({ calls: 3, inputTokens: 5500, outputTokens: 750, costUsd: 0.0044 }),
  byAgent: [{ agent: "nadia", ...row({ calls: 1, inputTokens: 4000, outputTokens: 600, costUsd: 0.0027 }) }, { agent: "layla", ...row({ calls: 2, inputTokens: 1500, outputTokens: 150, costUsd: 0.0017 }) }],
  byModel: [{ model: "gemini-3.8-flash", ...row({ calls: 3, inputTokens: 5500, outputTokens: 750, costUsd: 0.0044 }) }],
  byDay: Array.from({ length: 30 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, ...row() })),
  calls: [{ at: now, agent: "nadia", model: "gemini-3.8-flash", inputTokens: 4000, outputTokens: 600, thinkingTokens: 0, costUsd: 0.0027, priced: true, ok: true, error: null, fellBack: true, durationMs: 1200, runId: "r2", task: "Sort 2 email threads" }],
  prices: { source: "https://ai.google.dev/gemini-api/docs/pricing", checked: "2026-11-15", models: [{ model: "gemini-3.8-flash", from: null, until: "2027-01-01", inputPerMillion: 0.75, outputPerMillion: 3.75, note: "introductory price until 31 Dec 2026" }] },
};
const run = (over: Partial<AgentRun>): AgentRun => ({
  id: "r1", agent: "layla", task: "Show battery sales", trigger: "you", parentRunId: null, startedAt: now, endedAt: now, durationMs: 3200, ok: true, error: null,
  calls: 1, inputTokens: 1000, outputTokens: 100, costUsd: 0.0011, steps: [], children: [], tree: { calls: 2, inputTokens: 1500, outputTokens: 150, costUsd: 0.0017, steps: 4 }, ...over,
});
const SAMI = run({ id: "r1b", agent: "sami", task: "battery sales", trigger: "agent", parentRunId: "r1", durationMs: 900,
  steps: [{ seq: 1, at: now, kind: "model", name: "gemini-3.8-flash", model: "gemini-3.8-flash", inputTokens: 500, outputTokens: 50, costUsd: 0.0006, priced: true, ok: true, durationMs: 700 }],
  tree: { calls: 1, inputTokens: 500, outputTokens: 50, costUsd: 0.0006, steps: 1 } });
const LAYLA_RUN = run({
  steps: [
    { seq: 1, at: now, kind: "model", name: "gemini-3.8-flash", model: "gemini-3.8-flash", inputTokens: 1000, outputTokens: 100, costUsd: 0.0011, priced: true, ok: true, durationMs: 800 },
    { seq: 2, at: now, kind: "tool", name: "find_products", args: "{\"query\":\"battery\"}", detail: "2 products", ok: true, durationMs: 30 },
    { seq: 3, at: now, kind: "agent", name: "sami", task: "battery sales", childRunId: "r1b", ok: true },
  ],
  children: [SAMI],
});

const mockApi = () => {
  vi.spyOn(api, "agents").mockResolvedValue({ agents: TEAM, other: agent("app", "Workspace", "Other AI work", null, null) });
  vi.spyOn(api, "logUsage").mockResolvedValue(USAGE);
  vi.spyOn(api, "logRuns").mockResolvedValue({ runs: [LAYLA_RUN] });
};

test("costs: totals, the agent that costs most, each agent and model, every call with its tokens and cost", async () => {
  mockApi();
  wrap(<LogsPage />);
  expect(await screen.findByText("Nadia accounts for 61% of the AI cost")).toBeTruthy();
  const totals = screen.getByRole("region", { name: "Totals" });
  expect(within(totals).getByText("$0.0044")).toBeTruthy();
  expect(within(totals).getByText("5.5K")).toBeTruthy();
  const byAgent = screen.getByRole("region", { name: "By agent" });
  expect(within(byAgent).getByText("Layla")).toBeTruthy();
  expect(within(byAgent).getByLabelText("61% of the cost")).toBeTruthy();
  const byModel = screen.getByRole("region", { name: "By model" });
  expect(within(byModel).getByRole("link", { name: /Pricing page/ }).getAttribute("href")).toMatch(/ai\.google\.dev/);
  expect(within(byModel).getByText(/\$0\.75 in \/ \$3\.75 out per 1M tokens/)).toBeTruthy();
  const calls = screen.getByRole("region", { name: "Every call" });
  const callRow = within(calls).getByText("Sort 2 email threads").closest("tr")!;
  expect(within(callRow).getByText("4K")).toBeTruthy();
  expect(within(callRow).getByText("$0.0027")).toBeTruthy();
  expect(within(callRow).getByText("backup")).toBeTruthy();
});

test("how the agents work: the team with who is above whom, the map, and a step-by-step replay", async () => {
  mockApi();
  wrap(<LogsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /How the agents work/ }));
  const team = await screen.findByRole("list", { name: "The AI team, lead at the top" });
  expect(within(team).getByRole("article", { name: "Layla, Lead assistant" }).textContent).toMatch(/Lead/);
  expect(within(team).getByRole("article", { name: "Sami, Dashboard builder" }).textContent).toMatch(/Sub-agent of Layla/);
  expect(within(team).getByRole("article", { name: "Nadia, Email analyst" }).textContent).toMatch(/Works for Layla/);
  expect(screen.getByRole("img", { name: /Agent map/ })).toBeTruthy();
  const steps = screen.getByRole("list", { name: "Step by step: Show battery sales" });
  const text = steps.textContent ?? "";
  for (const bit of ["Show battery sales", "Asks Gemini", "Find products → 2 products", "Hands over: battery sales", "Done", "Finished in 3.2 s"]) expect(text).toContain(bit);
  expect(text.indexOf("Hands over")).toBeLessThan(text.indexOf("Done"));
});

test("the map counts what happened and keeps the wiring that didn't", () => {
  const { nodes, edges } = buildAgentMap([LAYLA_RUN], TEAM);
  const edge = (from: string, to: string) => edges.find((e) => e.from === from && e.to === to);
  expect(edge("trigger:you", "agent:layla")?.count).toBe(1);
  expect(edge("agent:layla", "model:gemini")?.count).toBe(1);
  expect(edge("agent:sami", "model:gemini")?.count).toBe(1);
  expect(edge("agent:layla", "agent:sami")?.count).toBe(1);
  expect(edge("agent:layla", "tool:find_products")?.count).toBe(1);
  expect(edge("tool:find_products", "data:Sales database")?.count).toBe(1);
  expect(edge("agent:nadia", "data:Gmail")?.count).toBe(0);
  expect(nodes.find((n) => n.id === "agent:nadia")?.count).toBe(0);
});

test("the replay follows the order things happened, sub-agent steps inside the hand-over", () => {
  const { lanes, events } = replay(LAYLA_RUN);
  expect(lanes.map((l) => l.id)).toEqual(["you", "layla", "sami", "gemini", "tools"]);
  expect(events.map((e) => `${e.from}>${e.to}:${e.kind}`)).toEqual([
    "you>layla:start", "layla>gemini:model", "layla>tools:tool", "layla>sami:handoff", "sami>gemini:model", "sami>layla:return", "layla>you:end",
  ]);
});
