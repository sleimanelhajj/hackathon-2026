// Number formats for the Logs page. AI calls cost fractions of a cent, so small amounts keep their digits.

/** $0 · $0.0004 · $0.03 · $1.25 · $1,240 */
export function usd(value: number): string {
  if (!value) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** 950 · 12.4K · 3.1M */
export const tokens = (n: number) => (n < 1000 ? String(n) : compact.format(n));

/** 120 ms · 2.4 s · 1 min 5 s */
export function duration(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const when = (iso: string) => timeFmt.format(new Date(iso));

/** find_products → Find products */
export const toolName = (name: string) => {
  const s = name.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Where each tool's data lives, for the agent map. */
export function toolSource(name: string): string {
  if (/widget|dashboard|page/.test(name)) return "Dashboards";
  if (name === "search_documents") return "Files";
  return "Sales database";
}
