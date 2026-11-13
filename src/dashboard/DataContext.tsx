import { createContext, useContext } from "react";
import type { Dashboard } from "../lib/api";

export type DashboardData = Extract<Dashboard, { connected: true }>;

const Ctx = createContext<DashboardData | null>(null);

export const DashboardDataProvider = Ctx.Provider;

/** Widgets read the shared, server-computed numbers from here instead of fetching individually. */
export function useDashboardData(): DashboardData {
  const data = useContext(Ctx);
  if (!data) throw new Error("useDashboardData must be used inside DashboardDataProvider");
  return data;
}
