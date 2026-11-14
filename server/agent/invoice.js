import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const InvoiceProposal = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email().max(320).nullable(),
  customerAddress: z.string().trim().max(500).nullable().default(null),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  issueDate: z.string().refine(validDate, "Issue date must be YYYY-MM-DD"),
  dueDate: z.string().refine(validDate, "Due date must be YYYY-MM-DD"),
  lineItems: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(240),
        quantity: z.number().positive().max(1_000_000),
        unitPriceMinor: z.number().int().nonnegative().max(1_000_000_000),
      })
    )
    .min(1)
    .max(20),
  taxRateBps: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().trim().max(1000).nullable().default(null),
  sourceIds: z.array(z.string().min(1).max(200)).max(20).default([]),
});

const InvoiceInput = z.object({
  invoiceNumber: z.string().trim().min(1).max(80),
  from: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320),
    address: z.string().trim().max(500).nullable().optional(),
  }),
  customer: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320).nullable(),
    address: z.string().trim().max(500).nullable().optional(),
  }),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  issueDate: z.string().refine(validDate),
  dueDate: z.string().refine(validDate),
  lineItems: InvoiceProposal.shape.lineItems,
  taxRateBps: InvoiceProposal.shape.taxRateBps,
  notes: InvoiceProposal.shape.notes,
  sourceIds: InvoiceProposal.shape.sourceIds,
});

/** The model supplies fields; this function is the only authority for invoice maths and readiness. */
export function prepareInvoice(input) {
  const parsed = InvoiceInput.parse(input);
  const lineItems = parsed.lineItems.map((item) => ({
    ...item,
    totalMinor: Math.round(item.quantity * item.unitPriceMinor),
  }));
  const subtotalMinor = lineItems.reduce((sum, item) => sum + item.totalMinor, 0);
  const taxMinor = Math.round((subtotalMinor * parsed.taxRateBps) / 10_000);
  const totalMinor = subtotalMinor + taxMinor;
  const reasons = [];
  if (!parsed.customer.email) reasons.push("Add a customer email address before sending.");
  if (parsed.dueDate < parsed.issueDate) reasons.push("The due date must be on or after the issue date.");
  if (totalMinor <= 0) reasons.push("The invoice total must be greater than zero.");
  return {
    ...parsed,
    customer: { ...parsed.customer, address: parsed.customer.address ?? null },
    from: { ...parsed.from, address: parsed.from.address ?? null },
    lineItems,
    subtotalMinor,
    taxMinor,
    totalMinor,
    readiness: { ready: reasons.length === 0, reasons },
  };
}

const money = (minor, currency) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
};

const wrap = (text, max = 76) => {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= max) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
};

