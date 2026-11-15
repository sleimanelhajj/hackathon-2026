// Ready-made widgets the assistant can add to a board (decision #60): every widget in the "Add widgets" panel, with its
// one setting, named by a plain "kind" ("sales-kpi:revenue", "payments:to-pay", "sales-trend"). The model picks a kind
// from this list; the widget itself is built here from the catalogue, so it's always valid.
import {
  BREAKDOWN_RULES, CATALOG, INSIGHT_FOCUS_LABELS, LIST_RULES, PAYMENTS_SHOW_LABELS, SALES_BREAKDOWN_LABELS, SALES_CATALOG, SALES_METRIC_LABELS,
  SALES_TABLE_LABELS, STAT_LABELS, Widget,
} from "../shared/spec.js";

const LIST_TITLES = { awaitingYou: "Waiting on your reply", awaitingThem: "Waiting on their reply" };
/** type → [setting field, { value: title }] for widgets with one setting. */
const SETTINGS = {
  stat: ["metric", Object.fromEntries(Object.entries(STAT_LABELS).map(([k, v]) => [k, v.title]))],
  "thread-list": ["list", LIST_TITLES],
  "rule-list": ["rule", Object.fromEntries(Object.entries(LIST_RULES).map(([k, v]) => [k, v.title]))],
  breakdown: ["rule", Object.fromEntries(Object.entries(BREAKDOWN_RULES).map(([k, v]) => [k, v.title]))],
  "insight-list": ["focus", INSIGHT_FOCUS_LABELS],
  contacts: ["show", { all: "Contacts", new: "New contacts" }],
  payments: ["show", PAYMENTS_SHOW_LABELS],
  "sales-kpi": ["metric", SALES_METRIC_LABELS],
  "sales-breakdown": ["by", SALES_BREAKDOWN_LABELS],
  "sales-table": ["table", SALES_TABLE_LABELS],
};

function kindsOf(catalog, data) {
  const out = [];
  for (const [type, entry] of Object.entries(catalog)) {
    if (entry.hidden) continue;
    const setting = SETTINGS[type];
    if (!setting) { out.push({ kind: type, label: entry.label, data }); continue; }
    for (const [value, title] of Object.entries(setting[1])) out.push({ kind: `${type}:${value}`, label: `${entry.label}: ${title}`, data });
  }
  return out;
}

/** Every kind, with a label and whether it shows email or sales data. */
export const WIDGET_KINDS = [...kindsOf(CATALOG, "email"), ...kindsOf(SALES_CATALOG, "sales")];
const KNOWN = new Set(WIDGET_KINDS.map((k) => k.kind));

/** The widget (without id) and its default grid size for a kind. Throws for an unknown kind. */
export function widgetFromKind(kind) {
  if (!KNOWN.has(kind)) throw new Error(`"${kind}" isn't a widget. Choose one of: ${[...KNOWN].join(", ")}.`);
  const [type, value] = kind.split(":");
  const entry = CATALOG[type] ?? SALES_CATALOG[type];
  let widget = entry.create();
  if (value !== undefined) {
    const [field, titles] = SETTINGS[type];
    widget = { ...widget, [field]: value, title: titles[value] };
  }
  Widget.parse({ id: "check", ...widget });
  // At least 3 columns: a 2-column number fits the Sales row of six, but is cramped beside other widgets.
  return { widget, size: { w: Math.max(3, entry.size.w), h: entry.size.h } };
}
