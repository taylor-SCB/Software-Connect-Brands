"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import {
  attachContractProofs,
  copyEarlierProof,
  detachContractProofs,
  discardDraft,
  earlierProofs,
  finishProofVersion,
  markProofApproved,
  proofsToSend,
  nextProofLabel,
  sendProofs,
  setLineProof,
  startProofVersion,
  type FinishProofInput,
} from "@/lib/proofs";

// The apparel pack (Nov 12, 2026): proofs on a quote and on a contract.
// Anyone signed in, like the quote editor; each is scoped to the workspace
// in the library, which also re-checks the apparel switch for anything new.

const id = z.string().trim().min(1).max(60);

function refreshQuote(quoteId: string | null | undefined) {
  if (quoteId) revalidatePath(`/dashboard/quotes/${quoteId}`);
}

export async function startProofUpload(quoteId: string, type: string) {
  const { organizationId, userId } = await requireSession();
  const parsed = z.object({ quoteId: id, type: z.string().max(40) }).safeParse({ quoteId, type });
  if (!parsed.success) return { error: "That proof couldn't be drawn." };
  return startProofVersion(organizationId, userId, parsed.data);
}

// Ids in a panel may arrive empty (no print location left to pick): the
// library refuses those in words and deletes the uploaded files.
const panelSchema = z.object({
  locationOptionId: z.string().trim().max(60),
  artworkId: z.string().trim().max(60),
  baseKind: z.enum(["picture", "plain-front", "plain-back"]),
  baseImageId: id.nullable().optional(),
  baseColor: z.string().max(10).nullable().optional(),
  placement: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});

const finishSchema = z.object({
  quoteId: id,
  proofId: id.nullable(),
  baseVersionId: id.nullable(),
  baseToken: z.string().max(100).nullable().optional(),
  expectedNumber: z.number().int().min(1).max(10_000).nullable().optional(),
  productId: id,
  colorOptionId: id.nullable(),
  lineIds: z.array(id).min(1).max(200),
  panels: z.array(panelSchema).min(1).max(4),
  tickets: z.array(z.string().max(4000)).length(3),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});

export async function finishProofUpload(input: z.input<typeof finishSchema>) {
  const { organizationId, userId } = await requireSession();
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { error: "That proof couldn't be saved. Try again." };
  const result = await finishProofVersion(organizationId, userId, parsed.data as FinishProofInput);
  if ("ok" in result) refreshQuote(parsed.data.quoteId);
  return result;
}

export async function nextProofLabelAction(quoteId: string, proofId: string | null) {
  const { organizationId } = await requireSession();
  if (!id.safeParse(quoteId).success || (proofId !== null && !id.safeParse(proofId).success)) return null;
  return nextProofLabel(organizationId, quoteId, proofId);
}

export async function discardProofDraft(versionId: string) {
  const { organizationId } = await requireSession();
  if (!id.safeParse(versionId).success) return { error: "Reload the page." };
  const result = await discardDraft(organizationId, versionId);
  if ("ok" in result) refreshQuote(result.quoteId);
  return result;
}

export async function setLineProofAction(lineId: string, proofId: string | null) {
  const { organizationId } = await requireSession();
  if (!id.safeParse(lineId).success || (proofId !== null && !id.safeParse(proofId).success)) return { error: "Reload the page." };
  const result = await setLineProof(organizationId, lineId, proofId);
  if ("ok" in result) refreshQuote(result.quoteId);
  return result;
}

export async function earlierProofsAction(quoteId: string, productId: string, colorOptionId: string | null) {
  const { organizationId } = await requireSession();
  const parsed = z.object({ quoteId: id, productId: id, colorOptionId: id.nullable() }).safeParse({ quoteId, productId, colorOptionId });
  if (!parsed.success) return [];
  return earlierProofs(organizationId, parsed.data.quoteId, parsed.data.productId, parsed.data.colorOptionId);
}

export async function copyEarlierProofAction(quoteId: string, sourceVersionId: string, lineIds: string[]) {
  const { organizationId, userId } = await requireSession();
  const parsed = z
    .object({ quoteId: id, sourceVersionId: id, lineIds: z.array(id).min(1).max(200) })
    .safeParse({ quoteId, sourceVersionId, lineIds });
  if (!parsed.success) return { error: "Reload the page." };
  const result = await copyEarlierProof(organizationId, userId, parsed.data);
  if ("ok" in result) refreshQuote(parsed.data.quoteId);
  return result;
}

export async function prepareProofSend(quoteId: string) {
  const { organizationId, userId } = await requireSession();
  if (!id.safeParse(quoteId).success) return { error: "Reload the page." };
  return proofsToSend(organizationId, userId, quoteId);
}

export async function sendProofsAction(quoteId: string) {
  const { organizationId } = await requireSession();
  if (!id.safeParse(quoteId).success) return { error: "Reload the page." };
  const result = await sendProofs(organizationId, quoteId);
  if ("ok" in result) refreshQuote(quoteId);
  return result;
}

export async function markProofApprovedAction(versionId: string, name: string) {
  const { organizationId, userId } = await requireSession();
  if (!id.safeParse(versionId).success) return { error: "Reload the page." };
  const result = await markProofApproved(organizationId, userId, versionId, name);
  if ("ok" in result) refreshQuote(result.quoteId);
  return result;
}

export async function setContractProofsAction(contractId: string, versionIds: string[] | null) {
  const { organizationId } = await requireSession();
  const parsed = z.object({ contractId: id, versionIds: z.array(id).max(100).nullable() }).safeParse({ contractId, versionIds });
  if (!parsed.success) return { error: "Reload the page." };
  const result =
    parsed.data.versionIds && parsed.data.versionIds.length === 0
      ? await detachContractProofs(organizationId, parsed.data.contractId)
      : await attachContractProofs(organizationId, parsed.data.contractId, parsed.data.versionIds ?? undefined);
  if ("ok" in result) revalidatePath(`/dashboard/contracts/${parsed.data.contractId}`);
  return result;
}
