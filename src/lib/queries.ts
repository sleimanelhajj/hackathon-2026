import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type SavedDashboard } from "./api";

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: api.status,
    // Poll while a sync is running so the UI reflects the real state, not a guess.
    refetchInterval: (q) => (q.state.data?.gmail?.status === "syncing" ? 2000 : 30000),
  });
}

/** Widget data: every number the dashboard can show, computed on the server. */
export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
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
