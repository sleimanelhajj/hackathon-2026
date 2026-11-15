import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileImage, FileText, Loader2 } from "lucide-react";
import { exportScale, pageSlices, widgetRanges, type Range } from "./exportLayout";
import { stageCopy } from "./exportStage";
import { EXPORT_STYLE_PROPERTIES } from "./exportStyles";
import { toast } from "../components/Toaster";

// Export a dashboard as a report (decision #61): an image (PNG) or a PDF. html-to-image draws an off-screen copy of
// the board (exportStage.ts), so the dashboard on screen never changes while it works, and lists that scroll on
// screen come out in full. Everything happens in the browser; nothing is sent anywhere. pdf-lib (already used for
// invoices) wraps the image in a titled, dated A4 report, with page breaks between widgets, never through one. The
// export button, edit controls and resize handles are left out of the picture.

const stamp = () => new Date().toISOString().slice(0, 10);
const fileBase = (title: string) => `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "Dashboard"}-${stamp()}`;

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

/** A capture waits for the browser to paint; a window in the background never does, so give up after this long. */
export const EXPORT_TIMEOUT_MS = 45_000;
const withinTime = <T,>(p: Promise<T>) => Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("it took too long. Keep this window in front while it exports, and try again.")), EXPORT_TIMEOUT_MS))]);

/** Controls that only make sense on screen. */
const SCREEN_ONLY = ["ui-resizable-handle", "widget-config", "widget-remove-btn", "export-menu", "skip-link"];
const keep = (n: Node) => !(n instanceof HTMLElement && (n.hasAttribute("data-export-hide") || SCREEN_ONLY.some((c) => n.classList.contains(c))));
/** The next painted frame, or 50 ms if the tab is in the background (it doesn't paint there, so don't wait on it). */
const nextFrame = () => new Promise<void>((done) => { requestAnimationFrame(() => done()); setTimeout(done, 50); });

/** The page's web fonts as embeddable CSS. Fetching and inlining them is the slowest part of a capture: do it once. */
let fontCss: Promise<string> | null = null;
function fontsFor(node: HTMLElement, getFontEmbedCSS: (n: HTMLElement) => Promise<string>) {
  fontCss ??= getFontEmbedCSS(node).catch(() => { fontCss = null; return ""; });
  return fontCss;
}

type Shot = { image: Blob; widgets: Range[]; height: number };
type Format = "image/png" | "image/jpeg";

/**
 * The dashboard as an image plus where each widget sits (for page breaks), drawn from an off-screen copy. The image
 * download is a PNG; the PDF gets a JPEG, which pdf-lib embeds as it is instead of decoding every pixel (a long freeze
 * on a tall board) and which keeps the report small.
 */
async function capture(node: HTMLElement, format: Format): Promise<Shot> {
  const { toCanvas, getFontEmbedCSS } = await import("html-to-image");
  await document.fonts?.ready;
  await nextFrame(); // let the button's spinner paint before the heavy work starts
  const { copy, remove } = stageCopy(node);
  try {
    const width = Math.ceil(copy.scrollWidth), height = Math.ceil(copy.scrollHeight);
    const widgets = widgetRanges(copy);
    const background = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "white";
    const canvas = await toCanvas(copy, {
      pixelRatio: exportScale(width, height),
      backgroundColor: background,
      width: width || undefined,
      height: height || undefined,
      style: { transform: "none", margin: "0", animation: "none" },
      filter: keep,
      // Only the properties that change how things look: a third of the image to draw, so a much shorter freeze.
      includeStyleProperties: EXPORT_STYLE_PROPERTIES,
      fontEmbedCSS: await fontsFor(copy, getFontEmbedCSS),
    });
    // toBlob encodes off the main thread, unlike a data URL.
    const image = await new Promise<Blob>((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error("the image couldn't be made. Try again."))), format, 0.92));
    return { image, widgets, height };
  } finally {
    remove();
  }
}

