import { createContext, useContext } from "react";
import type { Dashboard } from "../lib/api";
import { MissingDataError } from "../widgets/SalesWidgets";

export type DashboardData = Extract<Dashboard, { connected: true }>;

const Ctx = createContext<DashboardData | null>(null);

export const DashboardDataProvider = Ctx.Provider;

/** Widgets read the shared, server-computed numbers from here instead of fetching individually. */
export function useDashboardData(): DashboardData {
  const data = useContext(Ctx);
  if (!data) throw new MissingDataError("No email data yet. Connect Gmail on the Integrations page.");
  return data;
}
