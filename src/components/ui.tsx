import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useUi } from "../lib/store";

/** A section that the user can fold away. Open/closed state is remembered per panel. */
export function Panel({
  id,
  title,
  count,
  subtitle,
  aside,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const closed = useUi((s) => !!s.closedPanels[id]);
  const toggle = useUi((s) => s.togglePanel);
  const bodyId = `panel-${id}`;
  return (
    <section className="panel" data-open={!closed} id={`section-${id}`}>
      <button className="panel-head" aria-expanded={!closed} aria-controls={bodyId} onClick={() => toggle(id)}>
        <ChevronDown size={18} className="panel-chevron" aria-hidden />
        <div className="panel-titles">
          <h2 className="panel-title">
            {title}
            {count !== undefined && <span className="panel-count num">{count}</span>}
          </h2>
          {subtitle && <p className="panel-sub">{subtitle}</p>}
        </div>
        {aside}
      </button>
      <div className="panel-body-wrap" id={bodyId}>
        <div className="panel-body-inner">
          <div className="panel-body">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function Callout({
  tone,
  icon,
  title,
  text,
  action,
}: {
  tone?: "warn" | "danger" | "ok";
  icon: ReactNode;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="callout" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <div className="callout-icon">{icon}</div>
      <div className="callout-body">
        <p className="callout-title">{title}</p>
        {text && <p className="callout-text">{text}</p>}
      </div>
      {action}
    </div>
  );
}

export function GmailLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#4285F4" d="M6 40h7V22.6L4 16v21a3 3 0 0 0 2 3z" />
      <path fill="#34A853" d="M35 40h7a3 3 0 0 0 2-3V16l-9 6.6z" />
      <path fill="#FBBC04" d="M35 11v11.6L44 16v-3.6c0-3.3-3.8-5.2-6.4-3.2z" />
      <path fill="#EA4335" d="M13 22.6V11l11 8.2L35 11v11.6l-11 8.2z" />
      <path fill="#C5221F" d="M4 12.4V16l9 6.6V11l-2.6-1.8C7.8 7.2 4 9.1 4 12.4z" />
    </svg>
  );
}

export function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
