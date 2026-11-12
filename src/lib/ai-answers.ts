import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// What an AI helper wrote, kept per subject with a fingerprint of what it
// was written from (Release B, Nov 12, 2026), so a page opened again, or a
// second click on the same unchanged contract, never pays twice.

export function fingerprintOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

export async function readAnswer<T>(organizationId: string, kind: string, key: string, fingerprint?: string): Promise<T | null> {
  const row = await prisma.aiAnswer.findUnique({
    where: { organizationId_kind_key: { organizationId, kind, key } },
    select: { body: true, fingerprint: true },
  });
  if (!row) return null;
  if (fingerprint !== undefined && row.fingerprint !== fingerprint) return null;
  return row.body as T;
}

export async function keepAnswer(organizationId: string, kind: string, key: string, fingerprint: string, body: unknown) {
  const json = body as Prisma.InputJsonValue;
  await prisma.aiAnswer.upsert({
    where: { organizationId_kind_key: { organizationId, kind, key } },
    create: { organizationId, kind, key, fingerprint, body: json },
    update: { fingerprint, body: json },
  });
}
