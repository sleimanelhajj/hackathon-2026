// Automatic Gmail sync in the app: a switch on the Integrations page, honest "last checked" wording, and pages that
// refresh by themselves when a sync brings in new mail (decision #52).
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, type Status } from "../src/lib/api";
import { IntegrationsPage } from "../src/pages/IntegrationsPage";
import { useRefreshOnNewMail } from "../src/lib/queries";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const status = (gmail: Partial<NonNullable<Status["gmail"]>> = {}): Status => ({
  database: true, googleConfigured: true, gemini: { configured: true, model: "m" }, companyData: { configured: false, name: "Company database" },
  gmail: {
    mode: "live", email: "me@shop.example", status: "connected", scopes: [], canSend: true, lastSyncAt: new Date(Date.now() - 120_000).toISOString(),
    lastSyncCount: 3, error: null, connectedAt: null, syncProgress: null, mailbox: null, analysis: null,
    autoSync: true, autoSyncCheckedAt: new Date(Date.now() - 20_000).toISOString(), autoSyncEverySeconds: 60, ...gmail,
  },
});

function showIntegrations(s: Status) {
  vi.spyOn(api, "status").mockResolvedValue(s);
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IntegrationsPage /></QueryClientProvider>);
}

test("a switch shows auto-sync is on, with honest wording about how often it checks", async () => {
  showIntegrations(status());
  const toggle = await screen.findByRole("switch", { name: /Check for new email automatically/ });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText(/Checks Gmail every minute/)).toBeTruthy();
  expect(screen.getByText(/Last checked/)).toBeTruthy();
});

test("turning it off asks the server, and the switch follows", async () => {
  const set = vi.spyOn(api, "setAutoSync").mockResolvedValue({ autoSync: false });
  showIntegrations(status());
  fireEvent.click(await screen.findByRole("switch", { name: /Check for new email automatically/ }));
  await waitFor(() => expect(set).toHaveBeenCalledWith(false));
});

test("sample data has no switch: there's no mailbox to watch", async () => {
  showIntegrations(status({ mode: "sample", autoSync: false }));
  await screen.findByRole("heading", { name: /^Gmail/ });
  expect(screen.queryByRole("switch")).toBeNull();
});

test("when a sync brings in mail, the dashboard, schedule and email list refresh by themselves", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { rerender } = renderHook(({ s }) => useRefreshOnNewMail(s), { wrapper, initialProps: { s: status() } });
  expect(spy).not.toHaveBeenCalled(); // the first status is just the starting point
  act(() => rerender({ s: status({ lastSyncAt: new Date().toISOString() }) }));
  const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
  for (const key of ['["dashboard"]', '["schedule"]', '["messages"]']) expect(keys).toContain(key);
});
