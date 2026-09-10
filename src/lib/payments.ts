// Payment schedule math, shared by the contract page's editor and the
// server action that stores the rows. Amounts are computed here and only
// here so the screen, the stored row and the printed document agree.

export type PaymentKindValue = "PERCENT" | "FIXED" | "BALANCE";

export const PAYMENT_KIND_LABELS: Record<PaymentKindValue, string> = {
  PERCENT: "% of total",
  FIXED: "Fixed $",
  BALANCE: "Balance",
};

export type ScheduleRowInput = {
  label: string;
  kind: PaymentKindValue;
  // Whole percent for PERCENT rows; ignored otherwise.
  percent: number | null;
  // Cents for FIXED rows; ignored otherwise.
  fixedCents: number | null;
  // yyyy-mm-dd or "".
  dueOn: string;
};

export type ScheduleRowComputed = ScheduleRowInput & { amountCents: number };

// What each row is worth against a total. PERCENT rows round to the cent;
// BALANCE rows split whatever is left between them (the last one takes
// any leftover cent) so the column always sums to the total when at
// least one BALANCE row exists. Without one, the difference is reported
// so the screen can warn.
export function computeSchedule(rows: ScheduleRowInput[], totalCents: number) {
  const computed: ScheduleRowComputed[] = rows.map((row) => ({ ...row, amountCents: 0 }));

  let committed = 0;
  for (const row of computed) {
    if (row.kind === "PERCENT") {
      row.amountCents = Math.round((totalCents * (row.percent ?? 0)) / 100);
      committed += row.amountCents;
    } else if (row.kind === "FIXED") {
      row.amountCents = Math.round(row.fixedCents ?? 0);
      committed += row.amountCents;
    }
  }

  const balanceRows = computed.filter((row) => row.kind === "BALANCE");
  if (balanceRows.length > 0) {
    const remaining = totalCents - committed;
    const share = Math.floor(remaining / balanceRows.length);
    balanceRows.forEach((row, index) => {
      row.amountCents = index === balanceRows.length - 1 ? remaining - share * index : share;
    });
    committed = totalCents;
  }

  const scheduledCents = computed.reduce((sum, row) => sum + row.amountCents, 0);
  const finalDueOn = computed
    .map((row) => row.dueOn)
    .filter(Boolean)
    .sort()
    .at(-1) ?? "";

  return {
    rows: computed,
    scheduledCents,
    differenceCents: totalCents - scheduledCents,
    finalDueOn,
  };
}

// "Net 30" and friends. Free text is allowed too; these are the offered
// picks so the terms read the same on every document.
export const PAYMENT_TERM_OPTIONS = [
  "Due on receipt",
  "Net 15",
  "Net 30",
  "Net 45",
  "Net 60",
  "50% deposit, balance on completion",
  "Per payment schedule",
] as const;

// Days implied by a Net term, for a default due date; null when the
// terms don't name one.
export function netDays(terms: string | null | undefined): number | null {
  if (!terms) return null;
  if (/due on receipt/i.test(terms)) return 0;
  const match = /net\s*(\d+)/i.exec(terms);
  return match ? Number(match[1]) : null;
}

export type SchedulePreset = "FULL" | "DEPOSIT_BALANCE" | "INSTALLMENTS";

export const SCHEDULE_PRESET_LABELS: Record<SchedulePreset, string> = {
  FULL: "One payment",
  DEPOSIT_BALANCE: "Deposit + balance",
  INSTALLMENTS: "Installments",
};

export type InstallmentUnit = "MONTH" | "YEAR";

// yyyy-mm-dd, shifted by whole months or years without the day drifting
// (Jan 31 + 1 month is Feb 28, not Mar 3).
export function shiftDate(isoDate: string, count: number, unit: InstallmentUnit): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const months = unit === "YEAR" ? count * 12 : count;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

// Builds the rows for a preset. `start` is the first due date
// (yyyy-mm-dd); installments run from there every month or year.
export function presetRows(input: {
  preset: SchedulePreset;
  start: string;
  depositPercent?: number;
  count?: number;
  unit?: InstallmentUnit;
}): ScheduleRowInput[] {
  const { preset, start } = input;
  if (preset === "FULL") {
    return [{ label: "Payment in full", kind: "BALANCE", percent: null, fixedCents: null, dueOn: start }];
  }
  if (preset === "DEPOSIT_BALANCE") {
    const deposit = Math.min(Math.max(input.depositPercent ?? 50, 1), 99);
    return [
      { label: "Deposit", kind: "PERCENT", percent: deposit, fixedCents: null, dueOn: start },
      { label: "Balance on completion", kind: "BALANCE", percent: null, fixedCents: null, dueOn: "" },
    ];
  }
  const count = Math.min(Math.max(input.count ?? 3, 2), 60);
  const unit = input.unit ?? "MONTH";
  const each = Math.floor(10000 / count) / 100;
  return Array.from({ length: count }, (_, index) => ({
    label: `Installment ${index + 1} of ${count}`,
    kind: index === count - 1 ? ("BALANCE" as const) : ("PERCENT" as const),
    percent: index === count - 1 ? null : each,
    fixedCents: null,
    dueOn: start ? shiftDate(start, index, unit) : "",
  }));
}

// Today's date in a zone as yyyy-mm-dd, the shape <input type="date">
// and the schedule rows use.
export function todayIso(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// A yyyy-mm-dd stored as a DATE column comes back as midnight UTC;
// reading it back as a string must not shift the day.
export function dateToIso(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export function isoToDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
