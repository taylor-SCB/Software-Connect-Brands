import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { publicToken } from "@/lib/tokens";
import {
  deleteObject,
  localPath,
  productImageBase,
  readUploadTicket,
  statObject,
  storageDriver,
  streamObject,
  uploadTicket,
  type StorageDriver,
  type UploadTicket,
} from "@/lib/storage";

// Release 3b (Nov 6, 2026): up to six pictures per product, in the same
// private Blob store as job photos. The browser makes three copies of each
// (src/lib/image-resize.ts) and sends them straight to the store with
// tickets signed here; the finish step reads them back and writes the row.
// The lowest position is the main picture; Remove closes the gap, so the
// positions are always 0..n-1. A picture a sent quote line went out with is
// kept (position null, removedAt set) until no line holds it.

export const MAX_PRODUCT_PICTURES = 6;
export const PICTURE_MAX_BYTES = { display: 2 * 1024 * 1024, thumb: 300 * 1024, doc: 60 * 1024 } as const;
export const PICTURE_TYPES = ["image/webp", "image/jpeg"] as const;

export type PictureRole = keyof typeof PICTURE_MAX_BYTES;
export type PictureView = { id: string; token: string; colorOptionId: string | null; position: number };

const STORAGE_OFF = "Picture storage isn't switched on for this site yet.";

/* --------------------------------- Reads --------------------------------- */

// Every picture still on these products, main first. One query.
export async function picturesFor(organizationId: string, productIds: string[]) {
  const out = new Map<string, PictureView[]>();
  if (!productIds.length) return out;
  const rows = await prisma.productImage.findMany({
    where: { organizationId, productId: { in: productIds }, position: { not: null } },
    orderBy: [{ productId: "asc" }, { position: "asc" }],
    select: { id: true, productId: true, publicToken: true, colorOptionId: true, position: true },
  });
  for (const row of rows) {
    const list = out.get(row.productId!) ?? [];
    list.push({ id: row.id, token: row.publicToken, colorOptionId: row.colorOptionId, position: row.position! });
    out.set(row.productId!, list);
  }
  return out;
}

// The main picture's token for each product: its lowest position.
export async function mainPicturesFor(organizationId: string, productIds: string[]) {
  const out = new Map<string, string>();
  if (!productIds.length) return out;
  const rows = await prisma.$queryRaw<{ productId: string; publicToken: string }[]>`
    SELECT DISTINCT ON ("productId") "productId", "publicToken"
    FROM "ProductImage"
    WHERE "organizationId" = ${organizationId}
      AND "productId" IN (${Prisma.join(productIds)})
      AND position IS NOT NULL
    ORDER BY "productId", position`;
  for (const row of rows) out.set(row.productId, row.publicToken);
  return out;
}

// The picture a quote line shows. A line holds the one it went out with;
// a draft's line shows the product's picture live — the one tagged with a
// Color the line picked, else the main one — so a picture added after the
// line was written still shows, and one removed from the product goes.
export function linePicture(
  line: {
    productId: string | null;
    optionIds: string[];
    image: { id: string; token: string; removed: boolean } | null;
  },
  pictures: Map<string, PictureView[]>,
  draft: boolean,
): { id: string; token: string } | null {
  if (line.image && (!draft || !line.image.removed)) return { id: line.image.id, token: line.image.token };
  if (!draft) return null;
  return livePicture(line.productId, line.optionIds, pictures);
}

export function livePicture(productId: string | null, optionIds: string[], pictures: Map<string, PictureView[]>) {
  if (!productId) return null;
  const list = pictures.get(productId) ?? [];
  const picked = new Set(optionIds);
  const colored = list.find((picture) => picture.colorOptionId && picked.has(picture.colorOptionId));
  const chosen = colored ?? list[0] ?? null;
  return chosen ? { id: chosen.id, token: chosen.token } : null;
}

// When a quote leaves Draft its lines keep the picture they show now. One
// statement: the Color-tagged picture where a line picked that Color,
// else the main one, for every line that holds none or one since removed.
export async function freezeQuotePictures(quoteId: string) {
  await prisma.$executeRaw`
    UPDATE "QuoteLineItem" li
    SET "imageId" = pick.id
    FROM (
      SELECT DISTINCT ON (l.id) l.id AS line, img.id
      FROM "QuoteLineItem" l
      JOIN "ProductImage" img ON img."productId" = l."productId" AND img.position IS NOT NULL
      LEFT JOIN "ProductImage" cur ON cur.id = l."imageId"
      WHERE l."quoteId" = ${quoteId}
        AND (l."imageId" IS NULL OR cur."removedAt" IS NOT NULL)
      ORDER BY l.id,
        CASE WHEN img."colorOptionId" IS NOT NULL AND l.variations @> jsonb_build_array(jsonb_build_object('optionId', img."colorOptionId")) THEN 0 ELSE 1 END,
        img.position
    ) pick
    WHERE li.id = pick.line`;
}

