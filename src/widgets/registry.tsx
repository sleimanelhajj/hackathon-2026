import { lazy, Suspense, type ComponentType } from "react";
import { BarChart3, Filter, FolderOpen, Hash, ListTodo, Paperclip, PieChart, Sparkles, Tags, Users, type LucideIcon } from "lucide-react";
import { ContactsWidget } from "./ContactsWidget";
import { AttachmentsWidget } from "./AttachmentsWidget";
import { BREAKDOWN_RULES, INSIGHT_FOCUS_LABELS, LIST_RULES, STAT_LABELS } from "../../shared/spec.js";
import type { InsightFocus, Widget, WidgetType } from "../lib/api";
import { CategoryBreakdownWidget, InsightListWidget } from "./InsightWidgets";
import { StatWidget } from "./StatWidget";
import { ThreadListWidget } from "./ThreadListWidget";
import { TopPeopleWidget } from "./TopPeopleWidget";
import { RuleListWidget } from "./RuleListWidget";
import { BreakdownWidget } from "./BreakdownWidget";

const ActivityChartWidget = lazy(() => import("./ActivityChartWidget"));

type AnyWidgetComponent = ComponentType<{ widget: never }>;

/** One entry per widget type: how to render it and which single setting users can change. */
export type WidgetDef = {
  icon: LucideIcon;
  component: AnyWidgetComponent;
  /** Stats are tiny and fixed height; folding them makes no sense. */
  collapsible: boolean;
  setting?: {
    label: string;
    options: { value: string | number; label: string }[];
    get: (w: Widget) => string | number;
    /** Returns the updated widget; titles follow the setting unless the user renamed them. */
    set: (w: Widget, value: string) => Widget;
  };
};

const LIST_TITLES = { awaitingYou: "Waiting on your reply", awaitingThem: "Waiting on their reply" } as const;

export const REGISTRY: Record<WidgetType, WidgetDef> = {
  stat: {
    icon: Hash,
    component: StatWidget as AnyWidgetComponent,
    collapsible: false,
    setting: {
      label: "Show",
      options: Object.entries(STAT_LABELS).map(([value, l]) => ({ value, label: l.title })),
      get: (w) => (w.type === "stat" ? w.metric : ""),
      set: (w, v) => (w.type === "stat" ? { ...w, metric: v as typeof w.metric, title: STAT_LABELS[v as typeof w.metric].title } : w),
    },
  },
  "thread-list": {
    icon: ListTodo,
    component: ThreadListWidget as AnyWidgetComponent,
    collapsible: true,
    setting: {
      label: "Show",
      options: Object.entries(LIST_TITLES).map(([value, label]) => ({ value, label })),
      get: (w) => (w.type === "thread-list" ? w.list : ""),
      set: (w, v) => (w.type === "thread-list" ? { ...w, list: v as typeof w.list, title: LIST_TITLES[v as typeof w.list] } : w),
    },
  },
  "rule-list": {
    icon: Filter,
    component: RuleListWidget as AnyWidgetComponent,
    collapsible: true,
    setting: {
      label: "Rule",
      options: Object.entries(LIST_RULES).map(([value, r]) => ({ value, label: r.title })),
      get: (w) => (w.type === "rule-list" ? w.rule : ""),
      set: (w, v) => (w.type === "rule-list" ? { ...w, rule: v as typeof w.rule, title: LIST_RULES[v as typeof w.rule].title } : w),
    },
  },
  breakdown: {
    icon: PieChart,
    component: BreakdownWidget as AnyWidgetComponent,
    collapsible: true,
    setting: {
      label: "Show",
      options: Object.entries(BREAKDOWN_RULES).map(([value, r]) => ({ value, label: r.title })),
      get: (w) => (w.type === "breakdown" ? w.rule : ""),
      set: (w, v) => (w.type === "breakdown" ? { ...w, rule: v as typeof w.rule, title: BREAKDOWN_RULES[v as typeof w.rule].title } : w),
    },
  },
  "activity-chart": {
    icon: BarChart3,
    component: ActivityChartWidget as AnyWidgetComponent,
    collapsible: true,
    setting: {
      label: "Range",
      options: [7, 14, 30].map((d) => ({ value: d, label: `${d} days` })),
      get: (w) => (w.type === "activity-chart" ? w.days : 14),
      set: (w, v) => (w.type === "activity-chart" ? { ...w, days: Number(v) } : w),
    },
  },
  "top-people": {
    icon: Users,
    component: TopPeopleWidget as AnyWidgetComponent,
    collapsible: true,
    setting: {
      label: "Show",
      options: [3, 5, 10].map((n) => ({ value: n, label: `Top ${n}` })),
      get: (w) => (w.type === "top-people" ? w.limit : 5),
      set: (w, v) => (w.type === "top-people" ? { ...w, limit: Number(v) } : w),
    },
  },
  "insight-list": {
    icon: Sparkles,
    component: InsightListWidget as AnyWidgetComponent,
    collapsible: true,
    setting: {
      label: "Show",
      options: Object.entries(INSIGHT_FOCUS_LABELS).map(([value, label]) => ({ value, label })),
      get: (w) => (w.type === "insight-list" ? w.focus : ""),
      set: (w, v) =>
        w.type === "insight-list" ? { ...w, focus: v as InsightFocus, title: INSIGHT_FOCUS_LABELS[v as InsightFocus] } : w,
    },
  },
  "category-breakdown": {
    icon: Tags,
    component: CategoryBreakdownWidget as AnyWidgetComponent,
    collapsible: true,
  },
  contacts: {
    icon: FolderOpen,
    component: ContactsWidget as AnyWidgetComponent,
    collapsible: true,
    setting: {
      label: "Show",
      options: [
        { value: "all", label: "Everyone" },
        { value: "new", label: "New contacts only" },
      ],
      get: (w) => (w.type === "contacts" ? w.show : "all"),
      set: (w, v) =>
        w.type === "contacts" ? { ...w, show: v === "new" ? "new" : "all", title: v === "new" ? "New contacts" : "Contacts" } : w,
    },
  },
  attachments: {
    icon: Paperclip,
    component: AttachmentsWidget as AnyWidgetComponent,
    collapsible: true,
  },
};

export function WidgetBody({ widget }: { widget: Widget }) {
  const Component = REGISTRY[widget.type].component as ComponentType<{ widget: Widget }>;
  return (
    <Suspense fallback={<div className="skeleton widget-skeleton" />}>
      <Component widget={widget} />
    </Suspense>
  );
}
