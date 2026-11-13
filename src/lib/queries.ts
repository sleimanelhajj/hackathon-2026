import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: api.status,
    // Poll while a sync is running so the UI reflects the real state, not a guess.
    refetchInterval: (q) => (q.state.data?.gmail?.status === "syncing" ? 2000 : 30000),
  });
}

export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
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
