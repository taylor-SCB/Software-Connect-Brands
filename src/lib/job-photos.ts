import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicToken } from "@/lib/tokens";
import { PHOTO_CATEGORIES } from "@/lib/constants";
import {
  MAX_MEDIA_BYTES,
  isMediaType,
  mediaKey,
  readUploadTicket,
  statObject,
  storageDriver,
  uploadTicket,
  type StorageDriver,
} from "@/lib/storage";

// Photos and videos on a job, sent from the Files tab or by an installer
// through the job's crew photo link (Oct 17, 2026).

export type StartedUpload =
  | { error: string }
  | { driver: StorageDriver; key: string; ticket: string };

export type FileMeta = { name: string; type: string; size: number };

const metaSchema = z.object({
  name: z.string().trim().min(1).max(300),
  type: z.string().max(100),
  size: z.number().int().positive(),
});

// Step one: check the file and sign a ticket for one path in the store.
export function startMediaUpload(
  owner: { organizationId: string; projectId: string; photoLinkId?: string; userId?: string },
  meta: FileMeta,
): StartedUpload {
  const driver = storageDriver();
  if (!driver) {
    return { error: "Photo storage isn't switched on for this site yet. Ask the office to set up Vercel Blob." };
  }
  const parsed = metaSchema.safeParse(meta);
  if (!parsed.success) return { error: "That file couldn't be read. Try choosing it again." };
  const { name, type, size } = parsed.data;
  if (!isMediaType(type)) return { error: `${name} isn't a photo or video.` };
  if (size > MAX_MEDIA_BYTES) return { error: `${name} is over 1 GB. Trim the video and try again.` };

  const key = mediaKey(owner.organizationId, owner.projectId, name);
  return { driver, key, ticket: uploadTicket({ ...owner, key, type, maxBytes: size }) };
}

const finishSchema = z.object({
  category: z.enum(PHOTO_CATEGORIES),
  fileName: z.string().trim().min(1).max(300),
  uploadedByName: z.string().trim().max(80).optional(),
});

// Step two: the file is in the store. Read back what arrived and write
// the row. The ticket says which job and who, so nothing the browser
// sends now can move the file to another workspace.
export async function finishMediaUpload(
  rawTicket: string,
  input: { category: string; fileName: string; uploadedByName?: string },
): Promise<{ error?: string; ok?: true }> {
  const ticket = readUploadTicket(rawTicket);
  if (!ticket) return { error: "This upload took too long and expired. Send it again." };
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick what these photos are first." };

  const driver = storageDriver();
  if (!driver) return { error: "Photo storage isn't switched on." };
  const stored = await statObject(driver, ticket.key);
  if (!stored) return { error: "The file didn't arrive. Send it again." };

  // Already recorded: a retry after a dropped answer, not a second photo.
  const existing = await prisma.upload.findFirst({ where: { storageKey: ticket.key }, select: { id: true } });
  if (existing) return { ok: true };

  const fileName = parsed.data.fileName.slice(0, 200);
  await prisma.upload.create({
    data: {
      organizationId: ticket.organizationId,
      projectId: ticket.projectId,
      kind: "PROJECT_FILE",
      category: parsed.data.category,
      name: fileName.replace(/\.[^.]+$/, "").slice(0, 160) || fileName,
      fileName,
      mimeType: ticket.type,
      sizeBytes: stored.size,
      storageKey: ticket.key,
      storageDriver: driver,
      publicToken: publicToken(),
      photoLinkId: ticket.photoLinkId ?? null,
      uploadedById: ticket.userId ?? null,
      uploadedByName: parsed.data.uploadedByName || null,
    },
  });
  return { ok: true };
}

// A crew or view link that still works: switched on, and its workspace
// not paused. Anything else and the page says the link is off.
export async function findPhotoLink(token: string) {
  if (!token || token.length < 20) return null;
  const link = await prisma.projectPhotoLink.findUnique({
    where: { token },
    select: {
      id: true,
      kind: true,
      label: true,
      active: true,
      organizationId: true,
      project: { select: { id: true, number: true, name: true, customerName: true } },
      organization: { select: { name: true, logoUrl: true, primaryColor: true, timeZone: true, status: true } },
    },
  });
  if (!link) return null;
  return { ...link, usable: link.active && link.organization.status === "ACTIVE" };
}

export function isMediaMime(mimeType: string) {
  return mimeType.startsWith("image/") || mimeType.startsWith("video/");
}
