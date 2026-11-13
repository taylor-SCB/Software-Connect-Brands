"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { aiConfigured } from "@/lib/ai";
import { resolvePhotoActor } from "@/lib/job-photos";
import { jpegFromBase64 } from "@/lib/job-ai";
import {
  billSchema,
  makeReceiptBill,
  matchStore,
  MAX_RECEIPT_JPEG_BYTES,
  readReceiptPhoto,
  receiptsFolder,
  removeReceiptPhoto,
  storeReceiptPhoto,
  type ReceiptItem,
  type ReceiptRead,
} from "@/lib/receipts";

// C5 "Photograph the receipt" (Release C, Nov 12, 2026): Add receipt on the
// job's Money tab, and Send a receipt on the crew photo link (Taylor's
// call 2), which waits for an Owner or Admin. The AI only reads; the
// person checks every figure and presses Save or Approve.

const idSchema = z.string().trim().min(1).max(100);

function revalidateJob(projectId: string) {
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/dashboard/projects/${projectId}/money`);
  revalidatePath(`/dashboard/projects/${projectId}/files`);
  revalidatePath("/dashboard/projects");
}

async function staffJob(projectId: unknown) {
  const session = await requireSession();
  const id = idSchema.safeParse(projectId);
  if (!id.success) return null;
  const project = await prisma.project.findFirst({
    where: { id: id.data, organizationId: session.organizationId },
    select: { id: true },
  });
  return project ? { ...session, projectId: project.id } : null;
}

function cleanItems(raw: unknown): ReceiptItem[] {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 40)
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const { name, quantity, amountCents } = item as Record<string, unknown>;
      if (typeof name !== "string" || !name.trim()) return [];
      return [
        {
          name: name.trim().slice(0, 120),
          quantity: typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0 ? Math.min(100_000, quantity) : 1,
          amountCents: typeof amountCents === "number" && Number.isFinite(amountCents) ? Math.round(Math.max(-100_000_000, Math.min(100_000_000, amountCents))) : 0,
        },
      ];
    });
}

/* ---------------------------------- In the app ---------------------------------- */

// Reads a receipt photo (nothing saved). The store is matched against the
// workspace's companies so the form can say whether it's new.
export async function readReceipt(
  projectId: string,
  base64: string,
): Promise<{ read: ReceiptRead; match: { id: string; name: string } | null } | { error: string }> {
  const job = await staffJob(projectId);
  if (!job) return { error: "Project not found" };
  if (!jpegFromBase64(base64, MAX_RECEIPT_JPEG_BYTES)) return { error: "That photo couldn't be read. Take it again." };
  const result = await readReceiptPhoto(job.organizationId, job.userId, base64);
  if ("error" in result) return result;
  return { read: result.read, match: await matchStore(job.organizationId, result.read.storeName) };
}

export type SaveReceiptInput = {
  scopeId: string;
  storeName: string;
  purchasedOn: string;
  totalCents: number;
  taxCents: number;
  items: ReceiptItem[];
  aiRead: boolean;
};

// Save: the photo goes into the job's Receipts folder and the paid bill is
// made on the scope picked.
export async function saveReceipt(projectId: string, input: SaveReceiptInput, base64: string): Promise<{ error?: string; success?: string }> {
  const job = await staffJob(projectId);
  if (!job) return { error: "Project not found" };
  const bill = billSchema.safeParse(input);
  if (!bill.success) return { error: bill.error.issues[0]?.message ?? "Check the receipt" };
  if (bill.data.taxCents > bill.data.totalCents) return { error: "The tax can't be more than the total." };
  const scope = await prisma.projectScope.findFirst({ where: { id: bill.data.scopeId, projectId: job.projectId }, select: { id: true } });
  if (!scope) return { error: "That scope is gone. Reload the page." };

  const folderId = await receiptsFolder(job.organizationId, job.projectId, job.userId);
  const photo = await storeReceiptPhoto({
    organizationId: job.organizationId,
    projectId: job.projectId,
    base64,
    storeName: bill.data.storeName,
    uploadedById: job.userId,
    folderId,
  });
  if ("error" in photo) return photo;
  const items = cleanItems(input.items);
  const receipt = await prisma.jobReceipt.create({
    data: {
      organizationId: job.organizationId,
      projectId: job.projectId,
      uploadId: photo.id,
      storeName: bill.data.storeName,
      totalCents: bill.data.totalCents,
      taxCents: bill.data.taxCents,
      items,
      aiRead: Boolean(input.aiRead),
      createdById: job.userId,
    },
    select: { id: true },
  });
  const made = await makeReceiptBill({
    organizationId: job.organizationId,
    userId: job.userId,
    projectId: job.projectId,
    receiptId: receipt.id,
    bill: bill.data,
    items,
  });
  if ("error" in made) {
    await prisma.jobReceipt.delete({ where: { id: receipt.id } }).catch(() => {});
    await removeReceiptPhoto(job.organizationId, photo.id);
    return { error: made.error };
  }
  revalidateJob(job.projectId);
  revalidatePath("/dashboard/contracts");
  return { success: `Saved as a paid bill from ${bill.data.storeName}. It counts in Spent.` };
}

/* -------------------------------- Approve / decline ------------------------------- */

async function adminReceipt(receiptId: unknown) {
  const session = await requireSession();
  if (session.role !== "OWNER" && session.role !== "ADMIN") return { error: "Only an owner or admin can approve receipts." } as const;
  const id = idSchema.safeParse(receiptId);
  if (!id.success) return { error: "That receipt is gone. Reload the page." } as const;
  const receipt = await prisma.jobReceipt.findFirst({
    where: { id: id.data, organizationId: session.organizationId },
    select: { id: true, projectId: true, status: true, uploadId: true, items: true, contractId: true },
  });
  if (!receipt) return { error: "That receipt is gone. Reload the page." } as const;
  return { session, receipt } as const;
}

export async function approveReceipt(
  receiptId: string,
  input: Omit<SaveReceiptInput, "items" | "aiRead">,
): Promise<{ error?: string; success?: string }> {
  const found = await adminReceipt(receiptId);
  if ("error" in found) return { error: found.error };
  const { session, receipt } = found;
  if (receipt.status !== "PENDING" || receipt.contractId) return { error: "That receipt is already approved." };
  const bill = billSchema.safeParse(input);
  if (!bill.success) return { error: bill.error.issues[0]?.message ?? "Check the receipt" };
  const made = await makeReceiptBill({
    organizationId: session.organizationId,
    userId: session.userId,
    projectId: receipt.projectId,
    receiptId: receipt.id,
    bill: bill.data,
    items: cleanItems(receipt.items),
  });
  if ("error" in made) return { error: made.error };
  // Now it belongs to the job: its photo joins the Receipts folder.
  if (receipt.uploadId) {
    const folderId = await receiptsFolder(session.organizationId, receipt.projectId, session.userId);
    await prisma.upload.updateMany({
      where: { id: receipt.uploadId, organizationId: session.organizationId },
      data: { projectId: receipt.projectId, photoFolderId: folderId, name: `Receipt · ${bill.data.storeName}`.slice(0, 160) },
    });
  }
  revalidateJob(receipt.projectId);
  revalidatePath("/dashboard/contracts");
  return { success: `Approved. It's a paid bill from ${bill.data.storeName} and counts in Spent.` };
}

