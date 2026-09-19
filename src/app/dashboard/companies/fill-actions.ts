"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { enrichCompanies, loadCompaniesForEnrichment, needsFillWhere, untaggedWhere } from "@/lib/enrich-companies";
import { FILL_BATCH_SIZE, type EnrichCounts } from "@/lib/enrich";
import type { Prisma } from "@/generated/prisma/client";

// "Fill in missing" on the Companies list: for companies already in the
// workspace (created bare by the Contract Coordinator, a contact form or an
// earlier import), tag the untagged and copy a phone or website up from
// their people. The browser drives it in batches, like Import CSV.

// Past this a single sitting is not the tool; the dialog says so.
const FILL_CAP = 50_000;

export type CompanyFillPlan = {
  ids: string[];
  counts: { untagged: number; noPhone: number; noWebsite: number };
  capped: boolean;
};

export async function planCompanyFill(): Promise<CompanyFillPlan> {
  const { organizationId } = await requireSession();
  const where: Prisma.CompanyWhereInput = { organizationId, ...needsFillWhere };
  const [rows, untagged, noPhone, noWebsite] = await Promise.all([
    prisma.company.findMany({ where, select: { id: true }, orderBy: { createdAt: "asc" }, take: FILL_CAP + 1 }),
    prisma.company.count({ where: { organizationId, ...untaggedWhere } }),
    prisma.company.count({ where: { organizationId, phone: null } }),
    prisma.company.count({ where: { organizationId, website: null } }),
  ]);
  const capped = rows.length > FILL_CAP;
  return { ids: rows.slice(0, FILL_CAP).map((row) => row.id), counts: { untagged, noPhone, noWebsite }, capped };
}

const batchSchema = z.array(z.string().trim().min(1).max(64)).min(1).max(FILL_BATCH_SIZE);

export async function fillCompaniesBatch(input: unknown): Promise<EnrichCounts | { error: string }> {
  const { organizationId } = await requireSession();
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { error: "That batch couldn't be read. Refresh and try again." };
  const counts = await enrichCompanies(organizationId, await loadCompaniesForEnrichment(organizationId, parsed.data));
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/contacts");
  return counts;
}
