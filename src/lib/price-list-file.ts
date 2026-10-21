// Turns an uploaded price list into plain rows of text, whatever it came
// in as. The same function runs in the browser (for the preview) and on
// the server (for the real import), so both read the file identically.
// read-excel-file's "universal" build is the one with no Web Worker and
// no Node built-ins, which is what lets it run in both places.

import readXlsxFile from "read-excel-file/universal";
import { Unzip, UnzipInflate } from "fflate";
import { parseCsvLines } from "@/lib/csv";

// An .xlsx is a zip of XML. A small file can unpack to hundreds of
// megabytes (on purpose or not), and the reader unpacks every part in
// memory, so the sizes the zip declares are checked first. A real 4 MB
// price list unpacks to well under this.
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;
// The reader fills every row out to the sheet's last used column, so one
// stray value in column XFD turns 2,000 rows into 32 million cells.
const MAX_SHEET_CELLS = 2_500_000;
// No price list has more than this many meaningful columns; anything
// further right is a stray note, and it would make the column list
// unmanageable.
const MAX_COLUMNS = 200;

export type SheetTable = {
  name: string;
  // `line` is the row number the person sees in Excel or a text editor.
  rows: { line: number; cells: string[] }[];
};

export type ReadResult = { ok: true; sheets: SheetTable[] } | { ok: false; error: string };

export type PriceListFileKind = "csv" | "xlsx";

export function priceListFileKind(fileName: string): PriceListFileKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return "xlsx";
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) return "csv";
  return null;
}

export function unsupportedFileMessage(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xls")) {
    return "That's an old-style Excel file (.xls). Open it in Excel and Save As .xlsx or .csv, then try again.";
  }
  if (lower.endsWith(".pdf")) {
    return "PDF price lists can't be read yet. Ask the vendor for the Excel version, or save it under Upload File for now.";
  }
  if (lower.endsWith(".numbers")) {
    return "That's a Numbers file. Export it as Excel (.xlsx) or CSV, then try again.";
  }
  return "Choose an Excel (.xlsx) or CSV file.";
}

// Excel hands back numbers, dates and booleans; the planner wants text,
// the same as a CSV would give it.
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value);
}

// Windows Excel's "CSV (Comma delimited)" is not UTF-8 but Windows-1252
// (° ® ” come out as �), and "Unicode Text" is UTF-16. UTF-8 is tried
// strictly first, so a real UTF-8 file is never misread.
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return decodeWindows1252(bytes);
  }
}

// Decoded by hand: Node's TextDecoder treats "windows-1252" as Latin-1 and
// turns ” – ™ into control characters, while a browser maps them, so the
// preview and the import would read different names.
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
function decodeWindows1252(bytes: Uint8Array): string {
  let out = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    const codes = Array.from(bytes.subarray(start, start + 8192), (byte) => CP1252_HIGH[byte] ?? byte);
    out += String.fromCharCode(...codes);
  }
  return out;
}

function columnNumber(letters: string) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// Reads only the zip's directory and the first few hundred bytes of each
// worksheet (where Excel writes its <dimension ref="A1:H2000"/>), so a
// file that would blow up the reader is refused before it is unpacked.
function inspectXlsx(bytes: Uint8Array): string | null {
  let unpacked = 0;
  let problem: string | null = null;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (problem) return;
    unpacked += file.originalSize ?? 0;
    if (unpacked > MAX_UNPACKED_BYTES) {
      problem = "That Excel file unpacks to far more than a price list should. Open it in Excel, Save As .xlsx (or .csv), and try again.";
      return;
    }
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(file.name)) return;
    const decoder = new TextDecoder();
    let head = "";
    file.ondata = (error, chunk, final) => {
      if (error || problem) return;
      head += decoder.decode(chunk, { stream: true });
      const dimension = head.match(/<dimension[^>]*\bref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"/);
      if (dimension) {
        const columns = columnNumber(dimension[3] ?? dimension[1]);
        const rows = Number(dimension[4] ?? dimension[2]);
        if (columns * rows > MAX_SHEET_CELLS) {
          problem =
            "One tab of that file reaches far past its prices (out to column " +
            (dimension[3] ?? dimension[1]) +
            "). In Excel, delete the empty columns and rows past your price list, save, and try again.";
        }
        file.terminate();
      } else if (head.length > 4096 || final) {
        file.terminate();
      }
    };
    file.start();
  };
  try {
    unzip.push(bytes, true);
  } catch {
    // Not a zip at all: the reader says so in its own words.
  }
  return problem;
}

// Columns past the last one with anything in it, on any row, are dropped;
// so is anything past MAX_COLUMNS.
function trimColumns(rows: { line: number; cells: string[] }[]) {
  let width = 0;
  for (const row of rows) {
    for (let index = row.cells.length - 1; index >= width; index -= 1) {
      if (row.cells[index].trim() !== "") {
        width = index + 1;
        break;
      }
    }
  }
  width = Math.min(width, MAX_COLUMNS);
  return rows.map((row) => ({ line: row.line, cells: row.cells.slice(0, width) }));
}

export async function readPriceListFile(
  fileName: string,
  content: ArrayBuffer,
): Promise<ReadResult> {
  const kind = priceListFileKind(fileName);
  if (!kind) return { ok: false, error: unsupportedFileMessage(fileName) };
  const bytes = new Uint8Array(content);

  if (kind === "csv") {
    const rows = trimColumns(parseCsvLines(decodeText(bytes)));
    if (rows.length === 0) return { ok: false, error: "The file is empty." };
    return { ok: true, sheets: [{ name: fileName, rows }] };
  }

  const problem = inspectXlsx(bytes);
  if (problem) return { ok: false, error: problem };

  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    sheets = (await readXlsxFile(content)) as { sheet: string; data: unknown[][] }[];
  } catch {
    return {
      ok: false,
      error: "That Excel file couldn't be opened. Open it in Excel, Save As .xlsx (or .csv), and try again.",
    };
  }

  const tables: SheetTable[] = sheets.map((sheet) => ({
    name: sheet.sheet,
    rows: trimColumns(
      sheet.data
        .map((cells, index) => ({ line: index + 1, cells: cells.map(cellText) }))
        .filter((row) => row.cells.some((cell) => cell.trim() !== "")),
    ),
  }));
  if (tables.every((table) => table.rows.length === 0)) return { ok: false, error: "The file is empty." };
  return { ok: true, sheets: tables.filter((table) => table.rows.length > 0) };
}
