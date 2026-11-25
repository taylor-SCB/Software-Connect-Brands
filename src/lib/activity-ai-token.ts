import { createHmac, timingSafeEqual } from "node:crypto";

// What one Activity AI card's Save made, signed by the server, for its
// "Saved · Undo" (Pipeline AI, Release 1). The browser hands the token back
// and can't change it: Undo takes back exactly this save (its batch through
// undoLogCore), the notes it wrote, and the contacts and companies it made
// while nothing else has been put on them. The same shape as the company
// page's claim token (src/lib/claim-token.ts). Not "use server".

export type CardSaveRecord = {
  v: 1;
  organizationId: string;
  userId: string;
  batchId: string | null;
  noteIds: string[];
  contactIds: string[];
  companyIds: string[];
  at: number;
};

// The toast offers Undo for ten seconds; the token is good for half an hour.
export const CARD_UNDO_MS = 30 * 60 * 1000;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(`activity-ai:${body}`).digest("base64url");
}

export function signCardSave(record: CardSaveRecord): string {
  const body = Buffer.from(JSON.stringify(record)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readCardSave(token: unknown, now = Date.now()): CardSaveRecord | null {
  if (typeof token !== "string" || token.length > 20_000) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const record = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CardSaveRecord;
    if (record.v !== 1 || typeof record.at !== "number" || now - record.at > CARD_UNDO_MS || record.at > now + 60_000) return null;
    if (!record.organizationId || !record.userId) return null;
    if (![record.noteIds, record.contactIds, record.companyIds].every((list) => Array.isArray(list) && list.every((id) => typeof id === "string"))) return null;
    return record;
  } catch {
    return null;
  }
}
