import { formatCents } from "@/lib/format";
import type { ComplianceFlag } from "@/lib/contract-checks";

// The compliance watchdog's browser-safe parts (Release B): coverage
// limits as stored and as the upload form writes them, and the flags' words.

export type ComplianceLimit = { label: string; amountCents: number };

export function limitsOf(value: unknown): ComplianceLimit[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is ComplianceLimit => Boolean(row) && typeof row.label === "string" && Number.isFinite(row.amountCents))
    .slice(0, 20);
}

export function limitsText(limits: ComplianceLimit[]) {
  return limits.map((row) => `${row.label}: ${formatCents(row.amountCents)}`).join("\n");
}

// "Each occurrence: $1,000,000" per line, as the form takes them.
export function parseLimits(text: string): ComplianceLimit[] | { error: string } {
  const rows: ComplianceLimit[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(.{1,80}?)\s*[:\-–]\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/.exec(line);
    if (!match) return { error: `Write each limit as "Each occurrence: $1,000,000" — "${line.slice(0, 60)}" isn't.` };
    const amount = Math.round(Number(match[2].replace(/,/g, "")) * 100);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000_000) return { error: `"${line.slice(0, 60)}" isn't an amount.` };
    rows.push({ label: match[1].trim(), amountCents: amount });
  }
  if (rows.length > 20) return { error: "Up to 20 limits." };
  return rows;
}

export const FLAG_WORDS: Record<ComplianceFlag, string> = {
  EXPIRED: "Expired",
  EXPIRING: "Runs out within 30 days",
  NAME: "Made out to someone else",
};

