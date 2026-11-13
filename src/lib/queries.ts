import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type SavedDashboard } from "./api";

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: api.status,
    // Poll while a sync or AI analysis is running so the UI reflects the real state, not a guess.
    refetchInterval: (q) => {
      const g = q.state.data?.gmail;
      return g?.status === "syncing" || g?.analysis?.status === "running" ? 2000 : 30000;
    },
  });
}

/** Widget data: every number the dashboard can show, computed on the server. */
export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    // AI analysis runs in the background after a sync; refresh until it finishes so new labels appear.
    refetchInterval: (q) => {
      const d = q.state.data;
      return d?.connected && (d.status === "syncing" || d.insights.status === "running") ? 3000 : false;
    },
  });
}

/** The dashboard layout: which widgets, where. */
export function useDashboardSpec() {
  return useQuery({ queryKey: ["dashboard-spec"], queryFn: api.spec, staleTime: 60_000 });
}

function useInvalidating<T>(fn: () => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["status"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export const useSync = () => useInvalidating(api.sync);
export const useLoadSample = () => useInvalidating(api.loadSample);
export const useDisconnect = () => useInvalidating(api.disconnect);
export function useRunAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean | void) => api.runAnalysis(force === true),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["status"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

function useSpecMutation<V>(fn: (v: V) => Promise<SavedDashboard>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (saved) => qc.setQueryData(["dashboard-spec"], saved),
  });
}

export const useSaveSpec = () => useSpecMutation(api.saveSpec);
export const useUndoSpec = () => useSpecMutation(() => api.undoSpec());
export const useResetSpec = () => useSpecMutation(() => api.resetSpec());