/** A titled, dated A4 landscape PDF with the image, sliced over as many pages as it needs, breaking between widgets. */
async function reportPdf({ image, widgets, height }: Shot, title: string) {
  // pdf-lib colours (0–1 per channel) for the report text and bands; not CSS, so no theme token applies.
  const { PDFDocument, StandardFonts, rgb: pdfColor } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("AI Workspace OS");
  doc.setCreationDate(new Date());
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const img = await doc.embedJpg(new Uint8Array(await image.arrayBuffer()));
  const [W, H, margin, header, footer] = [842, 595, 28, 46, 22];
  const width = W - margin * 2;
  const scale = width / img.width;
  const fullHeight = img.height * scale;
  const area = H - margin * 2 - header - footer;
  // CSS pixels → PDF points.
  const k = height > 0 ? fullHeight / height : scale;
  const slices = pageSlices(widgets, height > 0 ? height : img.height, area / k);
  const pages = slices.length;
  const when = new Date().toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
  slices.forEach(({ start, end }, i) => {
    const page = doc.addPage([W, H]);
    // The whole image is drawn shifted so this slice starts under the header; white bands cover what's outside it.
    const top = H - margin - header;
    const sliceBottom = top - (end - start) * k;
    page.drawImage(img, { x: margin, y: top - fullHeight + start * k, width, height: fullHeight });
    page.drawRectangle({ x: 0, y: top, width: W, height: H - top, color: pdfColor(1, 1, 1) });
    page.drawRectangle({ x: 0, y: 0, width: W, height: Math.max(margin + footer, sliceBottom), color: pdfColor(1, 1, 1) });
    page.drawText(title, { x: margin, y: H - margin - 18, size: 16, font: bold, color: pdfColor(0.06, 0.11, 0.18) });
    page.drawText(`Exported ${when}`, { x: margin, y: H - margin - 34, size: 9, font, color: pdfColor(0.4, 0.45, 0.52) });
    page.drawText(`AI Workspace OS · page ${i + 1} of ${pages}`, { x: margin, y: margin, size: 8, font, color: pdfColor(0.4, 0.45, 0.52) });
  });
  const bytes = await doc.save();
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
}

/** "Export" with two choices; it captures the nearest dashboard (.board) around it. */
export function ExportButton({ title }: { title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "png" | "pdf">(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const run = async (kind: "png" | "pdf") => {
    setOpen(false);
    setError(null);
    // The page around the board: .board itself is display: contents (no box of its own), so it would draw as 0×0.
    const node = (ref.current?.closest(".page") ?? ref.current?.closest(".board") ?? document.querySelector(".page")) as HTMLElement | null;
    if (!node) { setError("Couldn't export: there's no dashboard on this page."); return; }
    setBusy(kind);
    try {
      const shot = await withinTime(capture(node, kind === "png" ? "image/png" : "image/jpeg"));
      if (shot.image.size === 0) throw new Error("the dashboard came out empty. Scroll it into view and try again.");
      const file = kind === "png" ? shot.image : await reportPdf(shot, title);
      const url = URL.createObjectURL(file);
      download(url, `${fileBase(title)}.${kind}`);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(kind === "png" ? "Image downloaded" : "PDF report downloaded", `${fileBase(title)}.${kind} is in your downloads.`);
    } catch (err) {
      // Image loading fails with an Event, not an Error: say something useful either way.
      const why = err instanceof Error ? err.message : "part of the page couldn't be drawn (an image or font didn't load)";
      setError(`Couldn't export the dashboard: ${why}`);
    } finally {
      // A capture that timed out never reaches its own clean-up: remove its off-screen copy here.
      for (const stage of document.querySelectorAll(".export-stage")) stage.remove();
      setBusy(null);
    }
  };

  return (
    <div className="export-menu" ref={ref} data-export-hide="">
      <button type="button" className="btn btn-ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={busy !== null}>
        {busy ? <Loader2 size={15} className="spin" aria-hidden /> : <Download size={15} aria-hidden />} Export
      </button>
      {open && (
        <div className="export-list surface" role="menu" aria-label="Export the dashboard">
          <button type="button" role="menuitem" onClick={() => run("png")}><FileImage size={15} aria-hidden /> Image (PNG)</button>
          <button type="button" role="menuitem" onClick={() => run("pdf")}><FileText size={15} aria-hidden /> PDF report</button>
        </div>
      )}
      {error && <span className="agent-error export-error" role="alert"><AlertTriangle size={13} aria-hidden /> {error}</span>}
    </div>
  );
}
