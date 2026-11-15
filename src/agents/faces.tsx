import { useId } from "react";

// Drawn faces for the AI agents (decision #67): one small SVG portrait each (64×64, clipped to a circle), built from
// simple shapes so it stays crisp at any size. Colours are CSS tokens (--skin-*, --hair-*, --face-*, --agent-<hue>-*).
// Works inside HTML (an avatar) and inside another SVG (the space map) with x/y.

type Hair = "long" | "short" | "bob" | "bun" | "curly" | "pixie";
type Extra = "headset" | "glasses" | "earrings" | "round-glasses" | "beard" | "headband";
type Face = { skin: 1 | 2 | 3 | 4; hair: Hair; hairColor: "black" | "dark" | "brown" | "auburn"; extras: Extra[]; hue: string };

const FACES: Record<string, Face> = {
  layla: { skin: 2, hair: "long", hairColor: "dark", extras: ["headset", "earrings"], hue: "sky" },
  sami: { skin: 1, hair: "short", hairColor: "black", extras: ["glasses"], hue: "lavender" },
  nadia: { skin: 2, hair: "bob", hairColor: "auburn", extras: ["earrings"], hue: "rose" },
  lina: { skin: 1, hair: "bun", hairColor: "brown", extras: ["round-glasses"], hue: "teal" },
  hadi: { skin: 3, hair: "short", hairColor: "black", extras: ["beard"], hue: "amber" },
  rayan: { skin: 3, hair: "curly", hairColor: "black", extras: [], hue: "indigo" },
  tala: { skin: 4, hair: "pixie", hairColor: "black", extras: ["headband", "earrings"], hue: "green" },
};

const fill = (v: string) => ({ fill: `var(${v})` });
const stroke = (v: string, w = 1.4) => ({ stroke: `var(${v})`, strokeWidth: w, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

/** A face for an agent id; unknown ids (the workspace itself) get a friendly robot. */
export function AgentFace({ id, size = 64, x, y, title }: { id: string; size?: number; x?: number; y?: number; title?: string }) {
  const uid = useId().replace(/:/g, "");
  const face = FACES[id];
  const hue = face?.hue ?? "slate";
  const hair = `--hair-${face?.hairColor ?? "black"}`;
  const skin = `--skin-${face?.skin ?? 2}`;
  return (
    <svg className="agent-face" viewBox="0 0 64 64" width={size} height={size} x={x} y={y} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <clipPath id={`clip-${uid}`}><circle cx="32" cy="32" r="32" /></clipPath>
        <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: `var(--agent-${hue}-1)` }} />
          <stop offset="1" style={{ stopColor: `var(--agent-${hue}-2)` }} />
        </linearGradient>
      </defs>
      <g clipPath={`url(#clip-${uid})`}>
        <rect width="64" height="64" fill={`url(#bg-${uid})`} />
        <circle cx="20" cy="14" r="18" style={{ fill: "var(--face-sheen)" }} />
        {face ? <Person face={face} hair={hair} skin={skin} /> : <Robot />}
      </g>
    </svg>
  );
}

