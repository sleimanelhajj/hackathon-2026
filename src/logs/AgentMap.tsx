import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Square } from "lucide-react";
import type { Agent, AgentRun } from "../lib/api";
import { AgentFace } from "../agents/faces";
import { buildAgentMap, type MapEdge, type MapNode } from "./graph";
import { buildTour, DEMO_RUNS, type Hop } from "./demo";
import { tokens, usd } from "./format";

// The agent map as a field in space (decision #67). Gemini is the sun in the middle; the agents are planets with
// their faces; tools are small moons; where the data lives are ringed planets; "You" and "Automatic" are the comets
// that start the work. Positions come from a small force layout (linked things pull together, everything else
// pushes apart), computed once. Links that happened in the period glow and flow; the others are faint dashes.
// "Play demo" flies a comet along the links through an example task, with a caption for every step.

const W = 1000, H = 640, CX = 500, CY = 322;
const RADIUS = { trigger: 13, agent: 27, model: 44, tool: 9, data: 17 } as const;
const LENGTH: Record<MapEdge["kind"], number> = { starts: 210, delegates: 150, asks: 200, uses: 120, from: 140, reads: 240 };
const VERB: Record<MapEdge["kind"], string> = { starts: "started", delegates: "handed work to", asks: "asked", uses: "used", from: "reads", reads: "is given" };
const HOP_MS = 1150;
const PAUSE_MS = 1500;
const TRAIL = 7;

type Point = { x: number; y: number };

/** Places the nodes: a starting arrangement by kind, then a few hundred steps of a simple force layout. */
function placeNodes(nodes: MapNode[], edges: MapEdge[]): Map<string, Point> {
  const pos = new Map<string, Point>();
  const agents = nodes.filter((n) => n.kind === "agent");
  const data = nodes.filter((n) => n.kind === "data");
  agents.forEach((n, i) => {
    const a = -Math.PI / 2 + (i / agents.length) * Math.PI * 2;
    pos.set(n.id, { x: CX + Math.cos(a) * 250, y: CY + Math.sin(a) * 185 });
  });
  data.forEach((n, i) => {
    const a = -Math.PI / 2 + ((i + 0.5) / data.length) * Math.PI * 2;
    pos.set(n.id, { x: CX + Math.cos(a) * 420, y: CY + Math.sin(a) * 265 });
  });
  nodes.forEach((n, i) => {
    if (n.kind === "model") pos.set(n.id, { x: CX, y: CY });
    if (n.kind === "trigger") pos.set(n.id, { x: 80, y: n.id.endsWith("you") ? CY - 140 : CY + 140 });
    if (n.kind === "tool") {
      const owner = edges.find((e) => e.to === n.id && pos.has(e.from));
      const o = owner ? pos.get(owner.from)! : { x: CX, y: CY };
      const a = Math.atan2(o.y - CY, o.x - CX) + ((i % 3) - 1) * 0.35;
      pos.set(n.id, { x: o.x + Math.cos(a) * 130, y: o.y + Math.sin(a) * 110 });
    }
  });

  const ids = [...pos.keys()];
  const kind = new Map(nodes.map((n) => [n.id, n.kind]));
  const STEPS = 320;
  for (let step = 0; step < STEPS; step++) {
    const alpha = 1 - step / STEPS;
    const force = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i])!, b = pos.get(ids[j])!;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 400);
        const f = 30000 / d2, d = Math.sqrt(d2);
        force.get(ids[i])!.x += (dx / d) * f; force.get(ids[i])!.y += (dy / d) * f;
        force.get(ids[j])!.x -= (dx / d) * f; force.get(ids[j])!.y -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b || e.from === e.to) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy));
      const k = 0.05 * (d - LENGTH[e.kind]);
      force.get(e.from)!.x += (dx / d) * k; force.get(e.from)!.y += (dy / d) * k;
      force.get(e.to)!.x -= (dx / d) * k; force.get(e.to)!.y -= (dy / d) * k;
    }
    for (const id of ids) {
      const p = pos.get(id)!, f = force.get(id)!;
      if (kind.get(id) === "model") continue; // the sun stays in the middle
      f.x += (CX - p.x) * 0.012;
      f.y += (CY - p.y) * 0.02;
      if (kind.get(id) === "trigger") f.x += (80 - p.x) * 0.25; // comets stay on the left, where the work comes in
      const size = Math.hypot(f.x, f.y), cap = 26 * alpha;
      const scale = size > cap ? cap / size : 1;
      p.x = Math.min(W - 70, Math.max(70, p.x + f.x * scale * alpha));
      p.y = Math.min(H - 64, Math.max(56, p.y + f.y * scale * alpha));
    }
  }
  return pos;
}

