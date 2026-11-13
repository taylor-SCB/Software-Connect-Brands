"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { answerProofs } from "@/lib/proofs";

// The customer's answers on /pf/<token> (the apparel pack, Nov 12, 2026).
// No login: the token in the link is the only key, as with signing a
// contract. Every write is guarded in the library (only the version on
// show, still waiting, on this quote, while the workspace is active), so a
// stale tab or a double tap can't answer a proof that changed.
const schema = z.object({
  token: z.string().trim().min(10).max(100),
  name: z.string().max(200),
  confirmed: z.boolean(),
  approve: z.array(z.string().min(1).max(60)).max(100),
  changes: z.array(z.object({ versionId: z.string().min(1).max(60), note: z.string().max(2000) })).max(100),
});

export async function answerProofsAction(input: z.input<typeof schema>): Promise<{ ok: true } | { error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Reload the page and try again." };
  const { token, name, confirmed, approve, changes } = parsed.data;
  if (!approve.length && !changes.length) return { error: "Pick Approve or Ask for changes on a proof first." };
  if (approve.length && !confirmed) return { error: "Tick the box to say you've checked the spelling, colors and placement." };
  let quoteId: string | undefined;
  let error: string | null = null;
  if (approve.length) {
    const result = await answerProofs({ token, versionIds: approve, decision: "approve", name });
    quoteId = result.quoteId ?? quoteId;
    if ("error" in result) error = result.error;
  }
  for (const change of changes) {
    if (error) break;
    const result = await answerProofs({ token, versionIds: [change.versionId], decision: "changes", name, note: change.note });
    quoteId = result.quoteId ?? quoteId;
    if ("error" in result) error = result.error;
  }
  revalidatePath(`/pf/${token}`);
  if (quoteId) revalidatePath(`/dashboard/quotes/${quoteId}`);
  return error ? { error } : { ok: true };
}
