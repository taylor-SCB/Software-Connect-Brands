"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { mergeCompanies, mergeContacts, MAX_MERGE } from "@/lib/merge-records";

const mergeSchema = z.object({
  keepId: z.string().trim().min(1),
  ids: z.array(z.string().trim().min(1)).min(2, "Pick at least two").max(MAX_MERGE, `Merge up to ${MAX_MERGE} at a time`),
});

export type MergeResult = { error?: string; keptId?: string; merged?: number };

export async function mergeContactsAction(input: { keepId: string; ids: string[] }): Promise<MergeResult> {
  const { organizationId } = await requireSession();
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick the contacts to merge" };
  if (!parsed.data.ids.includes(parsed.data.keepId)) return { error: "Pick which one to keep" };
  const result = await mergeContacts(organizationId, parsed.data.keepId, parsed.data.ids);
  if ("error" in result) return { error: result.error };
  revalidatePath("/dashboard", "layout");
  return result;
}

export async function mergeCompaniesAction(input: { keepId: string; ids: string[] }): Promise<MergeResult> {
  const { organizationId } = await requireSession();
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick the companies to merge" };
  if (!parsed.data.ids.includes(parsed.data.keepId)) return { error: "Pick which one to keep" };
  const result = await mergeCompanies(organizationId, parsed.data.keepId, parsed.data.ids);
  if ("error" in result) return { error: result.error };
  revalidatePath("/dashboard", "layout");
  return result;
}
