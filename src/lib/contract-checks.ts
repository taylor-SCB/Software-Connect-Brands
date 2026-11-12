import { formatCents } from "@/lib/format";
import { computeSchedule, type ScheduleRowInput } from "@/lib/payments";
import { lineGrossCents } from "@/lib/quote-math";
import { addDays } from "@/lib/payments";

// The rules behind Release B's contract checks (Nov 12, 2026, the AI
// release). Pure: no database, so the browser and the server read the
// same words, and every problem is found by a rule first. Claude only
// rewords a rule's finding (the price check) or adds what wording alone
// can show (read before send); a person always decides.

/* ------------------------------ price check ------------------------------ */

export type PriceCheckRow = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  // The catalog product behind the row, when there is one.
  product: {
    costCents: number;
    // The starred supplier's minimum price per unit (starredMinimumCents).
    minPriceCents: number | null;
    // "EACH", "cu:<id>", or null when the product has none.
    unitKey: string | null;
    unitLabel: string | null;
  } | null;
  unitKey: string | null;
  unitLabel: string | null;
};

export type PriceCheckColumn = {
  label: string; // "Contract A"
  payable: boolean;
  rows: PriceCheckRow[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  schedule: ScheduleRowInput[];
};

export type CheckProblem = {
  id: string;
  where: string;
  code: "UNDER_COST" | "UNDER_MINIMUM" | "UNIT" | "DISCOUNT_OVER_MARGIN" | "SCHEDULE_TOTAL" | "PO_OVER_COST" | "WORDING_TOTAL" | "QUOTE_CHANGED" | "WORDING";
  // What is wrong, in plain words, from the numbers.
  text: string;
  // What to do about it.
  fix: string;
  // The numbers as the text writes them, for the AI and its check.
  facts: Record<string, string | number>;
};

const net = (row: { quantity: number; unitPriceCents: number; discountCents: number }) =>
  lineGrossCents(row.quantity, row.unitPriceCents) - row.discountCents;

// Compared before rounding, a millionth of a cent for floating point, the
// way the quote line's "Below minimum" flag compares.
const under = (cents: number, quantity: number, perUnit: number) => cents < quantity * perUnit - 1e-6;

export function priceCheckProblems(columns: PriceCheckColumn[]): CheckProblem[] {
  const problems: CheckProblem[] = [];
  for (const column of columns) {
    const where = column.label;
    column.rows.forEach((row, index) => {
      const product = row.product;
      const id = `${where}:${index}`;
      const rowNet = net(row);
      if (product && row.quantity > 0) {
        if (!column.payable && product.costCents > 0 && under(rowNet, row.quantity, product.costCents)) {
          problems.push({
            id: `${id}:cost`,
            where,
            code: "UNDER_COST",
            text: `${row.name} comes to ${formatCents(rowNet)}, under its cost of ${formatCents(Math.round(row.quantity * product.costCents))}.`,
            fix: "Raise its price or take off its discount on the quote row above.",
            facts: { row: row.name, rowTotal: formatCents(rowNet), cost: formatCents(Math.round(row.quantity * product.costCents)), quantity: row.quantity },
          });
        } else if (!column.payable && product.minPriceCents !== null && under(rowNet, row.quantity, product.minPriceCents)) {
          problems.push({
            id: `${id}:min`,
            where,
            code: "UNDER_MINIMUM",
            text: `${row.name} comes to ${formatCents(rowNet)}, under the starred supplier's minimum of ${formatCents(Math.round(row.quantity * product.minPriceCents))}.`,
            fix: "Raise its price on the quote row, or go ahead if the lower margin is on purpose.",
            facts: { row: row.name, rowTotal: formatCents(rowNet), minimum: formatCents(Math.round(row.quantity * product.minPriceCents)), quantity: row.quantity },
          });
        }
        if (column.payable && row.quantity > 0 && net(row) > Math.round(row.quantity * product.costCents) && product.costCents >= 0) {
          problems.push({
            id: `${id}:po`,
            where,
            code: "PO_OVER_COST",
            text: `${row.name} is ordered at ${formatCents(rowNet)}, above the catalog cost of ${formatCents(Math.round(row.quantity * product.costCents))}.`,
            fix: "Check the supplier's price. The catalog cost comes from their starred ratesheet.",
            facts: { row: row.name, rowTotal: formatCents(rowNet), cost: formatCents(Math.round(row.quantity * product.costCents)), quantity: row.quantity },
          });
        }
        if (product.unitKey && row.unitKey !== product.unitKey) {
          problems.push({
            id: `${id}:unit`,
            where,
            code: "UNIT",
            text: `${row.name} is sold by ${row.unitLabel ?? "no unit"} here, but the product is ${product.unitLabel ?? product.unitKey}.`,
            fix: "Check the quantity means what you think, then fix the unit on the quote line if it's wrong.",
            facts: { row: row.name, rowUnit: row.unitLabel ?? "none", productUnit: product.unitLabel ?? product.unitKey },
          });
        }
      }
    });

    // Only when every row has a catalog cost: a typed row's cost isn't
    // known, so the contract's margin isn't either.
    if (!column.payable && column.discountCents > 0 && column.rows.length > 0) {
      if (column.rows.every((row) => row.product)) {
        const marginCents = column.rows.reduce((sum, row) => sum + net(row) - Math.round(row.quantity * row.product!.costCents), 0);
        if (column.discountCents > marginCents) {
          problems.push({
            id: `${where}:discount`,
            where,
            code: "DISCOUNT_OVER_MARGIN",
            text: `The ${formatCents(column.discountCents)} discount is more than the ${formatCents(Math.max(0, marginCents))} this contract makes over cost.`,
            fix: "Make the discount smaller, or go ahead if you mean to sell at a loss.",
            facts: { discount: formatCents(column.discountCents), margin: formatCents(Math.max(0, marginCents)) },
          });
        }
      }
    }

    const schedule = computeSchedule(column.schedule, column.totalCents);
    if (column.schedule.length > 0 && schedule.differenceCents !== 0) {
      problems.push({
        id: `${where}:schedule`,
        where,
        code: "SCHEDULE_TOTAL",
        text: `The payment schedule comes to ${formatCents(schedule.scheduledCents)}, not the ${formatCents(column.totalCents)} total.`,
        fix: "Add a Balance row, or change the amounts so they add up.",
        facts: { scheduled: formatCents(schedule.scheduledCents), total: formatCents(column.totalCents) },
      });
    }
  }
  return problems;
}

/* ---------------------------- read before send ---------------------------- */

export type SendCheckInput = {
  body: string;
  rows: { name: string; quantity: number; unitPriceCents: number; discountCents: number; quoteLine: { quantity: number; unitPriceCents: number; discountCents: number } | null }[];
  totalCents: number;
  schedule: { label: string; amountCents: number; kind: string; percent: number | null; fixedCents: number | null; dueOn: string }[];
};

// Dollar amounts in the wording, with where they sit.
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g;
export function moneyIn(text: string): { cents: number; at: number; text: string }[] {
  const found: { cents: number; at: number; text: string }[] = [];
  for (const match of text.matchAll(MONEY)) {
    const cents = Math.round(Number(`${match[1].replace(/,/g, "")}${match[2] ?? ""}`) * 100);
    found.push({ cents, at: match.index ?? 0, text: match[0] });
  }
  return found;
}

// The arithmetic, without the AI: the schedule against the total, a total
// written in the wording against the rows, and rows the quote has since
// changed.
export function sendCheckRules(input: SendCheckInput): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const scheduled = input.schedule.reduce((sum, row) => sum + row.amountCents, 0);
  if (input.schedule.length > 0 && scheduled !== input.totalCents) {
    problems.push({
      id: "schedule",
      where: "Payment table",
      code: "SCHEDULE_TOTAL",
      text: `The payment table comes to ${formatCents(scheduled)}, not the ${formatCents(input.totalCents)} total.`,
      fix: "Fix the payment table so it adds up, or add a Balance row.",
      facts: { scheduled: formatCents(scheduled), total: formatCents(input.totalCents) },
    });
  }
  // A total written in the wording: an amount on a line that says total
  // (not subtotal). Only flagged when no amount on such a line is the
  // contract's total, so a line listing several figures isn't noise.
  const totals: { cents: number; text: string; line: string }[] = [];
  for (const line of input.body.split("\n")) {
    if (!/\btotal\b/i.test(line.replace(/\bsub-?total\b/gi, " "))) continue;
    for (const amount of moneyIn(line)) totals.push({ cents: amount.cents, text: amount.text, line: line.trim() });
  }
  if (input.rows.length > 0 && totals.length > 0 && !totals.some((entry) => entry.cents === input.totalCents)) {
    const first = totals[0];
    problems.push({
      id: "wording-total",
      where: "Agreement",
      code: "WORDING_TOTAL",
      text: `The wording says ${first.text} (“${first.line.slice(0, 120)}”), but the rows come to ${formatCents(input.totalCents)}.`,
      fix: "Change the amount in the wording, or the rows, so they agree.",
      facts: { written: formatCents(first.cents), total: formatCents(input.totalCents) },
    });
  }
  input.rows.forEach((row, index) => {
    const line = row.quoteLine;
    if (!line) return;
    if (line.quantity !== row.quantity || line.unitPriceCents !== row.unitPriceCents || line.discountCents !== row.discountCents) {
      problems.push({
        id: `row:${index}`,
        where: "Line items",
        code: "QUOTE_CHANGED",
        text: `${row.name}: the quote now says ${line.quantity} × ${formatCents(line.unitPriceCents)}${line.discountCents ? ` less ${formatCents(line.discountCents)}` : ""}, the contract has ${row.quantity} × ${formatCents(row.unitPriceCents)}${row.discountCents ? ` less ${formatCents(row.discountCents)}` : ""}.`,
        fix: "If the quote is right, cancel this contract and make it again from the Contract Coordinator.",
        facts: { row: row.name, quoteQuantity: line.quantity, quotePrice: formatCents(line.unitPriceCents), quantity: row.quantity, price: formatCents(row.unitPriceCents) },
      });
    }
  });
  return problems;
}

