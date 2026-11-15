import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** A small icon tile next to the title. */
  icon?: ReactNode;
  tone?: "default" | "danger";
  size?: "sm" | "md" | "lg";
  /** "alertdialog" for confirmations that interrupt the user. */
  role?: "dialog" | "alertdialog";
  /** False while something must finish (or the choice must be made): no Escape, no close button, no backdrop click. */
  dismissible?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * The one dialog of the app: native <dialog> in the top layer (keyboard focus stays inside, Escape closes), frosted
 * glass, a fixed header and footer with only the body scrolling, the page behind locked, and focus returned to
 * whatever opened it. Content is only rendered while open.
 */
export function Modal({ open, onClose, title, description, icon, tone = "default", size = "md", role = "dialog", dismissible = true, footer, children, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement as HTMLElement | null;
      dialog.showModal?.();
      document.documentElement.classList.add("modal-open");
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Leaving the page or unmounting while open: release the scroll lock and the focus.
  useEffect(() => () => {
    if (ref.current?.open) document.documentElement.classList.remove("modal-open");
  }, []);

  const handleClosed = () => {
    if (!document.querySelector("dialog[open]")) document.documentElement.classList.remove("modal-open");
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  };

  return (
    <dialog
      ref={ref}
      className={`ui-modal${className ? ` ${className}` : ""}`}
      data-size={size}
      data-tone={tone}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(event) => {
        event.preventDefault(); // we decide: Escape closes only when dismissible
        if (dismissible) onCloseRef.current();
      }}
      onClose={handleClosed}
      onMouseDown={(event) => {
        // A click on the backdrop (the dialog element itself, outside its panel) closes a dismissible dialog.
        if (dismissible && event.target === ref.current) onCloseRef.current();
      }}
    >
      {open ? (
        <div className="ui-modal-panel">
          <header className="ui-modal-head">
            {icon ? <span className="ui-modal-icon" aria-hidden>{icon}</span> : null}
            <div className="ui-modal-titles">
              <h2 id={titleId} className="ui-modal-title">{title}</h2>
              {description ? <p id={descId} className="ui-modal-desc">{description}</p> : null}
            </div>
            {dismissible ? (
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => onCloseRef.current()}><X size={18} aria-hidden /></button>
            ) : null}
          </header>
          {children ? <div className="ui-modal-body">{children}</div> : null}
          {footer ? <footer className="ui-modal-foot">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
