import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { DashboardPage } from "./pages/DashboardPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { useRoute, useSidebarShortcut } from "./lib/store";
import { useStatus } from "./lib/queries";

export default function App() {
  const route = useRoute();
  const { data: status } = useStatus();
  useSidebarShortcut();

  // First visit with nothing connected: start on Integrations.
  useEffect(() => {
    if (!window.location.hash && status && !status.gmail) window.location.hash = "#/integrations";
  }, [status]);

  useEffect(() => {
    document.title = `${route === "integrations" ? "Integrations" : "Dashboard"} · AI Workspace OS`;
  }, [route]);

  return (
    <div className="shell">
      <Sidebar route={route} />
      <main className="main">{route === "integrations" ? <IntegrationsPage /> : <DashboardPage />}</main>
    </div>
  );
}
