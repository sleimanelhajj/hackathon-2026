import { lazy, Suspense, useEffect } from "react";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import { ReplyModal } from "./components/ReplyModal";
import { Sidebar } from "./components/Sidebar";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { useRoute, useSidebarShortcut } from "./lib/store";
import { useStatus } from "./lib/queries";

// The dashboard pulls in the grid and chart libraries; load it only when it's opened.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const DataPage = lazy(() => import("./pages/DataPage"));

export default function App() {
  const route = useRoute();
  const { data: status } = useStatus();
  useSidebarShortcut();

  // First visit with nothing connected: start on Integrations.
  useEffect(() => {
    if (!window.location.hash && status && !status.gmail) window.location.hash = "#/integrations";
  }, [status]);

  // The sky's clouds drift only while something is really working (a Gmail sync or an AI run).
  const busy = status?.gmail?.status === "syncing" || status?.gmail?.analysis?.status === "running";
  useEffect(() => {
    document.documentElement.dataset.sky = busy ? "busy" : "still";
  }, [busy]);

  useEffect(() => {
    document.title = `${route === "integrations" ? "Integrations" : route === "data" ? "Email data" : "Dashboard"} · AI Workspace OS`;
  }, [route]);

  return (
    <div className="shell">
      <Sidebar route={route} />
      <main className="main">
        <PageErrorBoundary key={route}>
        {route === "integrations" ? (
          <IntegrationsPage />
        ) : (
          <Suspense fallback={<div className="page"><div className="skeleton" style={{ height: 420 }} /></div>}>
            {route === "data" ? <DataPage /> : <DashboardPage />}
          </Suspense>
        )}
        </PageErrorBoundary>
      </main>
      {/* Right-hand panel slot: pages portal into it (e.g. the widget library while editing). Hidden when empty. */}
      <aside id="side-panel" className="side-panel-slot" />
      <ReplyModal />
    </div>
  );
}
