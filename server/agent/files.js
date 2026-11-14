// Turns an email attachment into text the AI can read (decision #43). Pure: works on a Buffer, no database, no Gmail.
// server/agent/content.js decides *which* attachments to read, caches the result and passes a vision reader.
//
//   PDF ............ text layer (unpdf); a scanned PDF with no text goes to vision
//   Word (.docx) ... paragraphs in order, tables as rows ("a | b | c"); mammoth as a fallback
//   Excel (.xlsx) .. every sheet, row by row ("a | b | c"), formulas show their cached value
//   PowerPoint ..... slide text in order
//   Images ......... vision (Gemini): the text in the image plus a short description
//   Calendar (.ics)  event, time, place, organizer, details
//   ZIP ............ lists the files and reads each supported one, including one ZIP inside
//   Text, CSV, HTML  as text
// Not read: old binary Office files (.xls, .doc, .ppt), GIFs, programs and anything else.
//
// Everything returned is UNTRUSTED email content: callers put it in the user turn only, escaped.
// ZIP safety: no extraction to disk, sizes are capped before and during decompression, encrypted entries and
// deep nesting are skipped, and only a few images per folder go to vision.
import zlib from "node:zlib";

export const LIMITS = {
  zipEntries: 300, // entries looked at in one ZIP
  zipFilesRead: 25, // files actually opened in one ZIP
  zipEntryBytes: 10 * 1024 * 1024, // one file, uncompressed
  zipTotalBytes: 30 * 1024 * 1024, // everything opened from one ZIP, uncompressed
  zipDepth: 2, // a ZIP inside a ZIP is read; a ZIP inside that isn't
  imagesPerZip: 3, // images sent to vision from one ZIP
  entryChars: 4000, // text kept per file inside a ZIP
  sheets: 10,
  sheetRows: 300,
  sheetCols: 40,
};

const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic", heif: "image/heif" };
const IMAGE_TYPES = new Set(Object.values(IMAGE_MIME));

const extOf = (name = "") => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");
const squeeze = (s) => s.replace(/\r/g, "").replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What kind of file this is, from its MIME type or extension; null = we don't read it. */
export function kindOf({ filename = "", mimeType = "" }) {
  const type = (mimeType || "").toLowerCase();
  const ext = extOf(filename);
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (type.includes("wordprocessingml") || ext === "docx") return "docx";
  if (type.includes("spreadsheetml") || ext === "xlsx" || ext === "xlsm") return "xlsx";
  if (type.includes("presentationml") || ext === "pptx") return "pptx";
  if (type === "text/calendar" || ext === "ics") return "calendar";
  if (type.includes("zip") || ext === "zip") return "zip";
  if (IMAGE_TYPES.has(type) || IMAGE_MIME[ext]) return "image";
  if (type === "text/html" || ext === "html" || ext === "htm") return "html";
  if (type.startsWith("text/") || ["txt", "csv", "md", "tsv", "json", "xml"].includes(ext)) return "text";
  return null;
}

function imageMime({ filename = "", mimeType = "" }) {
  const t = (mimeType || "").toLowerCase();
  return IMAGE_TYPES.has(t) ? t : IMAGE_MIME[extOf(filename)];
}

// ---------- ZIP ----------

