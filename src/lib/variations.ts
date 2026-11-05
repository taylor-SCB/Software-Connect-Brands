import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { LineItemTag, UnitOfMeasure, VariationKind } from "@/generated/prisma/enums";
import { UNIT_GROUPS, UNIT_LABELS, UNITS_OF_MEASURE, unitGroupFor } from "@/lib/constants";
import {
  BUILT_IN_GROUP_NAMES,
  MAX_CUSTOM_GROUPS,
  MAX_OPTIONS_PER_GROUP,
  MAX_UNIT_CONTAINS,
  cleanLabel,
  customUnitLabel,
  readSnapshot,
  type LineGroup,
  type PickableOption,
} from "@/lib/variation-shared";

// Release 3b (Nov 6, 2026): a workspace's label groups. Unit, Color and Size
// are built in, with the 19 built-in units as the Unit group's first
// options; both are made the first time anything asks, so a workspace that
// existed before 3b needs no data step. Anyone signed in adds a label, a
// group or a unit; only an Owner or Admin renames, retires, restores or
// reorders (src/app/dashboard/products/labels/actions.ts).

const BUILT_IN_GROUPS: { kind: VariationKind; name: string; position: number }[] = [
  { kind: "UNIT", name: BUILT_IN_GROUP_NAMES.UNIT, position: 0 },
  { kind: "COLOR", name: BUILT_IN_GROUP_NAMES.COLOR, position: 1 },
  { kind: "SIZE", name: BUILT_IN_GROUP_NAMES.SIZE, position: 2 },
];

// A workspace's own units sort after the built-ins in the Unit group.
const CUSTOM_UNIT_POSITION_START = 100;

export type OptionView = {
  id: string;
  name: string;
  position: number;
  archived: boolean;
  builtInUnit: UnitOfMeasure | null;
  contains: number | null;
  baseUnit: UnitOfMeasure | null;
  tag: LineItemTag | null;
};

export type GroupView = {
  id: string;
  kind: VariationKind;
  name: string;
  position: number;
  archived: boolean;
  builtIn: boolean;
  options: OptionView[];
};

const optionSelect = {
  id: true,
  name: true,
  position: true,
  archivedAt: true,
  builtInUnit: true,
  contains: true,
  baseUnit: true,
  tag: true,
} as const;

function loadGroups(organizationId: string) {
  return prisma.variationGroup.findMany({
    where: { organizationId },
    orderBy: [{ kind: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      kind: true,
      name: true,
      position: true,
      archivedAt: true,
      options: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: optionSelect },
    },
  });
}

