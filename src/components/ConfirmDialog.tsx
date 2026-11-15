import { useState, type ReactNode } from "react";
import { create } from "zustand";
import { AlertTriangle, CircleHelp, Loader2, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { errorMessage } from "../lib/errors";

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  /** Extra detail under the message (e.g. what exactly will be sent). */
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for deleting or undoing; "primary" for sending or creating. */
  tone?: "danger" | "primary";
  icon?: ReactNode;
  /**
   * Optional: the work to do. The dialog shows progress while it runs, stays open with the error if it fails (so the
   * user can retry or cancel), and closes when it succeeds.
   */
  action?: () => Promise<unknown>;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
const useConfirmStore = create<{ pending: Pending | null; set: (p: Pending | null) => void }>((set) => ({ pending: null, set: (pending) => set({ pending }) }));

/** Ask before doing something. Resolves true once confirmed (and the action, if any, succeeded), false if cancelled. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  const previous = useConfirmStore.getState().pending;
  previous?.resolve(false); // one question at a time
  return new Promise((resolve) => useConfirmStore.getState().set({ ...options, resolve }));
}

/** Closes any open confirmation as cancelled (e.g. when the page changes, and between tests). */
export function dismissConfirm() {
  const pending = useConfirmStore.getState().pending;
  pending?.resolve(false);
  useConfirmStore.getState().set(null);
}

/** Renders the open confirmation, if any. Mounted once in the app shell. */
export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  const clear = useConfirmStore((s) => s.set);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    clear(null);
    setBusy(false);
    setError(null);
  };
  const onConfirm = async () => {
    if (!pending || busy) return;
    if (!pending.action) return finish(true);
    setBusy(true);
    setError(null);
    try {
      await pending.action();
      finish(true);
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
    }
  };

  const danger = pending?.tone === "danger";
  return (
    <Modal
      open={Boolean(pending)}
      onClose={() => finish(false)}
      role="alertdialog"
      size="sm"
      tone={danger ? "danger" : "default"}
      dismissible={!busy}
      title={pending?.title ?? ""}
      description={pending?.message}
      icon={pending?.icon ?? (danger ? <Trash2 size={18} /> : <CircleHelp size={18} />)}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => finish(false)} disabled={busy}>{pending?.cancelLabel ?? "Cancel"}</button>
          <button type="button" className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`} onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? <Loader2 size={15} className="spin" aria-hidden /> : null}
            {pending?.confirmLabel ?? "Confirm"}
          </button>
        </>
      }
    >
      {pending?.details || error ? (
        <>
          {pending?.details}
          {error ? <p className="ui-modal-error" role="alert"><AlertTriangle size={15} aria-hidden /><span>{error}</span></p> : null}
        </>
      ) : null}
    </Modal>
  );
}