/* ------------------------------- Serving --------------------------------- */

export type PictureFile = { body: ReadableStream; type: string; size: number | null };

// The bytes behind /files/<token> for a product picture. Always streamed
// through the site, never a redirect to the store: the bytes behind a
// token never change, so the CDN keeps them, and nothing on a quote, its
// PDF or a partner page can point at an address that has expired.
export async function readPicture(token: string, variant: string | null): Promise<PictureFile | null> {
  const row = await prisma.productImage.findUnique({
    where: { publicToken: token },
    select: { storageKey: true, thumbKey: true, docKey: true, contentType: true },
  });
  if (!row) return null;
  const key = variant === "thumb" ? row.thumbKey : variant === "doc" ? row.docKey : row.storageKey;
  const type = variant === "doc" ? "image/jpeg" : row.contentType;
  const driver = storageDriver();
  if (driver === "local") {
    const file = localPath(key);
    const size = await stat(file).then((s) => s.size).catch(() => null);
    if (size === null) return null;
    return { body: Readable.toWeb(createReadStream(file)) as ReadableStream, type, size };
  }
  if (driver !== "vercel-blob") return null;
  const result = await streamObject(key).catch(() => null);
  if (!result?.stream) return null;
  return { body: result.stream, type, size: result.blob?.size ?? null };
}

/* -------------------------------- Upload --------------------------------- */

export type StartedPicture =
  | { error: string }
  | { driver: StorageDriver; files: { role: PictureRole; key: string; type: string; ticket: string }[]; free: number };

// Step one: the product is this workspace's and has room, then three
// tickets — display, thumb and doc — on one random base.
export async function startProductImage(
  organizationId: string,
  userId: string,
  productId: string,
  type: string,
): Promise<StartedPicture> {
  const driver = storageDriver();
  if (!driver) return { error: STORAGE_OFF };
  if (!(PICTURE_TYPES as readonly string[]).includes(type)) return { error: "That picture couldn't be read." };
  const product = await prisma.product.findFirst({ where: { id: productId, organizationId }, select: { id: true } });
  if (!product) return { error: "This product is gone. Reload the page." };
  const count = await prisma.productImage.count({ where: { productId, position: { not: null } } });
  if (count >= MAX_PRODUCT_PICTURES) return { error: `Up to ${MAX_PRODUCT_PICTURES} pictures. Remove one first.` };

  const base = productImageBase(organizationId, productId);
  const ext = type === "image/webp" ? "webp" : "jpg";
  const plan: { role: PictureRole; key: string; type: string }[] = [
    { role: "display", key: `${base}.${ext}`, type },
    { role: "thumb", key: `${base}-thumb.${ext}`, type },
    { role: "doc", key: `${base}-doc.jpg`, type: "image/jpeg" },
  ];
  return {
    driver,
    free: MAX_PRODUCT_PICTURES - count,
    files: plan.map((file) => ({
      ...file,
      ticket: uploadTicket({
        organizationId,
        purpose: "product-image",
        productId,
        role: file.role,
        key: file.key,
        type: file.type,
        maxBytes: PICTURE_MAX_BYTES[file.role],
        userId,
      }),
    })),
  };
}

function readTickets(raw: unknown[], organizationId: string, productId: string) {
  if (raw.length !== 3) return null;
  const tickets = raw.map((item) => readUploadTicket(item));
  const roles: PictureRole[] = ["display", "thumb", "doc"];
  for (let i = 0; i < 3; i += 1) {
    const ticket = tickets[i];
    if (
      !ticket ||
      ticket.purpose !== "product-image" ||
      ticket.productId !== productId ||
      ticket.organizationId !== organizationId ||
      ticket.role !== roles[i]
    ) {
      return null;
    }
  }
  const [display, thumb, doc] = tickets as UploadTicket[];
  const base = display.key.replace(/\.(webp|jpg)$/, "");
  const ext = display.key.slice(base.length);
  if (
    base === display.key ||
    !base.startsWith(`org/${organizationId}/products/${productId}/`) ||
    thumb.key !== `${base}-thumb${ext}` ||
    doc.key !== `${base}-doc.jpg` ||
    thumb.type !== display.type
  ) {
    return null;
  }
  return { display, thumb, doc };
}

function isKnownError(error: unknown, code: string): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

