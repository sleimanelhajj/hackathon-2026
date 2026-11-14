import type { CSSProperties, ReactNode } from "react";

/**
 * Loading placeholders shaped like the page they stand in for, so nothing jumps when the data arrives.
 * Each one is a single polite "Loading …" status for screen readers; the shapes themselves are hidden from them.
 * The pulse is opacity-only (cheap to draw) and stops for people who reduce motion (global rule in index.css).
 */

type Shape = "stat" | "list" | "chart" | "table";

const Bone = ({ w = "100%", h = 12, round = false, style }: { w?: number | string; h?: number; round?: boolean; style?: CSSProperties }) => (
  <span className="bone" data-round={round || undefined} style={{ width: w, height: h, ...style }} />
);

/** Fixed, varied widths so the placeholder text looks like text, and stays the same on every render. */
const LINE_WIDTHS = ["72%", "58%", "84%", "64%", "76%", "52%", "68%"];
const BAR_HEIGHTS = [38, 52, 46, 61, 55, 70, 64, 78, 58, 83, 74, 90];

function Status({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  // Without a label the skeleton is part of a bigger one that already announces itself.
  if (!label) return <div className={className} aria-hidden="true">{children}</div>;
  // The layout class (grid, table, stack) goes on the element that directly holds the shapes; the status wrapper
  // around it only announces, so it must not change the layout.
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <div aria-hidden="true" className={className}>{children}</div>
    </div>
  );
}

function Card({ shape, span, rows = 5 }: { shape: Shape; span: number; rows?: number }) {
  return (
    <div className="skeleton-card" data-shape={shape} style={{ "--span": span } as CSSProperties}>
      <Bone w={shape === "stat" ? "46%" : "34%"} h={shape === "stat" ? 11 : 14} />
      {shape === "stat" && (
        <>
          <Bone w="52%" h={30} style={{ marginTop: 4 }} />
          <Bone w="70%" h={10} />
        </>
      )}
      {shape === "list" && (
        <div className="skeleton-list">
          {Array.from({ length: rows }, (_, i) => (
            <div className="skeleton-list-row" key={i}>
              <Bone w={30} h={30} round />
              <div className="skeleton-lines">
                <Bone w={LINE_WIDTHS[i % LINE_WIDTHS.length]} h={11} />
                <Bone w={LINE_WIDTHS[(i + 3) % LINE_WIDTHS.length]} h={9} />
              </div>
              <Bone w={44} h={10} />
            </div>
          ))}
        </div>
      )}
      {shape === "chart" && (
        <div className="skeleton-chart">
          {BAR_HEIGHTS.map((h, i) => <Bone key={i} h={0} style={{ height: `${h}%` }} />)}
        </div>
      )}
    </div>
  );
}

const BOARDS: Record<"dashboard" | "sales", [Shape, number][]> = {
  dashboard: [["stat", 3], ["stat", 3], ["stat", 3], ["stat", 3], ["list", 6], ["list", 6], ["chart", 8], ["list", 4]],
  sales: [["stat", 3], ["stat", 3], ["stat", 3], ["stat", 3], ["chart", 8], ["list", 4], ["list", 6], ["list", 6]],
};

/** A board of widget cards, laid out like the default dashboard or sales board. */
export function BoardSkeleton({ kind, label }: { kind: "dashboard" | "sales"; label?: string }) {
  return (
    <Status label={label} className="skeleton-board">
      {BOARDS[kind].map(([shape, span], i) => <Card key={i} shape={shape} span={span} />)}
    </Status>
  );
}

/** Table rows, for lists like All email. */
export function TableSkeleton({ rows = 8, label }: { rows?: number; label?: string }) {
  return (
    <Status label={label} className="skeleton-table">
      <div className="skeleton-table-head skeleton-row-head">
        <Bone w={60} h={10} /><Bone w="22%" h={10} /><Bone w="30%" h={10} /><Bone w={70} h={10} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <Bone w={18} h={18} round />
          <div className="skeleton-lines" style={{ flex: "0 0 24%" }}>
            <Bone w={LINE_WIDTHS[i % LINE_WIDTHS.length]} h={11} />
            <Bone w="46%" h={9} />
          </div>
          <div className="skeleton-lines" style={{ flex: 1 }}>
            <Bone w={LINE_WIDTHS[(i + 2) % LINE_WIDTHS.length]} h={11} />
            <Bone w={LINE_WIDTHS[(i + 4) % LINE_WIDTHS.length]} h={9} />
          </div>
          <Bone w={64} h={10} />
        </div>
      ))}
    </Status>
  );
}

/** Connector cards, for the Integrations page. */
export function IntegrationsSkeleton({ label }: { label?: string }) {
  return (
    <Status label={label} className="skeleton-stack">
      <div className="skeleton-card skeleton-callout" data-shape="callout">
        <Bone w={34} h={34} />
        <div className="skeleton-lines" style={{ flex: 1 }}><Bone w="40%" h={13} /><Bone w="64%" h={10} /></div>
        <Bone w={120} h={36} />
      </div>
      {[0, 1].map((i) => (
        <div className="skeleton-card skeleton-connector" data-shape="connector" key={i}>
          <div className="skeleton-connector-head">
            <Bone w={40} h={40} />
            <div className="skeleton-lines" style={{ flex: 1 }}><Bone w={i ? "26%" : "32%"} h={14} /><Bone w={i ? "58%" : "48%"} h={10} /></div>
            <Bone w={84} h={22} />
          </div>
          <Bone w="88%" h={10} />
          <Bone w="70%" h={10} />
          <div className="skeleton-actions"><Bone w={132} h={36} /><Bone w={110} h={36} /></div>
        </div>
      ))}
    </Status>
  );
}

function HeadSkeleton({ actions = 2 }: { actions?: number }) {
  return (
    <div className="page-head page-head-skeleton">
      <div className="skeleton-lines"><Bone w={190} h={26} /><Bone w={320} h={12} style={{ maxWidth: "70vw" }} /></div>
      <div className="skeleton-actions">{Array.from({ length: actions }, (_, i) => <Bone key={i} w={i ? 92 : 112} h={36} />)}</div>
    </div>
  );
}

const PAGE_LABEL = { dashboard: "Loading dashboard", data: "Loading emails", sales: "Loading sales", integrations: "Loading integrations" };

/** A whole page: header plus body, for route changes and first loads. */
export function PageSkeleton({ kind }: { kind: keyof typeof PAGE_LABEL }) {
  return (
    <div className={kind === "dashboard" || kind === "sales" ? "page page-wide" : "page"} role="status" aria-busy="true" aria-label={PAGE_LABEL[kind]}>
      <div aria-hidden="true" className="skeleton-inner">
        <HeadSkeleton actions={kind === "integrations" ? 0 : kind === "data" ? 1 : 2} />
        {kind === "dashboard" && <BoardSkeleton kind="dashboard" />}
        {kind === "sales" && <BoardSkeleton kind="sales" />}
        {kind === "integrations" && <IntegrationsSkeleton />}
        {kind === "data" && (
          <>
            <div className="skeleton-toolbar"><Bone w="46%" h={38} /><Bone w={200} h={34} /></div>
            <div className="skeleton-toolbar"><Bone w={110} h={32} /><Bone w={110} h={32} /><Bone w={110} h={32} /><Bone w={110} h={32} /></div>
            <div className="skeleton-card skeleton-table-card"><TableSkeleton rows={9} /></div>
          </>
        )}
      </div>
    </div>
  );
}
