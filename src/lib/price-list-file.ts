// Turns an uploaded price list into plain rows of text, whatever it came
// in as. The same function runs in the browser (for the preview) and on
// the server (for the real import), so both read the file identically.
// read-excel-file's "universal" build is the one with no Web Worker and
// no Node built-ins, which is what lets it run in both places.

import readXlsxFile from "read-excel-file/universal";
import { parseCsvLines } from "@/lib/csv";

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

export async function readPriceListFile(
  fileName: string,
  content: ArrayBuffer,
): Promise<ReadResult> {
  const kind = priceListFileKind(fileName);
  if (!kind) return { ok: false, error: unsupportedFileMessage(fileName) };

  if (kind === "csv") {
    const text = new TextDecoder("utf-8").decode(content);
    const rows = parseCsvLines(text);
    if (rows.length === 0) return { ok: false, error: "The file is empty." };
    return { ok: true, sheets: [{ name: fileName, rows }] };
  }

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
    rows: sheet.data
      .map((cells, index) => ({ line: index + 1, cells: cells.map(cellText) }))
      .filter((row) => row.cells.some((cell) => cell.trim() !== "")),
  }));
  if (tables.every((table) => table.rows.length === 0)) return { ok: false, error: "The file is empty." };
  return { ok: true, sheets: tables.filter((table) => table.rows.length > 0) };
}