// Step two: all three copies arrived; write the row at the end of the
// line (never in front of the main picture). A retry after a dropped
// answer finds its own row and writes nothing.
export async function finishProductImage(
  organizationId: string,
  userId: string,
  input: { productId: string; tickets: unknown[]; colorOptionId?: string | null; width?: number; height?: number },
): Promise<{ ok: true; id: string } | { error: string }> {
  const tickets = readTickets(input.tickets, organizationId, input.productId);
  if (!tickets) return { error: "This upload took too long and expired. Add the picture again." };
  const driver = storageDriver();
  if (!driver) return { error: STORAGE_OFF };
  const { display, thumb, doc } = tickets;
  const keys = [display.key, thumb.key, doc.key];

  const already = await prisma.productImage.findFirst({
    where: { productId: input.productId, storageKey: display.key },
    select: { id: true },
  });
  if (already) return { ok: true, id: already.id };

  const sizes = await Promise.all(keys.map((key) => statObject(driver, key)));
  if (sizes.some((size) => !size)) return { error: "The picture didn't arrive. Add it again." };

  const refuse = async (error: string) => {
    await deleteUnheldFiles(driver, [{ storageKey: display.key, thumbKey: thumb.key, docKey: doc.key }]);
    return { error };
  };
  const product = await prisma.product.findFirst({ where: { id: input.productId, organizationId }, select: { id: true } });
  if (!product) return refuse("This product is gone. Reload the page.");

  let colorOptionId: string | null = null;
  if (input.colorOptionId) {
    const color = await prisma.variationOption.findFirst({
      where: { id: input.colorOptionId, organizationId, archivedAt: null, group: { kind: "COLOR" } },
      select: { id: true },
    });
    colorOptionId = color?.id ?? null;
  }
  const width = Number.isInteger(input.width) && input.width! > 0 && input.width! < 100_000 ? input.width! : null;
  const height = Number.isInteger(input.height) && input.height! > 0 && input.height! < 100_000 ? input.height! : null;

  for (let attempt = 0; attempt < MAX_PRODUCT_PICTURES + 2; attempt += 1) {
    const taken = await prisma.productImage.findMany({
      where: { productId: input.productId, position: { not: null } },
      select: { position: true },
    });
    if (taken.length >= MAX_PRODUCT_PICTURES) return refuse(`Up to ${MAX_PRODUCT_PICTURES} pictures. Remove one first.`);
    const used = new Set(taken.map((row) => row.position!));
    const last = Math.max(-1, ...used);
    let position = last + 1;
    if (position >= MAX_PRODUCT_PICTURES) {
      position = 0;
      while (used.has(position)) position += 1;
    }
    try {
      const made = await prisma.productImage.create({
        data: {
          organizationId,
          productId: input.productId,
          position,
          colorOptionId,
          storageKey: display.key,
          thumbKey: thumb.key,
          docKey: doc.key,
          contentType: display.type,
          sizeBytes: sizes[0]!.size,
          width,
          height,
          publicToken: publicToken(),
          createdById: userId,
        },
        select: { id: true },
      });
      return { ok: true, id: made.id };
    } catch (error) {
      if (isKnownError(error, "P2003")) return refuse("This product is gone. Reload the page.");
      if (!isKnownError(error, "P2002")) throw error;
      if (JSON.stringify(error.meta ?? {}).includes("storageKey")) {
        const twin = await prisma.productImage.findFirst({
          where: { productId: input.productId, storageKey: display.key },
          select: { id: true },
        });
        if (twin) return { ok: true, id: twin.id };
      }
      // Someone else took that slot; try the next.
    }
  }
  return refuse("Someone else just changed the pictures. Reload and try again.");
}

/* ------------------------------- Changes --------------------------------- */

type Keys = { storageKey: string; thumbKey: string; docKey: string };

// A file goes only when no row holds its key any more: a clone's pictures
// share the source's files.
async function deleteUnheldFiles(driver: StorageDriver | null, rows: Keys[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.storageKey)) continue;
    seen.add(row.storageKey);
    const held = await prisma.productImage.count({ where: { storageKey: row.storageKey } });
    if (held > 0) continue;
    await deleteObject(driver, row.storageKey);
    await deleteObject(driver, row.thumbKey);
    await deleteObject(driver, row.docKey);
  }
}

const CHANGED = "Someone else just changed the pictures. Reload the page.";

function changedByOthers(error: unknown) {
  return isKnownError(error, "P2002") || isKnownError(error, "P2034");
}

