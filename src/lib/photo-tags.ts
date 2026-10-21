import { prisma } from "@/lib/prisma";
import { cleanName } from "@/lib/industries";
import { DEFAULT_PHOTO_TYPE, PHOTO_LOCATION_DEFAULTS, PHOTO_TYPE_DEFAULTS } from "@/lib/constants";
import type { PhotoTagKind } from "@/generated/prisma/enums";

// A workspace's two photo tag lists (Oct 21, 2026), seeded the first time
// anything asks, the same lazy way event types and industries are, so a
// workspace that existed before tags gets the starting lists without a
// data step.

export type PhotoTagOption = { id: string; kind: PhotoTagKind; name: string };

export const MAX_PHOTO_TAGS = 200;

const DEFAULTS: Record<PhotoTagKind, readonly string[]> = {
  TYPE: PHOTO_TYPE_DEFAULTS,
  LOCATION: PHOTO_LOCATION_DEFAULTS,
};

function loadTags(organizationId: string) {
  return prisma.photoTag.findMany({
    where: { organizationId },
    orderBy: [{ kind: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, name: true },
  });
}

export async function getPhotoTags(organizationId: string): Promise<PhotoTagOption[]> {
  let tags = await loadTags(organizationId);
  const missing = (Object.keys(DEFAULTS) as PhotoTagKind[]).flatMap((kind) => {
    const have = new Set(tags.filter((tag) => tag.kind === kind).map((tag) => tag.name.toLowerCase()));
    return DEFAULTS[kind]
      .map((name, position) => ({ kind, name, position }))
      .filter((tag) => !have.has(tag.name.toLowerCase()));
  });
  if (missing.length) {
    // Two tabs can both seed; the unique index lets one win.
    await prisma.photoTag.createMany({
      data: missing.map((tag) => ({ organizationId, ...tag })),
      skipDuplicates: true,
    });
    tags = await loadTags(organizationId);
  }
  return tags;
}

// "+ Add new". Matched without regard to case, so "bathroom" typed on a
// phone lands on the workspace's own "Bathroom" rather than a second one.
export async function ensurePhotoTag(
  organizationId: string,
  kind: PhotoTagKind,
  raw: string,
): Promise<PhotoTagOption | { error: string }> {
  const name = cleanName(raw);
  if (!name) return { error: "Type a name for the tag" };
  const existing = await prisma.photoTag.findFirst({
    where: { organizationId, kind, name: { equals: name, mode: "insensitive" } },
    select: { id: true, kind: true, name: true },
  });
  if (existing) return existing;
  const count = await prisma.photoTag.count({ where: { organizationId, kind } });
  if (count >= MAX_PHOTO_TAGS) return { error: `That list already has ${MAX_PHOTO_TAGS} tags.` };
  return prisma.photoTag.upsert({
    where: { organizationId_kind_name: { organizationId, kind, name } },
    create: { organizationId, kind, name, position: count },
    update: {},
    select: { id: true, kind: true, name: true },
  });
}

// The tag ids a caller sent, kept only where they are this workspace's,
// with General Project added when no Photo Type is among them.
export async function resolvePhotoTags(organizationId: string, ids: unknown): Promise<string[]> {
  const wanted = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
  const tags = wanted.length
    ? await prisma.photoTag.findMany({ where: { organizationId, id: { in: wanted } }, select: { id: true, kind: true } })
    : [];
  if (tags.some((tag) => tag.kind === "TYPE")) return tags.map((tag) => tag.id);
  await getPhotoTags(organizationId);
  const general = await prisma.photoTag.findFirst({
    where: { organizationId, kind: "TYPE", name: { equals: DEFAULT_PHOTO_TYPE, mode: "insensitive" } },
    select: { id: true },
  });
  return [...tags.map((tag) => tag.id), ...(general ? [general.id] : [])];
}
