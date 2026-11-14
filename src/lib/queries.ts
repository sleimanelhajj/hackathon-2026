import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Board, type SavedDashboard } from "./api";

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
      return d?.connected && (d.status === "syncing" || d.insights?.status === "running") ? 3000 : false;
    },
  });
}

/** The dashboard layout: which widgets, where. */
export function useDashboardSpec(board: Board = "default") {
  return useQuery({ queryKey: ["dashboard-spec", board], queryFn: () => api.spec(board), staleTime: 60_000 });
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

/** Sends an approved reply, then refreshes the dashboard (the server re-syncs in the background). */
export function useSendReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.sendReply,
    onSuccess: () => {
      // The sync that picks up the sent message takes a few seconds.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["status"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        qc.invalidateQueries({ queryKey: ["messages"] });
      }, 4000);
    },
  });
}

/** Everyone in the stored email, for the Email data page's person filter. */
export function usePeople() {
  return useQuery({ queryKey: ["people"], queryFn: api.people, staleTime: 60_000 });
}

function useSpecMutation<V>(board: Board, fn: (v: V) => Promise<SavedDashboard>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (saved) => qc.setQueryData(["dashboard-spec", board], saved),
  });
}

export const useSaveSpec = (board: Board = "default") =>
  useSpecMutation(board, (spec: Parameters<typeof api.saveSpec>[0]) => api.saveSpec(spec, board));
export const useUndoSpec = (board: Board = "default") => useSpecMutation(board, () => api.undoSpec(board));
export const useResetSpec = (board: Board = "default") => useSpecMutation(board, () => api.resetSpec(board));

/** Stored emails, exactly as fetched from Gmail. Keeps the previous page on screen while the next loads. */
export function useMessages(params: Parameters<typeof api.messages>[0]) {
  return useQuery({ queryKey: ["messages", params], queryFn: () => api.messages(params), placeholderData: keepPreviousData });
}

export function useMessage(id: string | null) {
  return useQuery({ queryKey: ["message", id], queryFn: () => api.message(id!), enabled: !!id });
}

/** Removes one widget from a saved board (the widget's Remove button); the server closes the gap. */
export const useRemoveWidget = (board: Board = "default") => useSpecMutation(board, (id: string) => api.removeWidget(board, id));