/* ------------------------------ placing text ------------------------------ */

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Where a quoted snippet sits in the wording, when it sits there exactly
// once. Runs of spaces and line breaks in the snippet match any run of
// them (the AI writes a wrapped line on one line), and curly quotes match
// straight ones; everything else must match as written.
export function locateOnce(body: string, snippet: string): { start: number; end: number } | null {
  const trimmed = snippet.trim();
  if (trimmed.length < 3) return null;
  const pattern = trimmed
    .split(/\s+/)
    .map((word) =>
      escapeRegex(word)
        .replace(/['‘’]/g, "['‘’]")
        .replace(/["“”]/g, '["“”]'),
    )
    .join("\\s+");
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "g");
  } catch {
    return null;
  }
  const matches = [...body.matchAll(regex)];
  if (matches.length !== 1) return null;
  const start = matches[0].index ?? 0;
  return { start, end: start + matches[0][0].length };
}

export function foundIn(text: string, snippet: string) {
  const trimmed = snippet.trim();
  if (!trimmed) return false;
  const squash = (value: string) => value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").toLowerCase();
  return squash(text).includes(squash(trimmed));
}

export type RedlineChange = {
  id: string;
  snippet: string;
  // What they want instead; "" when they struck it out.
  replacement: string;
  deleted: boolean;
  explanation: string;
};

