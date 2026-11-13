import { Component, type ReactNode } from "react";

/** Keeps one broken widget from taking down the whole dashboard. */
export class WidgetErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
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
