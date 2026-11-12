import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

// Words the AI wrote and the workspace keeps (AI release A, Nov 12, 2026):
// one row per thing (a brief, an opener, the forecast's sentences) with a
// fingerprint of what it was written from. Opening it again with the same
// facts reads the row; once the facts move the row no longer matches and
// the next tap writes a new one. Nothing here calls Claude.

export function fingerprintOf(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

export async function readWriting<T>(organizationId: string, key: string, fingerprint: string): Promise<T | null> {
  const row = await prisma.aiWriting.findUnique({
    where: { organizationId_key: { organizationId, key } },
    select: { fingerprint: true, body: true },
  });
  return row && row.fingerprint === fingerprint ? (row.body as T) : null;
}

export async function storeWriting(organizationId: string, key: string, fingerprint: string, body: unknown) {
  const json = body as Prisma.InputJsonValue;
  await prisma.aiWriting.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, fingerprint, body: json },
    update: { fingerprint, body: json },
  });
}

// Every capitalised word an answer uses that the facts don't contain: a
// person, company or product the AI made up. Words that open a sentence,
// days, months and the app's own words are fine; everything else has to be
// somewhere in what it was given.
const COMMON = new Set(
  (
    "i a an the and or but if so ask call text email meeting quote contract deal deals pipeline primary poc associated " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september " +
    "october november december jan feb mar apr jun jul aug sep sept oct nov dec today tomorrow yesterday mon tue wed thu fri sat sun " +
    "attempted connected interested not actioned set completed sent signed won lost archived open hi hello hey thanks " +
    "voicemail no answer talked replied held no-show front desk wrong number they you we our your their he she it this that " +
    "last next new one ok okay am pm"
  ).split(" "),
);

export function inventedNames(answer: string, facts: unknown): string[] {
  const known = JSON.stringify(facts).toLowerCase();
  const found = new Set<string>();
  for (const sentence of answer.split(/(?<=[.!?:;\n])\s+|^\s*[-•]\s*/m)) {
    const words = sentence.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
    words.forEach((word, index) => {
      if (!/^[A-Z]/.test(word)) return;
      // A sentence's first word is checked only as the start of a two-word
      // name ("Bob Smith said"), never "Ask" or "Mention".
      if (index === 0 && !/^[A-Z]/.test(words[1] ?? "")) return;
      const bare = word.replace(/['’]s$/i, "").toLowerCase();
      if (COMMON.has(bare) || bare.length < 2) return;
      if (!known.includes(bare)) found.add(word);
    });
  }
  return [...found];
}
