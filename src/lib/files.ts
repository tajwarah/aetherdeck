// Reading a file the person dropped or chose, on this computer: its text (PDF, Word, spreadsheet, plain text),
// a small picture of it, and its size. Nothing here sends anything anywhere; the assistant sends the text
// only when the person asks a question about it.

export type FileKind = "pdf" | "text" | "sheet" | "image";

export interface FileMaterial {
  name: string;
  size: number;
  mime: string;
  kind: FileKind;
  /** Readable text, empty for images and scanned PDFs. */
  text: string;
  /** "12 pages", "3 sheets", "1,204 words"… */
  detail: string;
  /** A small picture: the first page, or the image itself. */
  thumb?: string;
  /** Where it is on disk (desktop app only), for "Open document". */
  path?: string;
  /** The file itself, kept in memory for images and scanned PDFs the model reads directly. */
  blob?: Blob;
}

export const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.log,.rtf,.xlsx,.xls,.ods,.png,.jpg,.jpeg,.webp,.gif,.js,.ts,.py,.java,.c,.cpp,.go,.rs,.rb,.php,.css,.yaml,.yml";
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|log|rtf|js|ts|py|java|c|cpp|go|rs|rb|php|css|ya?ml)$/i;
const MAX_BYTES = 40 * 1024 * 1024;

const words = (t: string) => (t.match(/\S+/g) ?? []).length;
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
export const formatSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function kindOf(file: File): FileKind | null {
  const n = file.name.toLowerCase();
  if (file.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (/^image\/(png|jpeg|webp|gif)$/.test(file.type) || /\.(png|jpe?g|webp|gif)$/.test(n)) return "image";
  if (/\.(xlsx|xls|ods)$/.test(n)) return "sheet";
  if (n.endsWith(".docx") || file.type.startsWith("text/") || TEXT_EXT.test(n)) return "text";
  return null;
}

export async function readFile(file: File, path?: string): Promise<FileMaterial> {
  const kind = kindOf(file);
  if (!kind) throw new Error(`AetherDeck can't read ${file.name.split(".").pop()?.toUpperCase() ?? "this kind of"} files yet. PDFs, Word documents, spreadsheets, text and images work.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is ${formatSize(file.size)}; files up to ${formatSize(MAX_BYTES)} can be read.`);
  const base = { name: file.name, size: file.size, mime: file.type || "application/octet-stream", kind, path };
  if (kind === "image") {
    return { ...base, text: "", detail: "Image", thumb: URL.createObjectURL(file), blob: file };
  }
  if (kind === "pdf") {
    const { text, pages, thumb } = await readPdf(file);
    // A PDF with almost no text is a scan: the model reads the file itself, when it can.
    const scanned = text.replace(/\s/g, "").length < pages * 40;
    return { ...base, text: scanned ? "" : text, detail: `${plural(pages, "page")}${scanned ? " · scanned" : ""}`, thumb, blob: scanned ? file : undefined };
  }
  if (kind === "sheet") {
    const XLSX = await import("xlsx");
    const book = XLSX.read(await file.arrayBuffer(), { type: "array", sheetRows: 2000 });
    const text = book.SheetNames.map((n) => `## Sheet: ${n}\n${XLSX.utils.sheet_to_csv(book.Sheets[n])}`).join("\n\n");
    return { ...base, text, detail: plural(book.SheetNames.length, "sheet") };
  }
  if (file.name.toLowerCase().endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { ...base, text: value, detail: plural(words(value), "word") };
  }
  const text = await file.text();
  return { ...base, text, detail: /\.(csv|tsv)$/i.test(file.name) ? plural(text.split("\n").filter(Boolean).length, "row") : plural(words(text), "word") };
}

async function readPdf(file: File): Promise<{ text: string; pages: number; thumb?: string }> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 400); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("").trim());
  }
  let thumb: string | undefined;
  try {
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    const scale = 220 / vp.width;
    const canvas = document.createElement("canvas");
    const view = first.getViewport({ scale });
    canvas.width = Math.round(view.width);
    canvas.height = Math.round(view.height);
    await first.render({ canvas, viewport: view }).promise;
    thumb = canvas.toDataURL("image/png");
  } catch { /* no picture: the window shows an icon instead */ }
  const pages = doc.numPages;
  void doc.destroy();
  return { text: out.map((t, i) => `[Page ${i + 1}]\n${t}`).join("\n\n"), pages, thumb };
}

/** Base64 of a blob, for the few files the model reads itself. */
export async function base64Of(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
