// Likely duplicates inside one contacts import file (Nov 10, 2026). Pure
// and browser-safe: the preview runs it on the planned rows, no AI. The
// planner already folds rows with the same email, or the same name at the
// same company with no email; this finds what is left — the same phone or
// mobile digits, and the same name at the same company under two emails.

export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export type DuplicateRow = { line: number; name: string | null; email: string | null; phone: string | null; mobile: string | null; company: string | null };

export type FileDuplicate = { lines: number[]; names: string[]; reason: string };

export function findFileDuplicates(rows: DuplicateRow[]): FileDuplicate[] {
  const groups = new Map<string, { reason: string; rows: DuplicateRow[] }>();
  const add = (key: string, reason: string, row: DuplicateRow) => {
    const group = groups.get(key) ?? { reason, rows: [] };
    if (!group.rows.includes(row)) group.rows.push(row);
    groups.set(key, group);
  };
  for (const row of rows) {
    if (!row.name) continue;
    for (const key of new Set([phoneKey(row.phone), phoneKey(row.mobile)])) if (key) add(`phone:${key}`, "same phone number", row);
    if (row.company) add(`name:${row.name.toLowerCase()}|${row.company.toLowerCase()}`, "same name at the same company", row);
  }
  const out: FileDuplicate[] = [];
  const seen = new Set<string>();
  for (const group of groups.values()) {
    if (group.rows.length < 2) continue;
    const lines = group.rows.map((row) => row.line).sort((a, b) => a - b);
    const signature = lines.join(",");
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push({ lines, names: group.rows.map((row) => row.name ?? ""), reason: group.reason });
  }
  return out.sort((a, b) => a.lines[0] - b.lines[0]);
}
