// Reading attachments of every common business type (server/agent/files.js): Excel, Word, PowerPoint, PDF (also
// scanned), images, calendar invites and ZIP folders. Real files are built in memory by ./helpers/files.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { docx, pdf, png, pptx, xlsx, zip } from "./helpers/files.mjs";

const { kindOf, readZip, extractText, LIMITS } = await import("../../server/agent/files.js");

/** A fake vision reader: records what it was asked to look at. */
function fakeVision() {
  const calls = [];
  const describe = async ({ mimeType, filename }) => {
    calls.push({ mimeType, filename });
    return `[vision: ${filename}]`;
  };
  return { calls, describe };
}

test("kindOf: recognises files by type or extension, and leaves out old binary Office formats and programs", () => {
  const k = (filename, mimeType = "application/octet-stream") => kindOf({ filename, mimeType });
  assert.equal(k("Statement.xlsx"), "xlsx");
  assert.equal(k("x", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "xlsx");
  assert.equal(k("Macro.xlsm"), "xlsx");
  assert.equal(k("Report.docx"), "docx");
  assert.equal(k("Deck.pptx"), "pptx");
  assert.equal(k("Quote.PDF"), "pdf");
  assert.equal(k("photo.jpg"), "image");
  assert.equal(k("x", "image/png"), "image");
  assert.equal(k("scan.webp"), "image");
  assert.equal(k("invite.ics"), "calendar");
  assert.equal(k("x", "text/calendar"), "calendar");
  assert.equal(k("receipts.zip"), "zip");
  assert.equal(k("x", "application/x-zip-compressed"), "zip");
  assert.equal(k("list.csv"), "text");
  assert.equal(k("page.html"), "html");
  assert.equal(k("old.xls"), null); // legacy binary Excel
  assert.equal(k("old.doc"), null); // legacy binary Word
  assert.equal(k("tool.exe"), null);
  assert.equal(k("anim.gif"), null); // Gemini can't read GIFs
});

test("Excel: every sheet by name, rows as columns, shared and inline strings, numbers, formulas", async () => {
  const buf = xlsx([
    {
      name: "Statement",
      rows: [
        ["Invoice", "Amount", "Paid", "Balance"],
        ["INV-20391", 3115.5, 0, { f: "B2-C2", v: 3115.5 }],
        ["INV-20405", 8900, 4000, { f: "B3-C3" }],
        [{ inline: "Total" }, { f: "SUM(B2:B3)", v: 12015.5 }, null, null],
      ],
    },
    { name: "Ageing", rows: [["Bucket", "Balance"], ["31-60 days overdue", 3115.5]] },
  ]);
  const text = await extractText({ filename: "Statement.xlsx", data: buf });
  assert.match(text, /Sheet: Statement/);
  assert.match(text, /Invoice \| Amount \| Paid \| Balance/);
  assert.match(text, /INV-20391 \| 3115\.5 \| 0 \| 3115\.5/);
  assert.match(text, /INV-20405 \| 8900 \| 4000 \| =B3-C3/); // no cached value: show the formula
  assert.match(text, /Total \| 12015\.5/);
  assert.match(text, /Sheet: Ageing\n[\s\S]*31-60 days overdue \| 3115\.5/);
});

test("Word: paragraphs in order, tables as rows so values stay with their columns", async () => {
  const text = await extractText({
    filename: "Credit_Note.docx",
    data: docx(["Credit note request", { table: [["SKU", "Qty", "Credit"], ["NW-BTL-750", "200", "$1,960.00"]] }, "Please issue the credit note."]),
  });
  assert.match(text, /Credit note request\nSKU \| Qty \| Credit\nNW-BTL-750 \| 200 \| \$1,960\.00\nPlease issue the credit note\./);
});

test("PowerPoint: slide text in slide order", async () => {
  const text = await extractText({ filename: "QBR.pptx", data: pptx([["Q4 review", "Revenue up"], ["Next steps"], ["Thank you"]]) });
  assert.match(text, /Slide 1: Q4 review Revenue up\nSlide 2: Next steps\nSlide 3: Thank you/);
});

test("PDF with text is read directly, without vision", async () => {
  const v = fakeVision();
  const text = await extractText({ filename: "Invoice.pdf", data: pdf(["Invoice INV-20431", "Total due 9,070.00"]) }, { describe: v.describe });
  assert.match(text, /Invoice INV-20431/);
  assert.match(text, /9,070\.00/);
  assert.equal(v.calls.length, 0);
});

test("a scanned PDF (no text layer) is read with vision; without vision it gives no text", async () => {
  const scan = pdf([]);
  const v = fakeVision();
  assert.equal(await extractText({ filename: "scan.pdf", data: scan }, { describe: v.describe }), "[vision: scan.pdf]");
  assert.deepEqual(v.calls, [{ mimeType: "application/pdf", filename: "scan.pdf" }]);
  assert.equal(await extractText({ filename: "scan.pdf", data: scan }), "");
});

test("images are read with vision (with the right MIME type); without vision there is no text", async () => {
  const v = fakeVision();
  assert.equal(await extractText({ filename: "damage.jpg", data: png() }, { describe: v.describe }), "[vision: damage.jpg]");
  assert.equal(await extractText({ filename: "x", mimeType: "image/png", data: png() }, { describe: v.describe }), "[vision: x]");
  assert.deepEqual(v.calls.map((c) => c.mimeType), ["image/jpeg", "image/png"]);
  assert.equal(await extractText({ filename: "damage.png", data: png() }), "");
});

test("calendar invites: what, when, where, who", async () => {
  const ics = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Q1 planning call", "DTSTART:20261119T150000Z", "DTEND:20261119T160000Z",
    "LOCATION:Video call", "ORGANIZER;CN=Priya Raman:mailto:priya@lumen.example", "DESCRIPTION:Agenda: volumes\\, pricing", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const text = await extractText({ filename: "invite.ics", data: Buffer.from(ics) });
  assert.match(text, /Event: Q1 planning call/);
  assert.match(text, /When: 2026-11-19 15:00 UTC to 2026-11-19 16:00 UTC/);
  assert.match(text, /Where: Video call/);
  assert.match(text, /Organizer: Priya Raman/);
  assert.match(text, /Agenda: volumes, pricing/);
});

test("ZIP: lists the files, reads each supported one (also a ZIP inside), describes images, skips junk", async () => {
  const inner = zip([{ name: "note.txt", data: "Inner note: taxi 79.95" }]);
  const buf = zip([
    { name: "receipts/01_hotel.csv", data: "item,amount\nHarbor Inn,412.80" },
    { name: "receipts/02_booth.docx", data: docx(["Booth 14B rental 1,250.00"]) },
    { name: "receipts/taxis.zip", data: inner },
    { name: "receipts/photo.png", data: png() },
    { name: "receipts/old.xls", data: "binary" },
    { name: "__MACOSX/._01_hotel.csv", data: "junk" },
    { name: "receipts/", data: "" },
  ]);
  const v = fakeVision();
  const text = await extractText({ filename: "Trade_show_receipts.zip", data: buf }, { describe: v.describe });
  assert.match(text, /ZIP folder with 5 files/);
  assert.match(text, /— receipts\/01_hotel\.csv —\nitem,amount\nHarbor Inn,412\.80/);
  assert.match(text, /Booth 14B rental 1,250\.00/);
  assert.match(text, /Inner note: taxi 79\.95/);
  assert.match(text, /\[vision: receipts\/photo\.png\]/);
  assert.match(text, /receipts\/old\.xls \(not readable\)/);
  assert.doesNotMatch(text, /__MACOSX|junk/);
});

test("ZIP safety: encrypted entries, entries claiming a huge size, and too-deep nesting are skipped, not opened", async () => {
  const deepest = zip([{ name: "secret.txt", data: "level three" }]);
  const level2 = zip([{ name: "deeper.zip", data: deepest }, { name: "two.txt", data: "level two" }]);
  const buf = zip([
    { name: "locked.txt", data: "password protected", encrypted: true },
    { name: "bomb.txt", data: "x", fakeSize: 900 * 1024 * 1024 },
    { name: "level1.zip", data: level2 },
  ]);
  const text = await extractText({ filename: "safety.zip", data: buf });
  assert.match(text, /locked\.txt \(password-protected, skipped\)/);
  assert.match(text, /bomb\.txt \(too large, skipped\)/);
  assert.match(text, /level two/);
  assert.doesNotMatch(text, /level three/);
  assert.match(text, /deeper\.zip \(nested too deep, skipped\)/);
});

test("ZIP: at most LIMITS.imagesPerZip images go to vision, so a folder of photos can't run up costs", async () => {
  const many = Array.from({ length: LIMITS.imagesPerZip + 3 }, (_, i) => ({ name: `p${i}.png`, data: png() }));
  const v = fakeVision();
  const text = await extractText({ filename: "photos.zip", data: zip(many) }, { describe: v.describe });
  assert.equal(v.calls.length, LIMITS.imagesPerZip);
  assert.match(text, /more images not described/);
});

test("readZip refuses something that isn't a ZIP", () => {
  assert.throws(() => readZip(Buffer.from("not a zip at all")), /not a ZIP/i);
});
