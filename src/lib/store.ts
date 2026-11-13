import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type UiState = {
  sidebarCollapsed: boolean;
  closedPanels: Record<string, boolean>;
  toggleSidebar: () => void;
  togglePanel: (id: string) => void;
  openPanel: (id: string) => void;
};

// localStorage can be unavailable (private mode, blocked storage); fall back to memory.
const safeStorage = createJSONStorage(() => {
  try {
    const k = "__probe";
    localStorage.setItem(k, k);
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (n: string) => mem.get(n) ?? null,
      setItem: (n: string, v: string) => void mem.set(n, v),
      removeItem: (n: string) => void mem.delete(n),
    };
  }
});

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      closedPanels: {},
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      togglePanel: (id) => set((s) => ({ closedPanels: { ...s.closedPanels, [id]: !s.closedPanels[id] } })),
      openPanel: (id) => set((s) => ({ closedPanels: { ...s.closedPanels, [id]: false } })),
    }),
    { name: "aiwos-ui", storage: safeStorage }
  )
);

export type Route = "dashboard" | "integrations";

function readRoute(): Route {
  return window.location.hash.startsWith("#/integrations") ? "integrations" : "dashboard";
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    readRoute
  );
}

/** Keyboard shortcut: "[" toggles the sidebar (ignored while typing). */
export function useSidebarShortcut() {
  const toggle = useUi((s) => s.toggleSidebar);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "[" && !e.metaKey && !e.ctrlKey && !e.altKey) toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}