// Remove: drafts let go of it (they show the product's picture live), a
// sent quote's line keeps it, and the rest close up behind it.
export async function removeProductImage(organizationId: string, imageId: string): Promise<{ ok: true } | { error: string }> {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, organizationId, position: { not: null } },
    select: { id: true, productId: true, storageKey: true, thumbKey: true, docKey: true },
  });
  if (!image?.productId) return { ok: true };
  const productId = image.productId;
  let deleted = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "ProductImage" WHERE "productId" = ${productId} AND position IS NOT NULL FOR UPDATE`;
      await tx.$executeRaw`
        UPDATE "QuoteLineItem" SET "imageId" = NULL
        WHERE "imageId" = ${image.id}
          AND "quoteId" IN (SELECT id FROM "Quote" WHERE status = 'DRAFT')`;
      const held = await tx.quoteLineItem.count({ where: { imageId: image.id } });
      if (held > 0) {
        await tx.productImage.update({ where: { id: image.id }, data: { position: null, removedAt: new Date() } });
      } else {
        await tx.productImage.delete({ where: { id: image.id } });
        deleted = true;
      }
      // Close the gap: 0..n-1 in the same order. Out of the way first, so
      // the unique index never sees two at one position.
      await tx.$executeRaw`
        UPDATE "ProductImage" SET position = position + 100
        WHERE "productId" = ${productId} AND position IS NOT NULL`;
      await tx.$executeRaw`
        UPDATE "ProductImage" p SET position = ranked.n
        FROM (
          SELECT id, (row_number() OVER (ORDER BY position) - 1)::int AS n
          FROM "ProductImage" WHERE "productId" = ${productId} AND position IS NOT NULL
        ) ranked
        WHERE p.id = ranked.id`;
    });
  } catch (error) {
    if (changedByOthers(error)) return { error: CHANGED };
    throw error;
  }
  if (deleted) await deleteUnheldFiles(storageDriver(), [image]);
  return { ok: true };
}

// Make main: it swaps places with the main picture.
export async function makeMainPicture(organizationId: string, imageId: string): Promise<{ ok: true } | { error: string }> {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, organizationId, position: { not: null } },
    select: { id: true, productId: true },
  });
  if (!image?.productId) return { error: CHANGED };
  const productId = image.productId;
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; position: number }[]>`
        SELECT id, position FROM "ProductImage"
        WHERE "productId" = ${productId} AND position IS NOT NULL
        ORDER BY position FOR UPDATE`;
      const target = rows.find((row) => row.id === image.id);
      const main = rows[0];
      if (!target || !main || main.id === target.id) return;
      await tx.productImage.update({ where: { id: target.id }, data: { position: -1 } });
      await tx.productImage.update({ where: { id: main.id }, data: { position: target.position } });
      await tx.productImage.update({ where: { id: target.id }, data: { position: main.position } });
    });
  } catch (error) {
    if (changedByOthers(error)) return { error: CHANGED };
    throw error;
  }
  return { ok: true };
}

// Which Color a picture shows, or none.
export async function setPictureColor(
  organizationId: string,
  imageId: string,
  colorOptionId: string | null,
): Promise<{ ok: true } | { error: string }> {
  let color: string | null = null;
  if (colorOptionId) {
    const found = await prisma.variationOption.findFirst({
      where: { id: colorOptionId, organizationId, group: { kind: "COLOR" } },
      select: { id: true },
    });
    if (!found) return { error: "That color is gone. Reload the page." };
    color = found.id;
  }
  await prisma.productImage.updateMany({
    where: { id: imageId, organizationId, position: { not: null } },
    data: { colorOptionId: color },
  });
  return { ok: true };
}

// A clone gets its own rows for the source's pictures, on the same files.
export async function copyPicturesTo(organizationId: string, sourceId: string, cloneId: string) {
  const rows = await prisma.productImage.findMany({
    where: { organizationId, productId: sourceId, position: { not: null } },
    orderBy: { position: "asc" },
  });
  if (!rows.length) return;
  await prisma.productImage.createMany({
    data: rows.map((row, index) => ({
      organizationId,
      productId: cloneId,
      position: index,
      colorOptionId: row.colorOptionId,
      storageKey: row.storageKey,
      thumbKey: row.thumbKey,
      docKey: row.docKey,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      publicToken: publicToken(),
      createdById: row.createdById,
    })),
    skipDuplicates: true,
  });
}

// Pictures off their product (removed, or the product deleted) that no
// quote line holds any more go, files and all.
export async function sweepUnusedPictures(organizationId: string) {
  const rows = await prisma.$queryRaw<(Keys & { id: string })[]>`
    SELECT img.id, img."storageKey", img."thumbKey", img."docKey"
    FROM "ProductImage" img
    WHERE img."organizationId" = ${organizationId}
      AND (img."productId" IS NULL OR img.position IS NULL)
      AND NOT EXISTS (SELECT 1 FROM "QuoteLineItem" l WHERE l."imageId" = img.id)
    LIMIT 500`;
  if (!rows.length) return;
  await prisma.productImage.deleteMany({
    where: {
      id: { in: rows.map((row) => row.id) },
      organizationId,
      OR: [{ productId: null }, { position: null }],
      lines: { none: {} },
    },
  });
  await deleteUnheldFiles(storageDriver(), rows);
}
