import { prisma } from "@/lib/prisma";
import { ensureGroup, getVariationGroups } from "@/lib/variations";

// The apparel pack (Nov 12, 2026): "We do apparel / custom print". A school
// printer keeps each customer's logo, places it on a product's own picture
// at a print location, and sends the customer one link to approve it. The
// switch hides the entry points; every apparel action checks it again,
// because hiding a button is not stopping a post.

export const PRINT_LOCATION_GROUP = "Print location";

// What a print shop starts with; edited like any label list afterwards.
export const DEFAULT_PRINT_LOCATIONS = [
  "Front",
  "Back",
  "Left chest",
  "Full front",
  "Full back",
  "Left sleeve",
  "Right sleeve",
] as const;

// Turned on or off by an owner or admin, or the operator on /admin.
export async function setApparel(organizationId: string, on: boolean) {
  const current = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { apparelOn: true },
  });
  if (!current) return;
  if (on) await ensurePrintLocations(organizationId);
  if (current.apparelOn !== on) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { apparelOn: on, ...(on ? { apparelOnAt: new Date() } : {}) },
    });
  }
}

export async function apparelOn(organizationId: string) {
  const row = await prisma.organization.findUnique({ where: { id: organizationId }, select: { apparelOn: true } });
  return Boolean(row?.apparelOn);
}

// The Print location group: the one remembered on the workspace, else one
// already named so, else a new one with the usual places on a garment.
// Retired places stay retired; a place the shop renamed keeps its name.
export async function ensurePrintLocations(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { printLocationGroupId: true },
  });
  let groupId = org?.printLocationGroupId ?? null;
  if (groupId) {
    const live = await prisma.variationGroup.findFirst({
      where: { id: groupId, organizationId },
      select: { id: true },
    });
    groupId = live?.id ?? null;
  }
  let fresh = false;
  if (!groupId) {
    await getVariationGroups(organizationId);
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "VariationGroup"
      WHERE "organizationId" = ${organizationId} AND lower(name) = lower(${PRINT_LOCATION_GROUP}) LIMIT 1`;
    if (existing[0]) groupId = existing[0].id;
    else {
      const made = await ensureGroup(organizationId, PRINT_LOCATION_GROUP);
      if ("error" in made) return null;
      groupId = made.id;
      fresh = true;
    }
    await prisma.organization.update({ where: { id: organizationId }, data: { printLocationGroupId: groupId } });
  }
  // Proofs pick their place from this list, so it can't be retired while
  // apparel is on (Labels & Units refuses); turning apparel on brings back
  // one retired before.
  await prisma.variationGroup.updateMany({
    where: { id: groupId, organizationId, archivedAt: { not: null } },
    data: { archivedAt: null },
  });
  // Only a group made here gets the starting list: one the shop already had
  // is theirs as it is.
  if (fresh) {
    await prisma.variationOption.createMany({
      data: DEFAULT_PRINT_LOCATIONS.map((name, position) => ({ organizationId, groupId: groupId!, name, position })),
      skipDuplicates: true,
    });
  }
  return groupId;
}
