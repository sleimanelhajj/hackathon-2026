// Exporting a dashboard as a report (src/dashboard/ExportButton.tsx, decision #61): a PNG image, or a PDF with a title,
// the date and the dashboard (split over pages when it's tall). The capture itself is html-to-image (mocked here:
// jsdom can't draw); the PDF is built for real with pdf-lib.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";

// A real 2×2 PNG, so pdf-lib can embed it.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDGgAQYGBgB8aQH/2T0ILAAAAABJRU5ErkJggg==";
const toPng = vi.fn(async () => PNG);
vi.mock("html-to-image", () => ({ toPng: (...args: unknown[]) => toPng(...(args as [])) }));
const { ExportButton } = await import("../src/dashboard/ExportButton");

let downloads: { name: string; href: string }[] = [];
let blobs: Blob[] = [];
beforeEach(() => {
  downloads = []; blobs = []; toPng.mockClear();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ name: this.download, href: this.href }); });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => { blobs.push(b); return "blob:report"; }, revokeObjectURL: () => {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function board() {
  return render(<div className="board"><h1>Money</h1><div className="board-grid">widgets</div><ExportButton title="Money" /></div>);
}

test("export as image: captures the dashboard (not the export button) and downloads a dated PNG", async () => {
  board();
  fireEvent.click(screen.getByRole("button", { name: /Export/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Image \(PNG\)/ }));
  await waitFor(() => expect(downloads).toHaveLength(1));
  expect(downloads[0].name).toMatch(/^Money-\d{4}-\d{2}-\d{2}\.png$/);
  expect(downloads[0].href).toBe(PNG);
  const [node, options] = toPng.mock.calls[0] as unknown as [HTMLElement, { filter: (n: Node) => boolean; pixelRatio: number }];
  expect(node.classList.contains("board")).toBe(true);
  expect(options.pixelRatio).toBe(2);
  expect(options.filter(screen.getByRole("button", { name: /Export/ }).closest("[data-export-hide]")!)).toBe(false);
});

test("export as PDF: a real PDF report with the dashboard's name", async () => {
  board();
  fireEvent.click(screen.getByRole("button", { name: /Export/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: /PDF report/ }));
  await waitFor(() => expect(downloads).toHaveLength(1));
  expect(downloads[0].name).toMatch(/^Money-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(blobs[0].type).toBe("application/pdf");
  const pdf = await PDFDocument.load(await blobs[0].arrayBuffer());
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  expect(pdf.getTitle()).toBe("Money");
});

test("a failed capture says so instead of failing silently", async () => {
  toPng.mockRejectedValueOnce(new Error("canvas is tainted"));
  board();
  fireEvent.click(screen.getByRole("button", { name: /Export/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Image \(PNG\)/ }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't export/);
});

test("a capture that never finishes (a window in the background doesn't paint) ends with a clear message", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    toPng.mockImplementationOnce(() => new Promise(() => {}));
    board();
    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Image \(PNG\)/ }));
    await vi.advanceTimersByTimeAsync(46_000);
    expect((await screen.findByRole("alert")).textContent).toMatch(/took too long.*in front/);
  } finally {
    vi.useRealTimers();
  }
});
