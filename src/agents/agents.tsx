import { useMemo, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Cpu, FileScan, FolderOpen, Mail, PenLine, Send, Sparkles } from "lucide-react";
import { api, type Agent } from "../lib/api";
import { AgentFace } from "./faces";

// The workspace's AI agents (decision #67): names, roles and who is above whom come from the server (team.js);
// the avatar is the agent's drawn face (faces.tsx) on its colour pair, with its role icon in a badge.

const ICONS = { sparkles: Sparkles, chart: BarChart3, mail: Mail, scan: FileScan, folder: FolderOpen, pen: PenLine, send: Send, cpu: Cpu } as const;

/** Layla before the team has loaded (the chat bubble shows her straight away). */
export const LAYLA: Agent = { id: "layla", name: "Layla", role: "Lead assistant", parent: null, relation: null, icon: "sparkles", hue: "sky", runs: "", does: "", reads: [] };

/** Before the team has loaded, or for an id the server doesn't know: a neutral stand-in. */
const UNKNOWN: Agent = { id: "app", name: "Workspace", role: "Other AI work", parent: null, relation: null, icon: "cpu", hue: "slate", runs: "", does: "", reads: [] };

/** The team, by id, loaded once per session. */
export function useAgents() {
  const { data } = useQuery({ queryKey: ["agents"], queryFn: api.agents, staleTime: Infinity });
  return useMemo(() => {
    const list = data?.agents ?? [];
    const byId = new Map([...list, data?.other ?? UNKNOWN].map((a) => [a.id, a]));
    return { list, get: (id: string) => byId.get(id) ?? { ...UNKNOWN, id, name: id } };
  }, [data]);
}

/** A round avatar: the agent's drawn face, with its role icon in a small badge. */
export function AgentAvatar({ agent, size = 36, badge = true, decorative = false }: { agent: Agent; size?: number; badge?: boolean; decorative?: boolean }) {
  const Icon = ICONS[agent.icon as keyof typeof ICONS] ?? Sparkles;
  const label = decorative ? undefined : `${agent.name}, ${agent.role}`;
  return (
    <span className="ai-avatar" data-hue={agent.hue} style={{ "--avatar": `${size}px` } as CSSProperties}
      role={decorative ? undefined : "img"} aria-label={label} aria-hidden={decorative || undefined}>
      <AgentFace id={agent.id} size={size} />
      {badge ? <span className="ai-avatar-badge"><Icon size={Math.max(9, Math.round(size * 0.28))} aria-hidden /></span> : null}
    </span>
  );
}

/** Name and role next to the avatar. */
export function AgentLabel({ agent, size = 32, sub }: { agent: Agent; size?: number; sub?: string }) {
  return (
    <span className="ai-agent-label">
      <AgentAvatar agent={agent} size={size} decorative />
      <span className="ai-agent-text">
        <span className="ai-agent-name">{agent.name}</span>
        <span className="ai-agent-role">{sub ?? agent.role}</span>
      </span>
    </span>
  );
}
