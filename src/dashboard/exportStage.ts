import { growLayout, type Box } from "./exportLayout";

// The export draws a copy of the dashboard, never the dashboard you're looking at (decision #61). The copy sits off
// screen in .export-stage, where the glass is solid and nothing animates (the image renderer can't draw a backdrop
// blur), and every widget whose list scrolls on screen is grown to show all of it, pushing the widgets below it down.

const SCROLLABLE = /auto|scroll/;

/** Elements inside `root` whose content is taller than their box and that scroll to show it. */
function scrollers(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (el.scrollHeight > el.clientHeight + 1 && SCROLLABLE.test(getComputedStyle(el).overflowY)) out.push(el);
  }
  return out;
}

const force = (el: HTMLElement, styles: Record<string, string>) => {
  for (const [name, value] of Object.entries(styles)) el.style.setProperty(name, value, "important");
};
const items = (grid: Element) => [...grid.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains("grid-stack-item"));

/** Lays the copy's widgets out at their on-screen size plus the rows they hide, measured from the original. */
function growGrid(grid: HTMLElement, copyGrid: HTMLElement) {
  const origin = grid.getBoundingClientRect();
  const originals = items(grid), copies = items(copyGrid);
  const measured = originals.map((item) => {
    const r = item.getBoundingClientRect();
    const hidden = scrollers(item);
    const box: Box = {
      top: r.top - origin.top, bottom: r.bottom - origin.top, left: r.left - origin.left, right: r.right - origin.left,
      extra: hidden.reduce((most, el) => Math.max(most, el.scrollHeight - el.clientHeight), 0),
    };
    return { item, box, hidden };
  });
  const grown = growLayout(measured.map((m) => m.box));
  measured.forEach(({ item, box, hidden }, i) => {
    const copy = copies[i];
    if (!copy) return;
    force(copy, {
      position: "absolute", transform: "none", left: `${box.left}px`, width: `${box.right - box.left}px`,
      top: `${grown[i].top}px`, height: `${grown[i].bottom - grown[i].top}px`,
    });
    if (!hidden.length) return;
    // Same structure, so the n-th element of the original is the n-th of the copy.
    const all = [...item.querySelectorAll("*")], twins = copy.querySelectorAll<HTMLElement>("*");
    for (const el of hidden) {
      const twin = twins[all.indexOf(el)];
      if (twin) force(twin, { overflow: "visible", "max-height": "none", height: "auto", flex: "none" });
    }
  });
  const contentBottom = Math.max(0, ...measured.map((m) => m.box.bottom));
  const padding = Math.max(0, origin.height - contentBottom);
  const height = Math.max(0, ...grown.map((r) => r.bottom)) + padding;
  force(copyGrid, { height: `${height}px`, "min-height": `${height}px` });
}

/** Puts an off-screen copy of `node` on the page, ready to draw. Call `remove` when done. */
export function stageCopy(node: HTMLElement): { copy: HTMLElement; remove: () => void } {
  const host = document.createElement("div");
  host.className = "export-stage";
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  host.style.width = `${Math.ceil(node.getBoundingClientRect().width) || node.scrollWidth}px`;
  const copy = node.cloneNode(true) as HTMLElement;
  force(copy, { margin: "0", "max-width": "none", width: "100%", transform: "none", animation: "none" });
  host.append(copy);
  document.body.append(host);
  // The theme's variables, once on the copy's root (the image has no stylesheet): chart colours written as var(--…)
  // in SVG attributes resolve from here. The export copies only the properties in exportStyles.ts onto each element.
  const rootStyle = getComputedStyle(copy);
  for (const name of rootStyle) if (name.startsWith("--")) copy.style.setProperty(name, rootStyle.getPropertyValue(name));
  try {
    const grids = node.querySelectorAll<HTMLElement>(".grid-stack"), copyGrids = copy.querySelectorAll<HTMLElement>(".grid-stack");
    grids.forEach((grid, i) => { if (copyGrids[i]) growGrid(grid, copyGrids[i]); });
  } catch (err) {
    host.remove();
    throw err;
  }
  return { copy, remove: () => host.remove() };
}