// Puts the accepted changes into the wording, each where its snippet still
// sits exactly once. One that no longer places (an earlier change took its
// words) is handed back so the screen can say so.
export function applyRedlines(body: string, changes: RedlineChange[]): { body: string; applied: string[]; missed: string[] } {
  let text = body;
  const applied: string[] = [];
  const missed: string[] = [];
  for (const change of changes) {
    const place = locateOnce(text, change.snippet);
    if (!place) {
      missed.push(change.id);
      continue;
    }
    let replacement = change.deleted ? "" : change.replacement;
    let end = place.end;
    // A struck-out sentence takes one space with it, not leaving two.
    if (!replacement && text[end] === " " && (place.start === 0 || /\s/.test(text[place.start - 1]))) end += 1;
    replacement = replacement.replace(/\r\n?/g, "\n");
    text = text.slice(0, place.start) + replacement + text.slice(end);
    applied.push(change.id);
  }
  return { body: text, applied, missed };
}

/* -------------------------------- dates -------------------------------- */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Whether a snippet writes out this day, in any of the ways a contract
// writes one: "March 3, 2027", "Mar. 3rd 2027", "3 March 2027", "3/3/2027",
// "03/03/27", "2027-03-03".
export function dateWrittenIn(snippet: string, iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const text = snippet.toLowerCase().replace(/\s+/g, " ");
  const name = MONTHS[month - 1];
  const short = name.slice(0, 3);
  const monthWord = `(?:${name}|${short}\\.?)`;
  const dayWord = `0?${day}(?:st|nd|rd|th)?`;
  const yearWord = `(?:${year}|'?${String(year).slice(2)})`;
  const patterns = [
    `\\b${monthWord} ${dayWord},? ${yearWord}\\b`,
    `\\b${dayWord} (?:of )?${monthWord},? ${yearWord}\\b`,
    `\\b0?${month}[/.-]0?${day}[/.-](?:${year}|${String(year).slice(2)})\\b`,
    `\\b${year}-0?${month}-0?${day}\\b`,
  ];
  return patterns.some((pattern) => new RegExp(pattern).test(text));
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, sixty: 60, ninety: 90,
};

