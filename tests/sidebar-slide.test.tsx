// The page slides with the sidebar (src/lib/useSlideWithSidebar.ts): the layout changes once, then a GPU transform
// carries the page from where it was to where it now is, in step with the sidebar's own 260 ms animation.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useUi } from "../src/lib/store";
import { SIDEBAR_MS, useSlideWithSidebar } from "../src/lib/useSlideWithSidebar";

let left = 264; // where the page's content starts, as the browser would measure it
const animate = vi.fn(() => ({ cancel: vi.fn() }));

function Page() {
  const ref = useRef<HTMLElement>(null);
  useSlideWithSidebar(ref);
  return <main ref={ref}><div className="page">content</div></main>;
}

beforeEach(() => {
  left = 264;
  animate.mockClear();
  act(() => useUi.getState().setSidebarCollapsed(false));
  Element.prototype.getBoundingClientRect = function () { return { left, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: left, y: 0, toJSON() {} } as DOMRect; };
  (Element.prototype as unknown as { animate: typeof animate }).animate = animate;
  (Element.prototype as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [];
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

test("closing the sidebar slides the page left from where it was, over the sidebar's duration", () => {
  render(<Page />);
  act(() => { useUi.getState().setSidebarCollapsed(true); left = 88; });
  // The store change is measured before React re-renders (old position), the new position after.
  expect(animate).toHaveBeenCalledTimes(1);
  const [frames, options] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
  expect(frames[0].transform).toBe("translateX(176px)");
  expect(frames[1].transform).toBe("translateX(0px)");
  expect(options.duration).toBe(SIDEBAR_MS);
});

test("opening slides it right", () => {
  act(() => useUi.getState().setSidebarCollapsed(true));
  left = 88;
  render(<Page />);
  act(() => { useUi.getState().setSidebarCollapsed(false); left = 264; });
  const [frames] = animate.mock.calls[0] as unknown as [Keyframe[]];
  expect(frames[0].transform).toBe("translateX(-176px)");
});

test("nothing animates when the page didn't move (phones, where the sidebar slides over the page)", () => {
  render(<Page />);
  act(() => useUi.getState().setSidebarCollapsed(true));
  expect(animate).not.toHaveBeenCalled();
});

test("people who reduce motion get no slide", () => {
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  render(<Page />);
  act(() => { useUi.getState().setSidebarCollapsed(true); left = 88; });
  expect(animate).not.toHaveBeenCalled();
});