/** A gently curved link from a to b (curving the same way for every link, like orbits). */
function curve(a: Point, b: Point) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${(mx - dy * 0.14).toFixed(1)} ${(my + dx * 0.14).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** Fixed, seeded star positions so the sky doesn't change between renders. */
function stars(count: number) {
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: count }, (_, i) => ({ x: rand() * W, y: rand() * H, r: 0.35 + rand() * 1.25, twinkle: i % 4 === 0, delay: rand() * 5 }));
}
const STARS = stars(170);

export function AgentMap({ runs, team, days }: { runs: AgentRun[]; team: Agent[]; days: number }) {
  const real = useMemo(() => buildAgentMap(runs, team), [runs, team]);
  // The layout includes the demo's links too, so the tour has somewhere to fly; they show as unused until it plays.
  const all = useMemo(() => buildAgentMap([...runs, ...DEMO_RUNS], team), [runs, team]);
  const pos = useMemo(() => placeNodes(all.nodes, all.edges), [all]);
  const realCount = useMemo(() => new Map([...real.nodes.map((n) => [n.id, n.count] as const), ...real.edges.map((e) => [e.id, e.count] as const)]), [real]);
  const realEdge = useMemo(() => new Map(real.edges.map((e) => [e.id, e])), [real]);
  const teamById = useMemo(() => new Map(team.map((a) => [a.id, a])), [team]);
  const lookup = useMemo(() => ({ get: (id: string) => teamById.get(id) ?? { ...team[0], id, name: id, role: "" } }), [teamById, team]);

  const [focus, setFocus] = useState<string | null>(null);
  const [tour, setTour] = useState<{ hops: Hop[]; index: number; playing: boolean; done: boolean } | null>(null);
  const paths = useRef(new Map<string, SVGPathElement>());
  const cometRef = useRef<SVGGElement>(null);
  const trailRefs = useRef<(SVGCircleElement | null)[]>([]);
  const hop = tour ? tour.hops[Math.min(tour.index, tour.hops.length - 1)] : null;
  const active = hop ? new Set([hop.from, hop.to]) : null;

  // Fly the comet along the current leg, wait on the caption, then go to the next leg.
  useEffect(() => {
    if (!tour || !tour.playing || tour.done || !hop) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const forward = paths.current.get(`${hop.from}>${hop.to}`), backward = paths.current.get(`${hop.to}>${hop.from}`);
    const a = pos.get(hop.from) ?? { x: CX, y: CY }, b = pos.get(hop.to) ?? { x: CX, y: CY };
    const at = (t: number): Point => {
      const path = forward ?? backward;
      if (path) {
        const len = path.getTotalLength();
        const p = path.getPointAtLength(len * (forward ? t : 1 - t));
        return { x: p.x, y: p.y };
      }
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    };
    const history: Point[] = [];
    const place = (p: Point) => {
      cometRef.current?.setAttribute("transform", `translate(${p.x} ${p.y})`);
      history.unshift(p);
      history.length = Math.min(history.length, TRAIL);
      trailRefs.current.forEach((c, i) => {
        const q = history[i + 1] ?? p;
        c?.setAttribute("cx", String(q.x));
        c?.setAttribute("cy", String(q.y));
      });
    };
    let frame = 0, timer = 0;
    const started = performance.now();
    const duration = reduce ? 0 : HOP_MS;
    const tick = (now: number) => {
      const t = duration ? Math.min(1, (now - started) / duration) : 1;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      place(at(eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else timer = window.setTimeout(() => setTour((s) => (!s ? s : s.index + 1 >= s.hops.length ? { ...s, playing: false, done: true } : { ...s, index: s.index + 1 })), PAUSE_MS);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [tour, hop, pos]);

  const play = () => setTour({ hops: buildTour(DEMO_RUNS, lookup), index: 0, playing: true, done: false });
  const linked = (e: MapEdge) => (focus != null && (e.from === focus || e.to === focus)) || (active != null && active.has(e.from) && active.has(e.to));
  const dimmed = (id: string) => (active ? !active.has(id) : focus != null && focus !== id && !all.edges.some((e) => (e.from === focus && e.to === id) || (e.to === focus && e.from === id)));
  const title = (e: MapEdge) => {
    const r = realEdge.get(e.id);
    const a = all.nodes.find((n) => n.id === e.from)?.label, b = all.nodes.find((n) => n.id === e.to)?.label;
    if (!r?.count) return e.kind === "reads" ? `${a} is given ${b} to read` : `${a} → ${b}: not used in the last ${days} days`;
    return `${a} ${VERB[e.kind]} ${b}${e.kind === "reads" ? "" : ` ${r.count} time${r.count === 1 ? "" : "s"}`}${e.kind === "asks" ? ` · ${tokens(r.tokens)} tokens · ${usd(r.costUsd)}` : ""}`;
  };
  const speaker = hop ? lookup.get(hop.speaker) : null;
  const used = real.edges.filter((e) => e.count > 0).length;

  return (
    <div className="space" data-touring={tour ? "true" : undefined}>
      <div className="space-bar">
        <p className="space-chip">{used} link{used === 1 ? "" : "s"} used in the last {days} days</p>
        <div className="space-controls">
          {!tour ? (
            <button type="button" className="btn btn-primary space-play" onClick={play}><Play size={15} aria-hidden /> Play demo</button>
          ) : tour.done ? (
            <>
              <button type="button" className="btn btn-primary space-play" onClick={play}><RotateCcw size={15} aria-hidden /> Play again</button>
              <button type="button" className="btn btn-secondary" onClick={() => setTour(null)}><Square size={14} aria-hidden /> Close</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setTour((s) => s && { ...s, playing: !s.playing })}>
                {tour.playing ? <><Pause size={15} aria-hidden /> Pause</> : <><Play size={15} aria-hidden /> Resume</>}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setTour(null)}><Square size={14} aria-hidden /> Stop</button>
            </>
          )}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="space-svg" role="img" aria-label={`Agent map for the last ${days} days`}>
        <defs>
          <radialGradient id="space-sun" cx="50%" cy="50%" r="50%">
            <stop offset="0" style={{ stopColor: "var(--sun-core)" }} />
            <stop offset="0.45" style={{ stopColor: "var(--sun-mid)" }} />
            <stop offset="1" style={{ stopColor: "var(--sun-edge)" }} />
          </radialGradient>
          <radialGradient id="space-corona" cx="50%" cy="50%" r="50%">
            <stop offset="0" style={{ stopColor: "var(--sun-mid)", stopOpacity: 0.55 }} />
            <stop offset="1" style={{ stopColor: "var(--sun-edge)", stopOpacity: 0 }} />
          </radialGradient>
          {["1", "2", "3"].map((k) => (
            <radialGradient key={k} id={`space-nebula-${k}`} cx="50%" cy="50%" r="50%">
              <stop offset="0" style={{ stopColor: `var(--space-nebula-${k})` }} />
              <stop offset="1" style={{ stopColor: `var(--space-nebula-${k})`, stopOpacity: 0 }} />
            </radialGradient>
          ))}
          <radialGradient id="space-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0.55" style={{ stopColor: "var(--space-halo)", stopOpacity: 0.55 }} />
            <stop offset="1" style={{ stopColor: "var(--space-halo)", stopOpacity: 0 }} />
          </radialGradient>
          <filter id="space-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* the sky */}
        <ellipse cx={W * 0.22} cy={H * 0.3} rx={300} ry={190} fill="url(#space-nebula-1)" />
        <ellipse cx={W * 0.8} cy={H * 0.7} rx={340} ry={210} fill="url(#space-nebula-2)" />
        <ellipse cx={W * 0.62} cy={H * 0.18} rx={220} ry={140} fill="url(#space-nebula-3)" />
        <g className="space-stars" aria-hidden>
          {STARS.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} data-twinkle={s.twinkle || undefined} style={s.twinkle ? { animationDelay: `${s.delay.toFixed(2)}s` } : undefined} />)}
        </g>
        <ellipse cx={CX} cy={CY} rx={250} ry={185} className="space-orbit" />
        <ellipse cx={CX} cy={CY} rx={420} ry={265} className="space-orbit" />

        {/* links */}
        <g>
          {all.edges.map((e) => {
            const a = pos.get(e.from), b = pos.get(e.to);
            if (!a || !b) return null;
            const count = realCount.get(e.id) ?? 0;
            const d = curve(a, b);
            const isActive = linked(e);
            const width = count ? 1.1 + Math.min(3.6, Math.log2(1 + count) * 1.1) : 1;
            return (
              <g key={e.id} className="space-link" data-kind={e.kind} data-idle={!count || undefined} data-active={isActive || undefined}
                data-dim={((focus != null || active != null) && !isActive) || undefined}>
                <path ref={(el) => { if (el) paths.current.set(e.id, el); else paths.current.delete(e.id); }} d={d} className="space-link-line" strokeWidth={width}>
                  <title>{title(e)}</title>
                </path>
                {count || isActive ? <path d={d} className="space-link-flow" strokeWidth={Math.max(1.2, width * 0.7)} /> : null}
              </g>
            );
          })}
        </g>

        {/* bodies */}
        <g>
          {all.nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const r = n.kind === "agent" && n.agentId === team.find((t) => !t.parent)?.id ? 33 : RADIUS[n.kind];
            const count = realCount.get(n.id) ?? 0;
            return (
              <g key={n.id} className="space-node" data-kind={n.kind} data-idle={!count || undefined} data-active={active?.has(n.id) || undefined} data-dim={dimmed(n.id) || undefined}
                transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} tabIndex={0} role="button"
                aria-label={`${n.label}${n.sub ? `, ${n.sub}` : ""}: ${count} in the last ${days} days`}
                onMouseEnter={() => setFocus(n.id)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(n.id)} onBlur={() => setFocus(null)}>
                <g className="space-body">
                  {n.kind === "model" && (
                    <>
                      <circle r={r * 2.1} fill="url(#space-corona)" className="space-corona" />
                      <circle r={r} fill="url(#space-sun)" filter="url(#space-glow)" />
                    </>
                  )}
                  {n.kind === "agent" && (
                    <>
                      <circle r={r + 12} fill="url(#space-halo)" className="space-halo" />
                      <circle r={r + 2.5} className="space-planet-rim" />
                      <AgentFace id={n.agentId ?? "app"} size={r * 2} x={-r} y={-r} />
                    </>
                  )}
                  {n.kind === "data" && (
                    <>
                      <circle r={r} className="space-planet" />
                      <ellipse rx={r * 1.75} ry={r * 0.5} transform="rotate(-18)" className="space-ring" />
                    </>
                  )}
                  {n.kind === "tool" && <circle r={r} className="space-moon" />}
                  {n.kind === "trigger" && <path d={`M${-r} 0 L0 ${-r} L${r} 0 L0 ${r} Z`} className="space-comet" filter="url(#space-glow)" />}
                </g>
                <text y={r + (n.kind === "tool" ? 14 : 17)} textAnchor="middle" className="space-label" data-kind={n.kind}>{n.label}</text>
                {n.kind === "agent" || n.kind === "model" ? <text y={r + 31} textAnchor="middle" className="space-sub">{n.sub}</text> : null}
                {count ? <text y={-r - 8} textAnchor="middle" className="space-count">{count}</text> : null}
              </g>
            );
          })}
        </g>

        {/* the demo's comet */}
        {tour && !tour.done ? (
          <g aria-hidden>
            {Array.from({ length: TRAIL - 1 }, (_, i) => (
              <circle key={i} ref={(el) => { trailRefs.current[i] = el; }} r={4.2 - i * 0.55} className="space-trail" style={{ opacity: 0.55 - i * 0.08 }} cx={-50} cy={-50} />
            ))}
            <g ref={cometRef} transform="translate(-50 -50)">
              <circle r={11} className="space-comet-glow" />
              <circle r={4.6} className="space-comet-head" filter="url(#space-glow)" />
            </g>
          </g>
        ) : null}
      </svg>

      {tour && hop ? (
        <div className="space-caption" aria-live="polite">
          {speaker ? <AgentFace id={speaker.id} size={46} title={speaker.name} /> : null}
          <div className="space-caption-text">
            <p className="space-caption-kicker">Example task, not a real run · step {Math.min(tour.index + 1, tour.hops.length)} of {tour.hops.length}</p>
            <p className="space-caption-title">{tour.done ? "That's the whole round trip." : hop.title}</p>
            {tour.done ? <p className="space-caption-detail">Every real task is recorded the same way: pick one under Step by step to replay it.</p>
              : hop.detail ? <p className="space-caption-detail">{hop.detail}</p> : null}
            <span className="space-progress" aria-hidden><i style={{ width: `${((tour.done ? tour.hops.length : tour.index + 1) / tour.hops.length) * 100}%` }} /></span>
          </div>
        </div>
      ) : null}

      <p className="space-legend">
        <span><i data-kind="sun" aria-hidden /> Gemini</span>
        <span><i data-kind="planet" aria-hidden /> agents</span>
        <span><i data-kind="moon" aria-hidden /> tools</span>
        <span><i data-kind="ringed" aria-hidden /> where the data lives</span>
        <span><i data-kind="flow" aria-hidden /> used in the last {days} days</span>
        <span><i data-kind="idle" aria-hidden /> not used</span>
      </p>
    </div>
  );
}
