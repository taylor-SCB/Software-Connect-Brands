import { createHmac, timingSafeEqual } from "node:crypto";

// What a claim on a company page moved, signed by the server (audit, Nov
// 11, 2026). "Moved onto Eli Park · Undo" used to send the activity ids,
// the company and the batch back from the browser and trust them, so a
// forged call could pull any touch logged on a person off them and delete
// Pipeline meetings. The Undo now carries this token instead: only the
// rows this claim moved, the company each came from, who claimed and when,
// none of which the browser can change. Not "use server": plain helpers.

export type ClaimRecord = {
  // The claim's batchId (its StatusChange rows).
  batchId: string;
  organizationId: string;
  userId: string;
  contactId: string;
  // companyId -> the activity ids the claim took off that company.
  from: Record<string, string[]>;
  // When the claim was made, on this server's clock.
  at: number;
};

// The Undo is offered for ten seconds; a token is good for half an hour.
export const CLAIM_UNDO_MS = 30 * 60 * 1000;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(`claim:${body}`).digest("base64url");
}

export function signClaim(record: ClaimRecord): string {
  const body = Buffer.from(JSON.stringify(record)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readClaim(token: unknown, now = Date.now()): ClaimRecord | null {
  if (typeof token !== "string" || token.length > 40_000) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const record = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ClaimRecord;
    if (typeof record.at !== "number" || now - record.at > CLAIM_UNDO_MS || record.at > now + 60_000) return null;
    if (!record.batchId || !record.organizationId || !record.userId || !record.contactId || !record.from) return null;
    return record;
  } catch {
    return null;
  }
}