/**
 * The entries of a ZIP file: [{ name, size, compSize, encrypted, read() }]. `read()` decompresses one entry and never
 * produces more than LIMITS.zipEntryBytes, whatever the headers claim. ZIP64 archives are treated as too large.
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < Math.min(count, LIMITS.zipEntries) && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x0800 ? "utf8" : "latin1");
    const zip64 = size === 0xffffffff || compSize === 0xffffffff;
    entries.push({
      name,
      size: zip64 ? Infinity : size,
      compSize,
      encrypted: Boolean(flags & 1),
      read() {
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("Broken ZIP entry");
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const comp = buf.subarray(start, start + compSize);
        if (method === 0) return Buffer.from(comp.subarray(0, LIMITS.zipEntryBytes));
        if (method === 8) return zlib.inflateRawSync(comp, { maxOutputLength: LIMITS.zipEntryBytes });
        throw new Error(`Unsupported ZIP compression (${method})`);
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const isJunk = (name) => name.endsWith("/") || /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\._)/.test(name);

async function zipText(buf, { describe, depth }) {
  const files = readZip(buf).filter((e) => !isJunk(e.name));
  const out = [`ZIP folder with ${plural(files.length, "file")}:`];
  let opened = 0;
  let total = 0;
  let images = 0;
  let imagesSkipped = 0;
  for (const e of files) {
    const kind = kindOf({ filename: e.name });
    if (e.encrypted) { out.push(`${e.name} (password-protected, skipped)`); continue; }
    if (!kind) { out.push(`${e.name} (not readable)`); continue; }
    if (e.size > LIMITS.zipEntryBytes || total + e.size > LIMITS.zipTotalBytes) { out.push(`${e.name} (too large, skipped)`); continue; }
    if (kind === "zip" && depth + 1 >= LIMITS.zipDepth) { out.push(`${e.name} (nested too deep, skipped)`); continue; }
    if (kind === "image" && (!describe || images >= LIMITS.imagesPerZip)) { imagesSkipped++; continue; }
    if (opened >= LIMITS.zipFilesRead) { out.push(`${e.name} (not opened: too many files)`); continue; }
    opened++;
    total += e.size;
    if (kind === "image") images++;
    let text = "";
    try {
      text = await extractText({ filename: e.name, data: e.read() }, { describe, depth: depth + 1 });
    } catch {
      out.push(`${e.name} (could not be read)`);
      continue;
    }
    out.push(text.trim() ? `— ${e.name} —\n${clip(squeeze(text), LIMITS.entryChars)}` : `${e.name} (no text)`);
  }
  if (imagesSkipped) out.push(`${plural(imagesSkipped, "more image")} not described`);
  return out.join("\n");
}

// ---------- Office XML ----------

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
const textRuns = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => decodeXml(m[1]));
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

function zipFiles(buf) {
  return new Map(readZip(buf).map((e) => [e.name.replace(/\\/g, "/"), e]));
}
const readXml = (files, name) => (files.has(name) ? files.get(name).read().toString("utf8") : "");

/** Column letters of a cell reference ("AB12") as a 0-based index. */
function colIndex(ref) {
  const letters = (ref.match(/^[A-Z]+/i)?.[0] ?? "A").toUpperCase();
  return [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
}

function xlsxText(buf) {
  const files = zipFiles(buf);
  const shared = [...readXml(files, "xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1], "t").join(""));
  const rels = new Map(
    [...readXml(files, "xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")])
  );
  const sheets = [...readXml(files, "xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const target = rels.get(attr(m[0], "r:id")) ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    return { name: decodeXml(attr(m[0], "name") ?? "Sheet"), path };
  });
  const out = [];
  for (const sh of sheets.slice(0, LIMITS.sheets)) {
    const xml = readXml(files, sh.path);
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= LIMITS.sheetRows) { rows.push(`… more rows not shown`); break; }
      const cells = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? "";
        const i = colIndex(attr(attrs, "r") ?? "");
        if (i >= LIMITS.sheetCols) continue;
        const t = attr(attrs, "t");
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const f = inner.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
        let value = "";
        if (t === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (t === "inlineStr") value = textRuns(inner, "t").join("");
        else if (t === "b") value = v === "1" ? "TRUE" : "FALSE";
        else if (v !== undefined) value = decodeXml(v);
        else if (f) value = `=${decodeXml(f)}`;
        cells[i] = value.replace(/\s+/g, " ").trim();
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(Boolean)) rows.push(Array.from(cells, (x) => x ?? "").join(" | "));
    }
    out.push(`Sheet: ${sh.name}\n${rows.join("\n") || "(empty)"}`);
  }
  if (sheets.length > LIMITS.sheets) out.push(`… ${plural(sheets.length - LIMITS.sheets, "more sheet")} not shown`);
  return out.join("\n\n");
}

/** Text of one Word paragraph: its runs, with tabs and line breaks kept. */
function wordParagraph(xml) {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
    .map((m) => (m[0] === "<w:tab/>" ? "\t" : m[0] === "<w:br/>" ? "\n" : decodeXml(m[1])))
    .join("");
}

