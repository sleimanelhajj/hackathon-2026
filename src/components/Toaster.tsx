import { useEffect } from "react";
import { create } from "zustand";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; title: string; text?: string };

const LIFETIME_MS = 5000; // errors stay until dismissed: the user may need to read or act on them
let nextId = 1;
const useToasts = create<{ items: Toast[]; add: (t: Omit<Toast, "id">) => void; remove: (id: number) => void; clear: () => void }>((set) => ({
  items: [],
  add: (t) => set((s) => ({ items: [...s.items.slice(-3), { ...t, id: nextId++ }] })), // at most 4 on screen
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
  clear: () => set({ items: [] }),
}));

/** Short notes in the corner: what just happened, or what went wrong. */
export const toast = {
  success: (title: string, text?: string) => useToasts.getState().add({ tone: "success", title, text }),
  error: (title: string, text?: string) => useToasts.getState().add({ tone: "error", title, text }),
  info: (title: string, text?: string) => useToasts.getState().add({ tone: "info", title, text }),
  clear: () => useToasts.getState().clear(),
};

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info } as const;

function ToastItem({ item }: { item: Toast }) {
  const remove = useToasts((s) => s.remove);
  useEffect(() => {
    if (item.tone === "error") return;
    const timer = window.setTimeout(() => remove(item.id), LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [item.id, item.tone, remove]);
  const Icon = ICONS[item.tone];
  return (
    <li className="toast" data-tone={item.tone} role={item.tone === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden className="toast-icon" />
      <div className="toast-body">
        <p className="toast-title">{item.title}</p>
        {item.text ? <p className="toast-text">{item.text}</p> : null}
      </div>
      <button type="button" className="icon-btn icon-btn-sm" aria-label={`Dismiss: ${item.title}`} onClick={() => remove(item.id)}><X size={15} aria-hidden /></button>
    </li>
  );
}

/** Mounted once in the app shell. */
export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <ol className="toaster" aria-live="polite" aria-label="Notifications">
      {items.map((item) => <ToastItem key={item.id} item={item} />)}
    </ol>
  );
}
