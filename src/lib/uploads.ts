import { prisma } from "@/lib/prisma";
import { publicToken } from "@/lib/tokens";
import type { UploadKind } from "@/generated/prisma/enums";

// Shared rules for anything uploaded into the app: logos and avatars
// (images, shown on documents customers open) and compliance or marketing
// files (documents, only ever streamed back to the workspace).
//
// Everything is stored in Postgres, like uploaded ratesheets. Fine at this
// scale; object storage is the answer when files get bigger.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

// Kinds whose files are served to anyone holding the link: they are
// rendered on quotes and contracts the customer opens without a login.
export const PUBLIC_IMAGE_KINDS: readonly UploadKind[] = [
  "ORG_LOGO",
  "USER_AVATAR",
  "COMPANY_LOGO",
  "CONTACT_IMAGE",
];

// Raster formats only. SVG can carry scripts and would need its own
// sandboxing to serve; a small business's logo is a PNG or a JPEG.
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isAllowedImage(file: File) {
  return IMAGE_TYPES.has(file.type);
}

// Where the browser fetches an upload from.
export function fileUrl(token: string) {
  return `/files/${token}`;
}

export function isFileUrl(url: string | null | undefined) {
  return Boolean(url && url.startsWith("/files/"));
}

// Reads the whole file and returns what the Upload row needs. The caller
// has already checked size and type so the message can name the field.
export async function readUpload(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    fileName: file.name.trim().slice(0, 200) || "upload",
    mimeType: file.type || "application/octet-stream",
    sizeBytes: bytes.byteLength,
    data: bytes,
    publicToken: publicToken(),
  };
}

// Stores an image for one record and removes the one it replaces. Returns
// the new URL to write on the record. One image per record per kind, so
// a replaced logo doesn't linger in the table.
export async function replaceImage(input: {
  organizationId: string;
  kind: UploadKind;
  file: File;
  userId?: string;
  companyId?: string;
  contactId?: string;
}): Promise<string> {
  const stored = await readUpload(input.file);
  const owner = {
    userId: input.userId ?? null,
    companyId: input.companyId ?? null,
    contactId: input.contactId ?? null,
  };

  const [, created] = await prisma.$transaction([
    prisma.upload.deleteMany({
      where: { organizationId: input.organizationId, kind: input.kind, ...owner },
    }),
    prisma.upload.create({
      data: {
        organizationId: input.organizationId,
        kind: input.kind,
        name: stored.fileName,
        ...stored,
        ...owner,
      },
      select: { publicToken: true },
    }),
  ]);

  return fileUrl(created.publicToken);
}

// Drops the stored image behind a record when its picture is removed or
// swapped for a plain URL. A URL that wasn't ours is left alone.
export async function removeImage(input: {
  organizationId: string;
  kind: UploadKind;
  userId?: string;
  companyId?: string;
  contactId?: string;
}) {
  await prisma.upload.deleteMany({
    where: {
      organizationId: input.organizationId,
      kind: input.kind,
      userId: input.userId ?? null,
      companyId: input.companyId ?? null,
      contactId: input.contactId ?? null,
    },
  });
}

// Validation shared by every image form. Returns a message to show, or
// null when the file is fine. A missing file is not an error — the form
// simply keeps whatever was there.
export function imageProblem(file: FormDataEntryValue | null): string | null {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!isAllowedImage(file)) return "Use a PNG, JPEG, GIF or WebP image";
  if (file.size > MAX_IMAGE_BYTES) return "That image is over 2 MB. Resize it and try again.";
  return null;
}

export function hasFile(file: FormDataEntryValue | null): file is File {
  return file instanceof File && file.size > 0;
}
