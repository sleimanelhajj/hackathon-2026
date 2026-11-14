import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useUi } from "./store";

/** Must match the sidebar's width transition in index.css (.sidebar { transition: width 260ms var(--ease) }). */
export const SIDEBAR_MS = 260;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)"; // --ease

const contentLeft = (el: HTMLElement) => ((el.firstElementChild as HTMLElement | null) ?? el).getBoundingClientRect().left;

/**
 * Slides the page along with the sidebar when it opens or closes (FLIP: First, Last, Invert, Play).
 * The page's layout changes once, instantly; a compositor-only transform then carries it from where it was to where it
 * now is over the sidebar's duration. Nothing is laid out again during the slide, so it stays smooth on a full board.
 */
export function useSlideWithSidebar(ref: RefObject<HTMLElement | null>) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const before = useRef<number | null>(null);

  // First: zustand notifies synchronously when the state changes, before React re-renders, so this is the old position
  // (including any slide still in progress, so a quick double toggle continues from where the page visibly is).
  useEffect(() => useUi.subscribe((state, prev) => {
    if (state.sidebarCollapsed !== prev.sidebarCollapsed && ref.current) before.current = contentLeft(ref.current);
  }), [ref]);

  // Last, Invert, Play: after the new layout is committed, before the browser paints it.
  useLayoutEffect(() => {
    const el = ref.current;
    const from = before.current;
    before.current = null;
    if (!el || from === null) return;
    el.getAnimations?.().forEach((a) => a.cancel());
    const dx = Math.round(from - contentLeft(el));
    if (Math.abs(dx) < 1 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate?.([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0px)" }], { duration: SIDEBAR_MS, easing: EASE });
  }, [collapsed, ref]);
}
