import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Callout } from "./ui";

/** A failed page must leave navigation available and provide a way to recover. */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="page"><Callout tone="danger" icon={<AlertTriangle size={18} />}
      title="This page couldn't load" text="Try loading it again. You can still open other pages from the sidebar."
      action={<button className="btn btn-secondary" onClick={() => window.location.reload()}>Reload page</button>} /></div>;
    return this.props.children;
  }
}
