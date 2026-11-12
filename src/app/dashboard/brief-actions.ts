"use server";

import { z } from "zod";
import { requireSession } from "@/lib/session";
import { aiConfigured } from "@/lib/ai";
import { loadBrief, storedBrief, storedOpener, writeBrief, writeOpener, type BriefWriting, type Opener } from "@/lib/brief";

// Brief me and the drafted opener (AI release A, Nov 12, 2026). Reading a
// brief never calls Claude: it hands back the facts and, when one is kept
// for these facts, the written lines. Writing is a tap (opening the card
// with AI on, or Rewrite), and nothing here saves anything but the kept
// words themselves.

const idSchema = z.string().trim().min(1).max(100);

export type BriefView = {
  name: string;
  lines: { key: string; text: string }[];
  writing: BriefWriting | null;
  ai: boolean;
};

export async function openBrief(contactId: string): Promise<BriefView | { error: string }> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contactId);
  if (!id.success) return { error: "That person isn't valid" };
  const brief = await loadBrief(organizationId, id.data);
  if (!brief) return { error: "That person is no longer here" };
  const ai = aiConfigured();
  return { name: brief.name, lines: brief.lines, writing: ai ? await storedBrief(organizationId, brief) : null, ai };
}

export async function writeBriefFor(contactId: string, force = false): Promise<{ writing: BriefWriting } | { error: string }> {
  const { organizationId, userId } = await requireSession();
  const id = idSchema.safeParse(contactId);
  if (!id.success) return { error: "That person isn't valid" };
  if (!aiConfigured()) return { error: "AI isn't switched on for this site yet." };
  const brief = await loadBrief(organizationId, id.data);
  if (!brief) return { error: "That person is no longer here" };
  if (!force) {
    const kept = await storedBrief(organizationId, brief);
    if (kept) return { writing: kept };
  }
  const result = await writeBrief(organizationId, userId, brief);
  return "error" in result ? result : { writing: result };
}

export async function draftOpener(contactId: string, reason: string | null, force = false): Promise<{ opener: Opener } | { error: string }> {
  const { organizationId, userId } = await requireSession();
  const id = idSchema.safeParse(contactId);
  if (!id.success) return { error: "That person isn't valid" };
  if (!aiConfigured()) return { error: "AI isn't switched on for this site yet." };
  const brief = await loadBrief(organizationId, id.data);
  if (!brief) return { error: "That person is no longer here" };
  if (!force) {
    const kept = await storedOpener(organizationId, brief);
    if (kept) return { opener: kept };
  }
  const why = typeof reason === "string" ? reason.trim().slice(0, 200) || null : null;
  const result = await writeOpener(organizationId, userId, brief, why);
  return "error" in result ? result : { opener: result };
}