// Every group with its options, retired ones included only when asked.
export async function getVariationGroups(
  organizationId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<GroupView[]> {
  let groups = await loadGroups(organizationId);
  if (needsSeed(groups)) {
    await seedBuiltIns(organizationId);
    groups = await loadGroups(organizationId);
  }
  return groups
    .filter((group) => includeArchived || !group.archivedAt)
    .map((group) => ({
      id: group.id,
      kind: group.kind,
      name: group.name,
      position: group.position,
      archived: Boolean(group.archivedAt),
      builtIn: group.kind !== "CUSTOM",
      options: group.options
        .filter((option) => includeArchived || !option.archivedAt)
        .map((option) => ({
          id: option.id,
          name: option.name,
          position: option.position,
          archived: Boolean(option.archivedAt),
          builtInUnit: option.builtInUnit,
          contains: option.contains,
          baseUnit: option.baseUnit,
          tag: option.tag,
        })),
    }));
}

function needsSeed(groups: { kind: VariationKind; options: { builtInUnit: UnitOfMeasure | null }[] }[]) {
  for (const builtIn of BUILT_IN_GROUPS) {
    if (!groups.some((group) => group.kind === builtIn.kind)) return true;
  }
  const unit = groups.find((group) => group.kind === "UNIT");
  const have = new Set(unit?.options.map((option) => option.builtInUnit).filter(Boolean));
  return UNITS_OF_MEASURE.some((value) => !have.has(value));
}

// Two tabs can both seed; the unique indexes let one write each row.
export async function seedBuiltIns(organizationId: string) {
  await prisma.variationGroup.createMany({
    data: BUILT_IN_GROUPS.map((group) => ({ organizationId, ...group })),
    skipDuplicates: true,
  });
  const unit = await prisma.variationGroup.findFirst({
    where: { organizationId, kind: "UNIT" },
    select: { id: true },
  });
  if (!unit) return;
  await prisma.variationOption.createMany({
    data: UNITS_OF_MEASURE.map((value, position) => ({
      organizationId,
      groupId: unit.id,
      name: UNIT_LABELS[value],
      position,
      builtInUnit: value,
      tag: unitGroupFor(value) as LineItemTag,
    })),
    skipDuplicates: true,
  });
}

export async function unitGroupId(organizationId: string) {
  const find = () =>
    prisma.variationGroup.findFirst({ where: { organizationId, kind: "UNIT" }, select: { id: true } });
  let group = await find();
  if (!group) {
    await seedBuiltIns(organizationId);
    group = await find();
  }
  return group?.id ?? null;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type Found = { id: string; name: string; archivedAt: Date | null };

// Case-insensitive, without ILIKE: % and _ in a typed name are wildcards
// there.
async function findOptionByName(groupId: string, name: string): Promise<Found | null> {
  const rows = await prisma.$queryRaw<Found[]>`
    SELECT id, name, "archivedAt" FROM "VariationOption"
    WHERE "groupId" = ${groupId} AND lower(name) = lower(${name})
    LIMIT 1`;
  return rows[0] ?? null;
}

async function findGroupByName(organizationId: string, name: string) {
  const rows = await prisma.$queryRaw<(Found & { kind: VariationKind })[]>`
    SELECT id, name, kind, "archivedAt" FROM "VariationGroup"
    WHERE "organizationId" = ${organizationId} AND lower(name) = lower(${name})
    LIMIT 1`;
  return rows[0] ?? null;
}

function retiredMessage(name: string) {
  return `${name} was retired. An Owner or Admin can bring it back on Labels & Units.`;
}

export type EnsureResult = { id: string; name: string } | { error: string };

// "+ Add" on a group: a label typed on a product or on Labels & Units. The
// workspace's own spelling wins over what was typed. A retired label of
// that name is not quietly re-used: bringing it back is an Owner's or
// Admin's call.
export async function ensureOption(organizationId: string, groupId: string, raw: string): Promise<EnsureResult> {
  const name = cleanLabel(raw);
  if (!name) return { error: "Type a name for the label." };
  const group = await prisma.variationGroup.findFirst({
    where: { id: groupId, organizationId },
    select: { id: true, kind: true, name: true, archivedAt: true },
  });
  if (!group) return { error: "That group is gone. Reload the page." };
  if (group.archivedAt) return { error: retiredMessage(group.name) };
  if (group.kind === "UNIT") return { error: "Add a unit with + Add unit, which asks what it contains." };

  const existing = await findOptionByName(group.id, name);
  if (existing) return existing.archivedAt ? { error: retiredMessage(existing.name) } : existing;

  const count = await prisma.variationOption.count({ where: { groupId: group.id } });
  if (count >= MAX_OPTIONS_PER_GROUP) {
    return { error: `${group.name} already has ${MAX_OPTIONS_PER_GROUP} labels, the most a group holds.` };
  }
  try {
    return await prisma.variationOption.create({
      data: { organizationId, groupId: group.id, name, position: await nextPosition(group.id) },
      select: { id: true, name: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Someone else added it between the check and the write.
    const raced = await findOptionByName(group.id, name);
    if (raced && !raced.archivedAt) return raced;
    return { error: "Couldn't add that label. Try again." };
  }
}

async function nextPosition(groupId: string) {
  const last = await prisma.variationOption.aggregate({ where: { groupId }, _max: { position: true } });
  return (last._max.position ?? -1) + 1;
}

// "+ Add a group" (Sleeve, Print location). A built-in's name lands on the
// built-in; the workspace's own spelling wins.
export async function ensureGroup(organizationId: string, raw: string): Promise<EnsureResult> {
  const name = cleanLabel(raw);
  if (!name) return { error: "Type a name for the group." };
  await getVariationGroups(organizationId);
  const existing = await findGroupByName(organizationId, name);
  if (existing) {
    if (existing.kind === "UNIT") return { error: "Units have their own row. Use + Add unit." };
    return existing.archivedAt ? { error: retiredMessage(existing.name) } : existing;
  }
  const count = await prisma.variationGroup.count({ where: { organizationId, kind: "CUSTOM" } });
  if (count >= MAX_CUSTOM_GROUPS) {
    return { error: `You have ${MAX_CUSTOM_GROUPS} groups of your own, the most a workspace holds.` };
  }
  const last = await prisma.variationGroup.aggregate({
    where: { organizationId, kind: "CUSTOM" },
    _max: { position: true },
  });
  try {
    return await prisma.variationGroup.create({
      data: { organizationId, kind: "CUSTOM", name, position: Math.max(last._max.position ?? 9, 9) + 1 },
      select: { id: true, name: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findGroupByName(organizationId, name);
    if (raced && !raced.archivedAt) return raced;
    return { error: "Couldn't add that group. Try again." };
  }
}

export const CUSTOM_UNIT_TAGS = ["LABOR", "MATERIALS"] as const;

export function isCustomUnitTag(tag: string | null | undefined): tag is "LABOR" | "MATERIALS" {
  return tag === "LABOR" || tag === "MATERIALS";
}

const BUILT_IN_UNIT_NAMES = new Set(Object.values(UNIT_LABELS).map((label) => label.toLowerCase()));

export function isBuiltInUnitName(name: string) {
  return BUILT_IN_UNIT_NAMES.has(name.trim().toLowerCase());
}

// "+ Add unit": "Box of 12" contains 12 Each. Labor and Materials only —
// a Software product's rate and term need one of the built-in Software
// units. A name already in use returns that unit untouched (what it
// contains is changed on Labels & Units, by an Owner or Admin).
export async function createCustomUnit(
  organizationId: string,
  input: { name: string; contains: number; baseUnit: string; tag: string },
): Promise<EnsureResult> {
  const name = cleanLabel(input.name);
  if (!name) return { error: "Type a name for the unit, like Box of 12." };
  if (!isCustomUnitTag(input.tag)) return { error: "Software units can't be made your own yet." };
  const tag = input.tag;
  if (!(UNIT_GROUPS[tag] as readonly string[]).includes(input.baseUnit)) {
    return { error: "Pick what one of these contains from the list." };
  }
  const contains = Number(input.contains);
  if (!Number.isFinite(contains) || contains <= 0 || contains > MAX_UNIT_CONTAINS) {
    return { error: "How many it contains has to be a number above 0." };
  }
  if (isBuiltInUnitName(name)) return { error: `${name} is one of the built-in units. Pick it from the list.` };

  const groupId = await unitGroupId(organizationId);
  if (!groupId) return { error: "Couldn't add that unit. Try again." };
  const existing = await prisma.$queryRaw<(Found & { tag: LineItemTag | null })[]>`
    SELECT id, name, tag, "archivedAt" FROM "VariationOption"
    WHERE "groupId" = ${groupId} AND lower(name) = lower(${name}) LIMIT 1`;
  if (existing[0]) {
    const found = existing[0];
    if (found.archivedAt) return { error: retiredMessage(found.name) };
    if (found.tag !== tag) {
      return { error: `${found.name} is already one of your ${found.tag === "LABOR" ? "Labor" : "Materials"} units.` };
    }
    return { id: found.id, name: found.name };
  }
  const count = await prisma.variationOption.count({ where: { groupId, builtInUnit: null } });
  if (count >= MAX_OPTIONS_PER_GROUP) {
    return { error: `You have ${MAX_OPTIONS_PER_GROUP} units of your own, the most a workspace holds.` };
  }
  try {
    return await prisma.variationOption.create({
      data: {
        organizationId,
        groupId,
        name,
        position: CUSTOM_UNIT_POSITION_START + count,
        contains,
        baseUnit: input.baseUnit as UnitOfMeasure,
        tag,
      },
      select: { id: true, name: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findOptionByName(groupId, name);
    if (raced && !raced.archivedAt) return raced;
    return { error: "Couldn't add that unit. Try again." };
  }
}

export type CustomUnitView = {
  id: string;
  name: string;
  tag: LineItemTag;
  contains: number | null;
  baseUnit: UnitOfMeasure | null;
  archived: boolean;
};

// The workspace's own units (not the built-ins), live ones only unless the
// caller adds the ids it must offer back.
export async function getCustomUnits(organizationId: string, alsoIds: (string | null | undefined)[] = []) {
  const extra = alsoIds.filter((id): id is string => Boolean(id));
  const rows = await prisma.variationOption.findMany({
    where: {
      organizationId,
      builtInUnit: null,
      tag: { not: null },
      group: { kind: "UNIT" },
      OR: [{ archivedAt: null }, ...(extra.length ? [{ id: { in: extra } }] : [])],
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, tag: true, contains: true, baseUnit: true, archivedAt: true },
  });
  return rows.map(
    (row): CustomUnitView => ({
      id: row.id,
      name: row.name,
      tag: row.tag as LineItemTag,
      contains: row.contains,
      baseUnit: row.baseUnit,
      archived: Boolean(row.archivedAt),
    }),
  );
}

// A workspace unit that may go on a product or line of this tag: live,
// this workspace's, one of its own (not a built-in), and of the same list.
export async function usableCustomUnit(organizationId: string, id: string, tag: string) {
  if (!isCustomUnitTag(tag)) return null;
  return prisma.variationOption.findFirst({
    where: { id, organizationId, archivedAt: null, builtInUnit: null, tag, group: { kind: "UNIT" } },
    select: { id: true, name: true, tag: true },
  });
}

const GROUP_ORDER: Record<VariationKind, number> = { UNIT: 0, COLOR: 1, SIZE: 2, CUSTOM: 3 };

export function groupOrder(kind: VariationKind, position: number) {
  return GROUP_ORDER[kind] * 100_000 + position;
}

// The options a set of ids names, scoped to the workspace, with what the
// quote line's snapshot needs.
export async function pickableOptions(organizationId: string, ids: string[]) {
  const map = new Map<string, PickableOption & { archived: boolean }>();
  if (!ids.length) return map;
  const rows = await prisma.variationOption.findMany({
    where: { organizationId, id: { in: ids } },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      group: { select: { id: true, name: true, kind: true, position: true, archivedAt: true } },
    },
  });
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      name: row.name,
      groupId: row.group.id,
      groupName: row.group.name,
      groupKind: row.group.kind,
      groupOrder: groupOrder(row.group.kind, row.group.position),
      archived: Boolean(row.archivedAt || row.group.archivedAt),
    });
  }
  return map;
}

// For each product, the labels a quote line can pick from: the options it
// has ticked that are still live, grouped, units left out. One query for
// any number of products.
export async function lineGroupsFor(organizationId: string, productIds: string[]) {
  const out = new Map<string, LineGroup[]>();
  if (!productIds.length) return out;
  const rows = await prisma.productVariation.findMany({
    where: {
      organizationId,
      productId: { in: productIds },
      option: { archivedAt: null, group: { archivedAt: null, kind: { not: "UNIT" } } },
    },
    select: {
      productId: true,
      option: {
        select: {
          id: true,
          name: true,
          position: true,
          group: { select: { id: true, name: true, kind: true, position: true } },
        },
      },
    },
  });
  const byProduct = new Map<string, Map<string, LineGroup & { order: number; optionOrder: Map<string, number> }>>();
  for (const row of rows) {
    let groups = byProduct.get(row.productId);
    if (!groups) byProduct.set(row.productId, (groups = new Map()));
    const g = row.option.group;
    let group = groups.get(g.id);
    if (!group) {
      group = { id: g.id, name: g.name, kind: g.kind, options: [], order: groupOrder(g.kind, g.position), optionOrder: new Map() };
      groups.set(g.id, group);
    }
    group.options.push({ id: row.option.id, name: row.option.name });
    group.optionOrder.set(row.option.id, row.option.position);
  }
  for (const [productId, groups] of byProduct) {
    out.set(
      productId,
      [...groups.values()]
        .sort((a, b) => a.order - b.order)
        .map((group) => ({
          id: group.id,
          name: group.name,
          kind: group.kind,
          options: group.options.sort(
            (a, b) => (group.optionOrder.get(a.id) ?? 0) - (group.optionOrder.get(b.id) ?? 0) || a.name.localeCompare(b.name),
          ),
        })),
    );
  }
  return out;
}

// "4 colors · 4 sizes · 2 units" for the Products list: one grouped count
// over a page of products.
export async function labelCountsFor(organizationId: string, productIds: string[]) {
  const out = new Map<string, { kind: VariationKind; name: string; count: number; order: number }[]>();
  if (!productIds.length) return out;
  const rows = await prisma.$queryRaw<
    { productId: string; kind: VariationKind; name: string; position: number; count: bigint }[]
  >`
    SELECT pv."productId", g.kind, g.name, g.position, count(*) AS count
    FROM "ProductVariation" pv
    JOIN "VariationOption" o ON o.id = pv."optionId"
    JOIN "VariationGroup" g ON g.id = o."groupId"
    WHERE pv."organizationId" = ${organizationId}
      AND pv."productId" IN (${Prisma.join(productIds)})
      AND o."archivedAt" IS NULL AND g."archivedAt" IS NULL
    GROUP BY pv."productId", g.id, g.kind, g.name, g.position`;
  for (const row of rows) {
    const list = out.get(row.productId) ?? [];
    list.push({ kind: row.kind, name: row.name, count: Number(row.count), order: groupOrder(row.kind, row.position) });
    out.set(row.productId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.order - b.order);
  return out;
}

export function labelCountText(counts: { kind: VariationKind; name: string; count: number }[]) {
  return counts
    .map(({ kind, name, count }) => {
      const noun =
        kind === "COLOR" ? (count === 1 ? "color" : "colors")
        : kind === "SIZE" ? (count === 1 ? "size" : "sizes")
        : kind === "UNIT" ? (count === 1 ? "unit" : "units")
        : name.toLowerCase();
      return `${count} ${noun}`;
    })
    .join(" · ");
}

// A quote line's labels as a contract row takes them (the Contract
// Coordinator, Award without paperwork, a purchase order): the snapshot as
// written, and a workspace unit's name only while no built-in unit is set.
export function contractRowLabels(line: {
  variations: unknown;
  variationText: string | null;
  unitOfMeasure?: string | null;
  unitLabel: string | null;
}) {
  const entries = readSnapshot(line.variations);
  return {
    // An empty list, never null, on a row made from Release 3b on: null is
    // how a row made before it reads, which a purchase order fills from
    // the quote line. A row signed with no labels keeps none.
    variations: entries,
    variationText: entries.length ? line.variationText : null,
    unitLabel: customUnitLabel(line),
  };
}
