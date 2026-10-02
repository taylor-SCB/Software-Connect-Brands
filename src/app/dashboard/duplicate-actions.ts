"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { dismissPair } from "@/lib/duplicates";

const schema = z.object({
  kind: z.enum(["contact", "company"]),
  a: z.string().trim().min(1),
  b: z.string().trim().min(1),
});

// "Not the same person" on a Duplicate radar suggestion: the pair is
// remembered and never offered again, for anyone in the workspace.
export async function dismissDuplicate(input: { kind: "contact" | "company"; a: string; b: string }): Promise<{ error?: string }> {
  const { organizationId, userId } = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success || parsed.data.a === parsed.data.b) return { error: "That pair isn't valid" };
  const { kind, a, b } = parsed.data;
  // Both records must be this workspace's.
  const count =
    kind === "contact"
      ? await prisma.contact.count({ where: { organizationId, id: { in: [a, b] } } })
      : await prisma.company.count({ where: { organizationId, id: { in: [a, b] } } });
  if (count !== 2) return { error: "One of those records no longer exists" };
  await dismissPair(organizationId, userId, kind, a, b);
  revalidatePath(kind === "contact" ? "/dashboard/contacts" : "/dashboard/companies", "layout");
  return {};
}
