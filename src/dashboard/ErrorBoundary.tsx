import { Component, type ReactNode } from "react";
import { MissingDataError } from "../widgets/SalesWidgets";

/** Keeps one broken widget from taking down the whole dashboard. */
export class WidgetErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; missing: string | null }> {
  state = { failed: false, missing: null as string | null };

  static getDerivedStateFromError(err: unknown) {
    // A widget whose data isn't there yet (decision #60: email and sales widgets share the main board) says what to do.
    return { failed: true, missing: err instanceof MissingDataError ? err.message : null };
  }

  render() {
    if (this.state.missing) return <div className="widget-empty"><p>{this.state.missing}</p></div>;
    if (this.state.failed)
      return (
        <div className="widget-empty">
          <p>This widget couldn't load.</p>
          <button className="btn btn-ghost btn-sm" onClick={() => this.setState({ failed: false })}>
            Try again
          </button>
        </div>
      );
    return this.props.children;
  }
}