/** Generates the downloadable bytes on demand; no model-generated HTML or code is executed. */
export async function renderInvoicePdf(invoice) {
  const data = prepareInvoice(invoice);
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${data.invoiceNumber}`);
  doc.setAuthor(data.from.name);
  doc.setCreator("AI Workspace OS");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(30 / 255, 58 / 255, 138 / 255);
  const ink = rgb(15 / 255, 27 / 255, 45 / 255);
  const muted = rgb(78 / 255, 91 / 255, 112 / 255);
  const line = rgb(218 / 255, 223 / 255, 231 / 255);
  const page = doc.addPage([612, 792]);
  // The bundled PDF standard font is WinAnsi. Transliterate Latin accents and replace unsupported glyphs
  // instead of failing the whole download when a database value contains another writing system.
  const pdfText = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
  const draw = (value, options) => page.drawText(pdfText(value), options);
  const { width, height } = page.getSize();
  const left = 54;
  const right = width - 54;
  let y = height - 58;

  draw("INVOICE", { x: left, y, size: 24, font: bold, color: blue });
  const numberText = pdfText(data.invoiceNumber);
  draw(numberText, { x: right - regular.widthOfTextAtSize(numberText, 11), y: y + 4, size: 11, font: regular, color: muted });
  y -= 45;

  draw("From", { x: left, y, size: 9, font: bold, color: muted });
  draw("Bill to", { x: 330, y, size: 9, font: bold, color: muted });
  y -= 17;
  draw(data.from.name, { x: left, y, size: 12, font: bold, color: ink });
  draw(data.customer.name, { x: 330, y, size: 12, font: bold, color: ink });
  y -= 15;
  draw(data.from.email, { x: left, y, size: 9, font: regular, color: muted });
  if (data.customer.email) draw(data.customer.email, { x: 330, y, size: 9, font: regular, color: muted });
  y -= 13;
  if (data.from.address) {
    for (const part of wrap(data.from.address, 42).slice(0, 3)) {
      draw(part, { x: left, y, size: 9, font: regular, color: muted });
      y -= 12;
    }
  }
  const addressY = height - 135;
  if (data.customer.address) {
    let cy = addressY - 28;
    for (const part of wrap(data.customer.address, 42).slice(0, 3)) {
      draw(part, { x: 330, y: cy, size: 9, font: regular, color: muted });
      cy -= 12;
    }
  }
  y = Math.min(y, height - 205);

  draw(`Issued: ${data.issueDate}`, { x: left, y, size: 9, font: regular, color: ink });
  draw(`Due: ${data.dueDate}`, { x: 180, y, size: 9, font: regular, color: ink });
  draw(`Currency: ${data.currency}`, { x: 330, y, size: 9, font: regular, color: ink });
  y -= 28;

  page.drawRectangle({ x: left, y: y - 7, width: right - left, height: 25, color: blue });
  draw("Description", { x: left + 8, y, size: 9, font: bold, color: rgb(1, 1, 1) });
  draw("Qty", { x: 360, y, size: 9, font: bold, color: rgb(1, 1, 1) });
  draw("Unit price", { x: 410, y, size: 9, font: bold, color: rgb(1, 1, 1) });
  draw("Amount", { x: 505, y, size: 9, font: bold, color: rgb(1, 1, 1) });
  y -= 30;
  for (const item of data.lineItems) {
    // Long descriptions wrap onto a second line instead of being cut off.
    const [first, ...rest] = wrap(item.description, 52);
    const second = rest.join(" ");
    draw(first, { x: left + 8, y, size: 9, font: regular, color: ink });
    if (second) {
      draw(second.length > 56 ? `${second.slice(0, 55)}...` : second, { x: left + 8, y: y - 11, size: 9, font: regular, color: ink });
      y -= 11;
    }
    draw(String(item.quantity), { x: 360, y, size: 9, font: regular, color: ink });
    const unit = pdfText(money(item.unitPriceMinor, data.currency));
    const amount = pdfText(money(item.totalMinor, data.currency));
    draw(unit, { x: 480 - regular.widthOfTextAtSize(unit, 9), y, size: 9, font: regular, color: ink });
    draw(amount, { x: right - regular.widthOfTextAtSize(amount, 9), y, size: 9, font: regular, color: ink });
    y -= 22;
    page.drawLine({ start: { x: left, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.5, color: line });
  }

  y -= 6;
  const drawTotal = (label, value, strong = false) => {
    const labelFont = strong ? bold : regular;
    const valueFont = strong ? bold : regular;
    const valueText = pdfText(money(value, data.currency));
    draw(label, { x: 392, y, size: strong ? 11 : 9, font: labelFont, color: strong ? ink : muted });
    draw(valueText, { x: right - valueFont.widthOfTextAtSize(valueText, strong ? 11 : 9), y, size: strong ? 11 : 9, font: valueFont, color: strong ? blue : ink });
    y -= strong ? 22 : 18;
  };
  drawTotal("Subtotal", data.subtotalMinor);
  if (data.taxRateBps) drawTotal(`Tax ${(data.taxRateBps / 100).toFixed(2)}%`, data.taxMinor);
  drawTotal("Total", data.totalMinor, true);

  if (data.notes && y > 90) {
    y -= 12;
    draw("Notes", { x: left, y, size: 9, font: bold, color: muted });
    y -= 15;
    for (const part of wrap(data.notes, 88).slice(0, 5)) {
      draw(part, { x: left, y, size: 9, font: regular, color: ink });
      y -= 12;
    }
  }

  draw("Generated from a reviewed draft in AI Workspace OS", { x: left, y: 38, size: 8, font: regular, color: muted });
  return Buffer.from(await doc.save());
}

export function publicInvoice(doc) {
  const {
    _id: _storedId,
    from: _from,
    sourceIds: _sourceIds,
    sentGmailId: _sentGmailId,
    model: _model,
    sendError: _sendError,
    ...safe
  } = doc;
  return { ...safe, pdfUrl: `/api/invoices/${encodeURIComponent(doc._id)}/pdf`, id: doc._id };
}
