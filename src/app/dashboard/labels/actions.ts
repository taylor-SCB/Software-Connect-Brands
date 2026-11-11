"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/session";
import { mergeLabel, renameLabel, setLabelRetired, type LabelResult } from "@/lib/crm-labels";

// The CRM Labels screen's changes. Owners and Admins only (Taylor, Nov 10,
// 2026, as on Labels & Units); a Member sees the screen and its counts.

const kind = z.enum(["industry", "type", "lead", "title"]);
const value = z.string().max(160);
const NOT_ALLOWED = "Only an Owner or Admin can change labels.";

function refresh() {
  revalidatePath("/dashboard/labels");
  revalidatePath("/dashboard/contacts", "layout");
  revalidatePath("/dashboard/companies", "layout");
  revalidatePath("/dashboard/deals");
}

export async function renameLabelAction(input: { kind: string; from: string; to: string }): Promise<LabelResult> {
  const session = await requireAdminSession();
  if (!session.allowed) return { error: NOT_ALLOWED };
  const parsed = z.object({ kind, from: value, to: value }).safeParse(input);
  if (!parsed.success) return { error: "Reload the page and try again." };
  const result = await renameLabel(session.organizationId, parsed.data.kind, parsed.data.from, parsed.data.to);
  if (!("error" in result)) refresh();
  return result;
}

export async function mergeLabelAction(input: { kind: string; from: string; into: string }): Promise<LabelResult> {
  const session = await requireAdminSession();
  if (!session.allowed) return { error: NOT_ALLOWED };
  const parsed = z.object({ kind, from: value, into: value }).safeParse(input);
  if (!parsed.success) return { error: "Reload the page and try again." };
  const result = await mergeLabel(session.organizationId, parsed.data.kind, parsed.data.from, parsed.data.into);
  if (!("error" in result)) refresh();
  return result;
}

export async function retireLabelAction(input: { kind: string; name: string; retired: boolean }): Promise<LabelResult> {
  const session = await requireAdminSession();
  if (!session.allowed) return { error: NOT_ALLOWED };
  const parsed = z.object({ kind, name: value, retired: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: "Reload the page and try again." };
  const result = await setLabelRetired(session.organizationId, parsed.data.kind, parsed.data.name, parsed.data.retired);
  if (!("error" in result)) refresh();
  return result;
}
