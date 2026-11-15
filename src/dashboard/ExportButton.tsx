import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileImage, FileText, Loader2 } from "lucide-react";

// Export a dashboard as a report (decision #61): an image (PNG) or a PDF. html-to-image draws the board as it is on
// screen (in the browser, nothing is sent anywhere); pdf-lib (already used for invoices) wraps it in a titled, dated
// A4 report, split over pages when the board is tall. The export button itself is left out of the picture.

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

/** The dashboard as a PNG data URL: twice the screen resolution, on the page background, without [data-export-hide]. */
async function capture(node: HTMLElement) {
  const { toPng } = await import("html-to-image");
  const background = getComputedStyle(document.body).getPropertyValue("--bg").trim() || "white";
  return toPng(node, {
    pixelRatio: 2,
    backgroundColor: background,
    filter: (n: Node) => !(n instanceof HTMLElement && n.hasAttribute("data-export-hide")),
  });
}

/** A titled, dated A4 landscape PDF with the image, sliced over as many pages as it needs. */
async function reportPdf(png: string, title: string) {
  // pdf-lib colours (0–1 per channel) for the report text and bands; not CSS, so no theme token applies.
  const { PDFDocument, StandardFonts, rgb: pdfColor } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("AI Workspace OS");
  doc.setCreationDate(new Date());
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const img = await doc.embedPng(png);
  const [W, H, margin, header, footer] = [842, 595, 28, 46, 22];
  const width = W - margin * 2;
  const scale = width / img.width;
  const fullHeight = img.height * scale;
  const area = H - margin * 2 - header - footer;
  const pages = Math.max(1, Math.ceil(fullHeight / area));
  const when = new Date().toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([W, H]);
    // The image is drawn shifted up by one area per page; the bands drawn over it keep each slice inside its frame.
    const top = H - margin - header;
    page.drawImage(img, { x: margin, y: top - fullHeight + i * area, width, height: fullHeight });
    page.drawRectangle({ x: 0, y: top, width: W, height: H - top, color: pdfColor(1, 1, 1) });
    page.drawRectangle({ x: 0, y: 0, width: W, height: margin + footer, color: pdfColor(1, 1, 1) });
    page.drawText(title, { x: margin, y: H - margin - 18, size: 16, font: bold, color: pdfColor(0.06, 0.11, 0.18) });
    page.drawText(`Exported ${when}`, { x: margin, y: H - margin - 34, size: 9, font, color: pdfColor(0.4, 0.45, 0.52) });
    page.drawText(`AI Workspace OS · page ${i + 1} of ${pages}`, { x: margin, y: margin, size: 8, font, color: pdfColor(0.4, 0.45, 0.52) });
  }
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
      const png = await withinTime(capture(node));
      if (png.length < 100) throw new Error("the dashboard came out empty. Scroll it into view and try again.");
      if (kind === "png") download(png, `${fileBase(title)}.png`);
      else {
        const url = URL.createObjectURL(await reportPdf(png, title));
        download(url, `${fileBase(title)}.pdf`);
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (err) {
      // Image loading fails with an Event, not an Error: say something useful either way.
      const why = err instanceof Error ? err.message : "part of the page couldn't be drawn (an image or font didn't load)";
      setError(`Couldn't export the dashboard: ${why}`);
    } finally {
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