function Person({ face, hair, skin }: { face: Face; hair: string; skin: string }) {
  const has = (e: Extra) => face.extras.includes(e);
  return (
    <>
      {/* hair that falls behind the head */}
      {face.hair === "long" && <path d="M16 31 C13 17 21 9 32 9 C44 9 51 17 48 31 C50 43 47 52 45 56 L19 56 C16 50 14 42 16 31 Z" style={fill(hair)} />}
      {face.hair === "bob" && <path d="M16 34 C14 19 21 10 32 10 C44 10 50 19 48 34 C48 39 46 42 43 42 L21 42 C18 42 16 39 16 34 Z" style={fill(hair)} />}
      {face.hair === "bun" && <circle cx="32" cy="8.5" r="6.5" style={fill(hair)} />}

      {/* shoulders, neck, head, ears */}
      <path d="M8 66 C10 51 21 46 32 46 C43 46 54 51 56 66 Z" style={fill(`--agent-${face.hue}-2`)} />
      <path d="M24 49 L32 55 L40 49" style={stroke("--face-collar", 1.6)} />
      <rect x="27" y="37" width="10" height="11" rx="4" style={fill(skin)} />
      <rect x="27" y="40" width="10" height="4" style={{ fill: "var(--face-shade)" }} />
      <ellipse cx="19.5" cy="29.5" rx="2.6" ry="3.4" style={fill(skin)} />
      <ellipse cx="44.5" cy="29.5" rx="2.6" ry="3.4" style={fill(skin)} />
      <ellipse cx="32" cy="28" rx="13" ry="15" style={fill(skin)} />

      {/* hair on top */}
      {face.hair === "long" && <path d="M18.5 27 C19 15 27 11.5 34 12.5 C41 13.5 46 19 45.5 27.5 C41 20.5 34 18.5 28 21 C24 22.5 21 24.5 18.5 27 Z" style={fill(hair)} />}
      {face.hair === "short" && <path d="M18.8 27.5 C17.5 15.5 25 10.5 33 10.5 C41.5 10.5 46.5 16.5 45.2 27.5 C43.5 20.5 38.5 17.5 32 17.5 C25.5 17.5 20.5 21 18.8 27.5 Z" style={fill(hair)} />}
      {face.hair === "bob" && <path d="M18.6 28 C18.5 17 25.5 12 33 12 C40.5 12 46 17 45.6 27 C38 25 30.5 21 26.5 16.5 C24.5 20.5 22 24.5 18.6 28 Z" style={fill(hair)} />}
      {face.hair === "bun" && <path d="M18.8 27.5 C18.8 17 25 12.5 32 12.5 C39 12.5 45.2 17 45.2 27.5 C42.5 20.5 37.5 17.5 32 17.5 C26.5 17.5 21.5 20.5 18.8 27.5 Z" style={fill(hair)} />}
      {face.hair === "curly" && (
        <g style={fill(hair)}>
          <circle cx="20.5" cy="23" r="5.5" /><circle cx="25" cy="16.5" r="6" /><circle cx="32" cy="14" r="6.5" />
          <circle cx="39" cy="16.5" r="6" /><circle cx="43.5" cy="23" r="5.5" /><circle cx="28.5" cy="19.5" r="5" /><circle cx="36" cy="19.5" r="5" />
        </g>
      )}
      {face.hair === "pixie" && <path d="M18.6 28.5 C17.5 16 26 11 34 12 C42 13 47 19 45.3 28 C42 22 36 18.5 30 19.5 C25 20.5 21.5 24 18.6 28.5 Z" style={fill(hair)} />}
      {has("headband") && <path d="M19.5 22.5 C24 16.5 40 16.5 44.5 22.5" style={stroke(`--agent-${face.hue}-1`, 2.6)} />}

      {/* face */}
      <path d="M24.5 24.6 Q27 23.4 29.4 24.4" style={stroke(hair, 1.3)} />
      <path d="M34.6 24.4 Q37 23.4 39.5 24.6" style={stroke(hair, 1.3)} />
      <ellipse cx="27" cy="28.8" rx="1.7" ry="2.1" style={fill("--face-ink")} />
      <ellipse cx="37" cy="28.8" rx="1.7" ry="2.1" style={fill("--face-ink")} />
      <circle cx="27.6" cy="28.1" r="0.6" style={fill("--face-light")} />
      <circle cx="37.6" cy="28.1" r="0.6" style={fill("--face-light")} />
      <path d="M32 30.5 Q31 33 32.6 33.4" style={stroke("--face-shade", 1.1)} />
      <circle cx="23.6" cy="33.4" r="2.3" style={fill("--face-blush")} />
      <circle cx="40.4" cy="33.4" r="2.3" style={fill("--face-blush")} />
      {has("beard") ? (
        <>
          <path d="M19.5 29.5 C20.5 41 25.5 45 32 45 C38.5 45 43.5 41 44.5 29.5 C42.5 36 38.5 39.5 32 39.5 C25.5 39.5 21.5 36 19.5 29.5 Z" style={fill(hair)} />
          <path d="M27.5 35.6 Q32 34 36.5 35.6" style={stroke(hair, 2.2)} />
          <path d="M29 37.2 Q32 38.8 35 37.2" style={stroke("--face-lip", 1.4)} />
        </>
      ) : (
        <path d="M28.4 36 Q32 39.2 35.6 36" style={stroke("--face-lip", 1.6)} />
      )}

      {/* accessories */}
      {has("glasses") && (
        <g style={stroke("--face-ink", 1.3)}>
          <rect x="22.6" y="25.8" width="8.6" height="6.4" rx="2.4" /><rect x="32.8" y="25.8" width="8.6" height="6.4" rx="2.4" />
          <path d="M31.2 28.4 L32.8 28.4" /><path d="M22.6 28 L19.8 27.2" /><path d="M41.4 28 L44.2 27.2" />
        </g>
      )}
      {has("round-glasses") && (
        <g style={stroke("--face-ink", 1.2)}>
          <circle cx="27" cy="29" r="3.9" /><circle cx="37" cy="29" r="3.9" /><path d="M30.9 28.6 Q32 27.6 33.1 28.6" />
        </g>
      )}
      {has("earrings") && (
        <g style={fill("--face-gold")}>
          <circle cx="19.4" cy="34.4" r="1.4" /><circle cx="44.6" cy="34.4" r="1.4" />
        </g>
      )}
      {has("headset") && (
        <g>
          <path d="M17.5 29 C17.5 12 46.5 12 46.5 29" style={stroke("--face-ink", 1.8)} />
          <rect x="15" y="26" width="5" height="8" rx="2.4" style={fill("--face-ink")} />
          <path d="M17.5 33 Q19 39.5 26 39.5" style={stroke("--face-ink", 1.3)} />
          <circle cx="26.5" cy="39.5" r="1.6" style={fill("--face-ink")} />
        </g>
      )}
    </>
  );
}

/** The workspace's own AI work: a friendly robot. */
function Robot() {
  return (
    <>
      <path d="M8 66 C10 51 21 47 32 47 C43 47 54 51 56 66 Z" style={fill("--agent-slate-2")} />
      <path d="M32 9 L32 14" style={stroke("--face-ink", 1.8)} />
      <circle cx="32" cy="8" r="2.4" style={fill("--face-gold")} />
      <rect x="27" y="38" width="10" height="10" rx="3" style={fill("--agent-slate-1")} />
      <rect x="17" y="14" width="30" height="27" rx="9" style={fill("--face-robot")} />
      <rect x="21" y="21" width="22" height="11" rx="5.5" style={fill("--face-ink")} />
      <circle cx="27" cy="26.5" r="2.3" style={fill("--face-glow")} />
      <circle cx="37" cy="26.5" r="2.3" style={fill("--face-glow")} />
      <path d="M27 36 Q32 38.5 37 36" style={stroke("--face-ink", 1.5)} />
    </>
  );
}
