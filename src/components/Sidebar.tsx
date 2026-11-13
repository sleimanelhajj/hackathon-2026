import { LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plug, Sparkles } from "lucide-react";
import { useUi, type Route } from "../lib/store";
import { useStatus } from "../lib/queries";
import { timeAgo } from "../lib/api";

const NAV: { route: Route; label: string; icon: typeof Plug }[] = [
  { route: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { route: "integrations", label: "Integrations", icon: Plug },
];

export function Sidebar({ route }: { route: Route }) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const { data } = useStatus();
  const gmail = data?.gmail;

  const tone = !gmail ? undefined : gmail.status === "syncing" ? "busy" : gmail.status === "error" ? "error" : "ok";
  const connSub = !gmail
    ? "Not connected"
    : gmail.status === "syncing"
      ? "Syncing…"
      : gmail.status === "error"
        ? "Needs attention"
        : gmail.mode === "sample"
          ? "Sample data"
          : `Synced ${timeAgo(gmail.lastSyncAt)}`;

  return (
    <aside className="sidebar" data-collapsed={collapsed} aria-label="Main navigation">
      <div className="sidebar-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Sparkles size={16} />
          </span>
          <span className="brand-name">AI Workspace OS</span>
        </div>
        <button
          className="icon-btn"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar  [" : "Collapse sidebar  ["}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <p className="sidebar-section">Workspace</p>
      <nav className="nav">
        {NAV.map(({ route: r, label, icon: Icon }) => (
          <a
            key={r}
            href={`#/${r}`}
            className="nav-item"
            aria-current={route === r ? "page" : undefined}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} aria-hidden />
            <span className="nav-label">{label}</span>
            {r === "integrations" && !gmail && <span className="nav-meta">Start here</span>}
          </a>
        ))}
      </nav>

      <div className="sidebar-foot">
        <a className="conn" href="#/integrations" title={collapsed ? `Gmail: ${connSub}` : undefined}>
          <span className="dot" data-tone={tone} aria-hidden />
          <span className="conn-text">
            <span className="conn-title">Gmail</span>
            <span className="conn-sub">{connSub}</span>
          </span>
        </a>
      </div>
    </aside>
  );
}