// Whether a snippet says this count ("30", "thirty (30)").
export function countWrittenIn(snippet: string, count: number): boolean {
  const text = snippet.toLowerCase();
  if (new RegExp(`(?<![\\d.])${count}(?![\\d.])`).test(text)) return true;
  return Object.entries(NUMBER_WORDS).some(([word, value]) => value === count && new RegExp(`\\b${word}\\b`).test(text));
}

export type OffsetUnit = "days" | "weeks" | "months" | "years";

export function addOffset(iso: string, count: number, unit: OffsetUnit): string {
  if (unit === "days") return addDays(iso, count);
  if (unit === "weeks") return addDays(iso, count * 7);
  const [y, m, d] = iso.split("-").map(Number);
  const months = unit === "years" ? count * 12 : count;
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  // The 31st plus a month is the last day of a shorter month.
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/* ------------------------------ compliance ------------------------------ */

// A business name with the parts that don't make it a different business
// taken off: case, punctuation, "the", and LLC / Inc / Co and friends.
export function businessKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|llc|l l c|inc|incorporated|co|company|corp|corporation|ltd|limited|pllc|lp|llp|dba)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameBusiness(a: string, b: string) {
  const left = businessKey(a);
  const right = businessKey(b);
  return Boolean(left) && left === right;
}

export type ComplianceFlag = "EXPIRED" | "EXPIRING" | "NAME";

// What a compliance file needs someone to look at: run out, running out
// within 30 days, or made out to somebody else.
export function complianceFlags(
  doc: { expiresOn: Date | null; namedInsured: string | null },
  expectedName: string | null,
  now: Date = new Date(),
): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];
  if (doc.expiresOn) {
    const today = now.toISOString().slice(0, 10);
    const expires = doc.expiresOn.toISOString().slice(0, 10);
    if (expires < today) flags.push("EXPIRED");
    else if (expires <= addDays(today, 30)) flags.push("EXPIRING");
  }
  if (doc.namedInsured && expectedName && !sameBusiness(doc.namedInsured, expectedName)) flags.push("NAME");
  return flags;
}