// Declined: the receipt and its photo go. It never counted anywhere.
export async function declineReceipt(receiptId: string): Promise<{ error?: string; success?: string }> {
  const found = await adminReceipt(receiptId);
  if ("error" in found) return { error: found.error };
  const { session, receipt } = found;
  if (receipt.status !== "PENDING" || receipt.contractId) return { error: "An approved receipt is a bill now; delete that instead." };
  const removed = await prisma.jobReceipt.deleteMany({ where: { id: receipt.id, organizationId: session.organizationId, status: "PENDING", contractId: null } });
  if (removed.count === 0) return { error: "That receipt was just approved." };
  await removeReceiptPhoto(session.organizationId, receipt.uploadId);
  revalidateJob(receipt.projectId);
  return { success: "Declined and removed." };
}

/* ---------------------------------- Crew link ---------------------------------- */

// "Send a receipt" on the crew photo link. Stored and read, then waits for
// the office. Without AI it waits unread, and the office types it in.
export async function sendCrewReceipt(token: string, name: string, base64: string): Promise<{ error?: string; success?: string }> {
  const actor = await resolvePhotoActor({ token: String(token ?? "") });
  if (!actor || actor.kind !== "crew") return { error: "This link has been turned off. Ask the office for a new one." };
  const who = String(name ?? "").trim().slice(0, 80);
  if (!who) return { error: "Put your name in first so the office knows who sent it." };
  if (!jpegFromBase64(base64, MAX_RECEIPT_JPEG_BYTES)) return { error: "That photo couldn't be read. Take it again." };
  // A link can't flood the office: 30 waiting receipts a job at most.
  const waiting = await prisma.jobReceipt.count({ where: { projectId: actor.projectId, status: "PENDING" } });
  if (waiting >= 30) return { error: "The office has 30 receipts from this job to look at already. Ask them to catch up first." };

  const read = aiConfigured() ? await readReceiptPhoto(actor.organizationId, null, base64) : null;
  const got = read && "read" in read ? read.read : null;
  const photo = await storeReceiptPhoto({
    organizationId: actor.organizationId,
    projectId: null,
    base64,
    storeName: got?.storeName ?? "",
    uploadedByName: who,
    photoLinkId: actor.linkId,
  });
  if ("error" in photo) return photo;
  await prisma.jobReceipt.create({
    data: {
      organizationId: actor.organizationId,
      projectId: actor.projectId,
      uploadId: photo.id,
      storeName: got?.storeName ?? "",
      purchasedOn: got?.purchasedOn ? new Date(`${got.purchasedOn}T00:00:00Z`) : null,
      totalCents: got?.totalCents ?? 0,
      taxCents: got?.taxCents ?? 0,
      items: got?.items ?? [],
      aiRead: Boolean(got),
      sentByName: who,
      photoLinkId: actor.linkId,
    },
  });
  await prisma.projectPhotoLink.update({ where: { id: actor.linkId }, data: { lastUsedAt: new Date() } });
  revalidateJob(actor.projectId);
  return { success: "Sent. The office will check it and add it to the job." };
}
