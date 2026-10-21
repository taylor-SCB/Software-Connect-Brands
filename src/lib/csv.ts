// CSV reading shared by the importers (contacts, and Import Ratesheet in
// src/lib/price-list.ts), plus the tag and unit readers a ratesheet's
// rows go through. Pure functions with no server dependencies, so a
// preview in the browser reads a file exactly as the server will.

import {
  LINE_ITEM_TAGS,
  TAG_LABELS,
  UNIT_LABELS,
  UNITS_OF_MEASURE,
  tagHasUnits,
  unitAllowedForTag,
  type LineItemTagValue,
  type UnitOfMeasureValue,
} from "@/lib/constants";

// RFC 4180: quoted fields, doubled quotes inside them, CRLF or LF line
// ends, and the byte-order mark Excel likes to prepend. Also accepts
// semicolon- or tab-separated files, which some spreadsheet exports use.
export function parseCsv(text: string): string[][] {
  return parseCsvLines(text).map((row) => row.cells);
}

// Same parse, with the 1-based line each row starts on in the file, so an
// importer can say "Line 41" and mean the line the user sees in Excel even
// after blank lines and multi-line quoted cells.
export function parseCsvLines(text: string): { line: number; cells: string[] }[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = pickDelimiter(firstLine);

  const rows: { line: number; cells: string[] }[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let lineNo = 1;
  let rowLine = 1;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") lineNo += 1;
        field += ch;
      }
      continue;
    }
    // Only a quote that opens a field starts quoting. A stray one in the
    // middle of a value (12" pipe) is just a character, so it can never
    // swallow the rest of the file.
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push({ line: rowLine, cells: row });
      row = [];
      field = "";
      lineNo += 1;
      rowLine = lineNo;
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push({ line: rowLine, cells: row });
  }

  return rows.filter((entry) => entry.cells.some((cell) => cell.trim() !== ""));
}

function pickDelimiter(line: string) {
  const counts: [string, number][] = [",", ";", "\t"].map((d) => [d, line.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseTag(raw: string): { tag: LineItemTagValue; note?: string } {
  const value = raw.trim().toLowerCase();
  if (!value) return { tag: "MATERIALS" };
  const asEnum = value.toUpperCase().replace(/[^A-Z]+/g, "_");
  if ((LINE_ITEM_TAGS as readonly string[]).includes(asEnum)) return { tag: asEnum as LineItemTagValue };
  if (/labou?r/.test(value)) return { tag: "LABOR" };
  if (value.includes("material")) return { tag: "MATERIALS" };
  if (value.includes("software") || value.includes("saas") || value.includes("subscription")) return { tag: "SOFTWARE" };
  if (value.includes("project") || value.includes("service")) return { tag: "PROJECT_SERVICES" };
  if (value.includes("ship") || value.includes("freight") || value.includes("delivery")) return { tag: "SHIPPING" };
  if (value.includes("tax")) return { tag: "TAXES" };
  return { tag: "MATERIALS", note: `Unknown tag "${raw.trim()}" — used Materials` };
}

// Every spelling of a unit collapsed to letters only: "Per Hour", "/hr",
// "HR" and "hours" all land on PER_HOUR.
const UNIT_LOOKUP: Record<string, UnitOfMeasureValue> = {
  hr: "PER_HOUR", hrs: "PER_HOUR", hour: "PER_HOUR", hours: "PER_HOUR", hourly: "PER_HOUR",
  day: "PER_DAY", days: "PER_DAY", daily: "PER_DAY",
  personhour: "PER_PERSON_PER_HOUR", manhour: "PER_PERSON_PER_HOUR", manhours: "PER_PERSON_PER_HOUR", mh: "PER_PERSON_PER_HOUR",
  personday: "PER_PERSON_PER_DAY", manday: "PER_PERSON_PER_DAY", mandays: "PER_PERSON_PER_DAY",
  room: "PER_ROOM", rooms: "PER_ROOM",
  building: "PER_BUILDING", bldg: "PER_BUILDING",
  property: "PER_PROPERTY",
  ea: "EACH", each: "EACH",
  piece: "PER_PIECE", pieces: "PER_PIECE", pc: "PER_PIECE", pcs: "PER_PIECE",
  sqft: "PER_SQFT", sf: "PER_SQFT", squarefoot: "PER_SQFT", squarefeet: "PER_SQFT", sqfeet: "PER_SQFT", sq: "PER_SQFT",
  linearft: "PER_LINEAR_FT", lf: "PER_LINEAR_FT", lft: "PER_LINEAR_FT", linft: "PER_LINEAR_FT", linearfoot: "PER_LINEAR_FT", linearfeet: "PER_LINEAR_FT", lineal: "PER_LINEAR_FT", linealft: "PER_LINEAR_FT",
  cubicyard: "PER_CUBIC_YARD", cubicyards: "PER_CUBIC_YARD", cy: "PER_CUBIC_YARD", cuyd: "PER_CUBIC_YARD", yd: "PER_CUBIC_YARD", yard: "PER_CUBIC_YARD",
  item: "PER_ITEM", items: "PER_ITEM",
  gallon: "PER_GALLON", gallons: "PER_GALLON", gal: "PER_GALLON",
  pound: "PER_POUND", pounds: "PER_POUND", lb: "PER_POUND", lbs: "PER_POUND",
  unit: "PER_UNIT", units: "PER_UNIT",
  bed: "PER_BED", beds: "PER_BED",
  location: "PER_LOCATION", locations: "PER_LOCATION", site: "PER_LOCATION",
  device: "PER_DEVICE", devices: "PER_DEVICE", seat: "PER_DEVICE", seats: "PER_DEVICE",
};
for (const value of UNITS_OF_MEASURE) {
  UNIT_LOOKUP[value.toLowerCase().replace(/[^a-z]/g, "")] = value;
  UNIT_LOOKUP[UNIT_LABELS[value].toLowerCase().replace(/[^a-z]/g, "")] = value;
}

export function parseUnit(
  raw: string,
  tag: LineItemTagValue,
): { unit: UnitOfMeasureValue | null; note?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { unit: null };
  const key = trimmed.toLowerCase().replace(/^per\s+/, "").replace(/[^a-z]/g, "");
  const unit = UNIT_LOOKUP[key] ?? UNIT_LOOKUP[`per${key}`] ?? null;
  if (!unit) return { unit: null, note: `Unknown unit "${trimmed}" — left blank` };
  if (!tagHasUnits(tag)) {
    return { unit: null, note: `${TAG_LABELS[tag]} products carry no unit — "${trimmed}" ignored` };
  }
  if (!unitAllowedForTag(unit, tag)) {
    return { unit: null, note: `"${trimmed}" isn't a ${TAG_LABELS[tag]} unit — left blank` };
  }
  return { unit };
}