/** Word body in reading order: paragraphs as lines, tables as rows ("a | b | c") so values stay with their columns. */
function docxText(buf) {
  const xml = readXml(zipFiles(buf), "word/document.xml");
  const body = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/)?.[1] ?? "";
  const out = [];
  for (const m of body.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g)) {
    if (m[0].startsWith("<w:tbl")) {
      for (const row of m[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
        const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) =>
          [...c[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => wordParagraph(p[0])).join(" ").replace(/\s+/g, " ").trim()
        );
        if (cells.some(Boolean)) out.push(cells.join(" | "));
      }
    } else {
      const line = wordParagraph(m[0]);
      if (line.trim()) out.push(line);
    }
  }
  return out.join("\n");
}

function pptxText(buf) {
  const files = zipFiles(buf);
  return [...files.keys()]
    .map((name) => ({ name, n: Number(name.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1]) }))
    .filter((s) => s.n)
    .sort((a, b) => a.n - b.n)
    .map((s) => `Slide ${s.n}: ${textRuns(readXml(files, s.name), "a:t").join(" ").replace(/\s+/g, " ").trim()}`)
    .join("\n");
}

// ---------- Calendar ----------

function icsDate(value, params) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/);
  if (!m) return value;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return day;
  const tz = m[6] ? " UTC" : params.match(/TZID=([^;:]+)/)?.[1] ? ` (${params.match(/TZID=([^;:]+)/)[1]})` : "";
  return `${day} ${m[4]}:${m[5]}${tz}`;
}

function icsText(buf) {
  const lines = buf.toString("utf8").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const unescape = (s) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT" && ev) { events.push(ev); ev = null; }
    else if (ev) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const [key, ...rest] = line.slice(0, i).split(";");
      ev[key.toUpperCase()] = { params: rest.join(";"), value: line.slice(i + 1) };
    }
  }
  return events
    .map((e) => {
      const out = [];
      if (e.SUMMARY) out.push(`Event: ${unescape(e.SUMMARY.value)}`);
      if (e.DTSTART) out.push(`When: ${icsDate(e.DTSTART.value, e.DTSTART.params)}${e.DTEND ? ` to ${icsDate(e.DTEND.value, e.DTEND.params)}` : ""}`);
      if (e.LOCATION) out.push(`Where: ${unescape(e.LOCATION.value)}`);
      if (e.ORGANIZER) out.push(`Organizer: ${e.ORGANIZER.params.match(/CN=([^;:]+)/)?.[1]?.replace(/"/g, "") ?? "someone"}`);
      if (e.DESCRIPTION) out.push(`Details: ${unescape(e.DESCRIPTION.value)}`);
      return out.join("\n");
    })
    .join("\n\n");
}

// ---------- entry point ----------

/**
 * Text of one file. `describe({ mimeType, data, filename })` reads images and scanned PDFs with vision; without it
 * those give "". `depth` is how deep inside ZIP folders this file is. Throws on a broken file (callers record that).
 */
export async function extractText({ filename = "", mimeType = "", data }, { describe, depth = 0 } = {}) {
  const kind = kindOf({ filename, mimeType });
  switch (kind) {
    case "pdf": {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(data));
      const { text } = await pdfText(doc, { mergePages: true });
      const t = (Array.isArray(text) ? text.join("\n") : text) || "";
      if (t.trim()) return t;
      return describe ? describe({ mimeType: "application/pdf", data, filename }) : ""; // scanned: no text layer
    }
    case "docx": {
      // Our own reader keeps tables as rows; mammoth is the fallback for documents it can't make sense of.
      let text = "";
      try {
        text = docxText(data);
      } catch {
        /* fall back below */
      }
      if (text.trim()) return text;
      const mammoth = (await import("mammoth")).default;
      return (await mammoth.extractRawText({ buffer: data })).value;
    }
    case "xlsx":
      return xlsxText(data);
    case "pptx":
      return pptxText(data);
    case "calendar":
      return icsText(data);
    case "zip":
      return zipText(data, { describe, depth });
    case "image":
      return describe ? describe({ mimeType: imageMime({ filename, mimeType }), data, filename }) : "";
    case "html":
      return data.toString("utf8").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
    case "text":
      return data.toString("utf8");
    default:
      return "";
  }
}
