"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, optionalText, type ActionState } from "@/lib/forms";
import { dollarsToCents } from "@/lib/format";
import { linkDistributorCompany } from "@/lib/distributors";
import { repairSupplierRows, starSupplier, syncProductFromStar } from "@/lib/product-suppliers";
import { MAX_DISCOUNT_BP, MAX_MIN_MARGIN_BP } from "@/lib/supplier-math";
import { percentToBasisPoints } from "@/lib/price-list";
import { linkPlatformSupplier } from "@/lib/platform-suppliers";
import { PLATFORM_SUPPLIER_PREFIX } from "@/lib/account-types";
import { createCustomUnit, ensureGroup, ensureOption, isCustomUnitTag } from "@/lib/variations";
import { customUnitIdOf } from "@/lib/variation-shared";
import { copyPicturesTo, sweepUnusedPictures } from "@/lib/product-images";
import {
  LINE_ITEM_TAGS,
  TAG_LABELS,
  UNITS_OF_MEASURE,
  UNIT_GROUP_LABELS,
  SOFTWARE_RATES,
  isSoftwareUnit,
  tagHasUnits,
  unitAllowedForTag,
  unitGroupFor,
} from "@/lib/constants";

const idSchema = z.string().trim().min(1, "Missing record reference");

// "__new__" in a pick list means the user typed a name that doesn't exist
// yet; it is created on save so a brand new workspace never hits an empty
// dropdown it can't fill.
const NEW_OPTION = "__new__";
// "+ Add custom unit…" in the Unit box.
const NEW_UNIT = "__newunit__";

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.union([z.literal(""), z.enum(values)]).optional();

const newContactSchema = z.object({
  name: z.string().trim().min(1, "Every distributor contact needs a name").max(120),
  email: z.union([z.literal(""), z.email("Enter a valid contact email")]).optional(),
  phone: z.string().trim().max(40).optional(),
});

// A typo in a rep's phone number is exactly the data the contractor dials
// from the truck, so an existing contact can be corrected in place from
// the same form that picked it.
const contactEditSchema = newContactSchema.extend({
  id: z.string().trim().min(1),
});

const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(160),
  description: z.string().trim().max(2000).optional(),
  sku: z.string().trim().max(60).optional(),
  defaultTag: z.enum(LINE_ITEM_TAGS),
  // The kind of work this is sold under, by name from the workspace list.
  serviceType: z.string().trim().max(60).optional(),
  // A built-in unit, "cu:<id>" for one of the workspace's own, or
  // NEW_UNIT with the three boxes below (Release 3b).
  unitOfMeasure: z.string().trim().max(80).optional(),
  newUnitName: z.string().max(200).optional(),
  newUnitContains: z.string().trim().max(20).optional(),
  newUnitBase: z.string().trim().max(40).optional(),
  softwareRate: optionalEnum(SOFTWARE_RATES),
  softwareTerm: z.string().trim().max(6).optional(),
  manufacturerId: z.string().trim().max(60).optional(),
  newManufacturerName: z.string().trim().max(120).optional(),
  distributorId: z.string().trim().max(60).optional(),
  newDistributorName: z.string().trim().max(120).optional(),
  contactIds: z.array(z.string().trim().min(1)).max(100),
  newContacts: z.array(newContactSchema).max(20),
  contactEdits: z.array(contactEditSchema).max(100),
  active: z.union([z.literal("on"), z.literal("")]).optional(),
});

// A product's supplier rows (Release 3a): their price, your COGS discount,
// their MSRP and your minimum margin, as typed. The starred one is the
// distributor picked in the Distributor box.
const supplierRowSchema = z.object({
  distributorId: z.string().trim().min(1).max(60),
  cost: z.string().max(20),
  discount: z.string().max(10),
  list: z.string().max(20),
  minMargin: z.string().max(10),
});
const supplierRowsSchema = z.array(supplierRowSchema).max(50);
const removedSuppliersSchema = z.array(z.string().trim().min(1).max(60)).max(50);

function readNewContacts(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    return JSON.parse(raw);
  } catch {
    return "invalid";
  }
}

function readInput(formData: FormData) {
  return {
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    sku: formData.get("sku") ?? undefined,
    defaultTag: formData.get("defaultTag"),
    serviceType: formData.get("serviceType") ?? undefined,
    unitOfMeasure: formData.get("unitOfMeasure") ?? "",
    newUnitName: formData.get("newUnitName") ?? "",
    newUnitContains: formData.get("newUnitContains") ?? "",
    newUnitBase: formData.get("newUnitBase") ?? "",
    softwareRate: formData.get("softwareRate") ?? "",
    softwareTerm: formData.get("softwareTerm") ?? "",
    manufacturerId: formData.get("manufacturerId") ?? "",
    newManufacturerName: formData.get("newManufacturerName") ?? "",
    distributorId: formData.get("distributorId") ?? "",
    newDistributorName: formData.get("newDistributorName") ?? "",
    contactIds: formData.getAll("contactIds"),
    newContacts: readNewContacts(formData.get("newContacts")),
    contactEdits: readNewContacts(formData.get("contactEdits")),
    active: formData.get("active") ?? "",
  };
}

type Resolved = {
  scalars: {
    name: string;
    description: string;
    sku: string | null;
    unitPriceCents: number;
    costCents: number;
    listPriceCents: number | null;
    defaultTag: (typeof LINE_ITEM_TAGS)[number];
    serviceType: string | null;
    unitOfMeasure: (typeof UNITS_OF_MEASURE)[number] | null;
    customUnitId: string | null;
    softwareRate: (typeof SOFTWARE_RATES)[number] | null;
    softwareTerm: number | null;
    manufacturerId: string | null;
    distributorId: string | null;
    active: boolean;
  };
  contactIds: string[];
  newContacts: { name: string; email: string | null; phone: string | null }[];
  contactEdits: { id: string; name: string; email: string | null; phone: string | null }[];
  suppliers: SupplierRowInput[];
  removedSuppliers: string[];
  // The Variations card's changes, or null when the card wasn't touched.
  variations: { added: string[]; removed: string[] } | null;
};

type SupplierRowInput = {
  distributorId: string;
  costCents: number;
  discountBp: number;
  listPriceCents: number | null;
  minMarginBp: number | null;
};

// Turns the posted form into something Prisma can write, creating the
// manufacturer, distributor and any new contacts on the way. Everything it
// looks up is scoped to the organization, so an id pasted in from another
// tenant resolves to "not found" rather than to their record.
async function resolveProductInput(
  formData: FormData,
  organizationId: string,
  // The product's own unit as stored, which may be offered back retired.
  currentCustomUnitId: string | null = null,
): Promise<{ ok: true; data: Resolved } | { ok: false; error: string }> {
  const parsed = parseForm(productSchema, readInput(formData));
  if (!parsed.ok) return parsed;
  const input = parsed.data;

  const costCents = dollarsToCents(formData.get("cost"));
  if (costCents < 0) return { ok: false, error: "COGS can't be negative" };
  const unitPriceCents = dollarsToCents(formData.get("unitPrice"));
  // The supplier's MSRP: blank means "not known", not $0.
  const listRaw = formData.get("listPrice");
  const listPriceCents = typeof listRaw === "string" && listRaw.trim() !== "" ? dollarsToCents(listRaw) : null;
  if (listPriceCents !== null && listPriceCents < 0) return { ok: false, error: "MSRP can't be negative" };

  // Each unit list belongs to a tag: a Labor product can't be "Per
  // Gallon", and project services, shipping and taxes carry no unit at
  // all. The form only offers the right list; this is the check for a
  // stale form or a hand-built post.
  // Release 3b: a workspace's own unit ("Box of 12") instead, on Labor and
  // Materials only. It is written with unitOfMeasure null, and a built-in
  // unit with customUnitId null: never both.
  const unitRaw = input.unitOfMeasure ?? "";
  let unitOfMeasure: Resolved["scalars"]["unitOfMeasure"] = null;
  let customUnitId: string | null = null;
  if (!tagHasUnits(input.defaultTag)) {
    // No unit at all.
  } else if (unitRaw === NEW_UNIT || customUnitIdOf(unitRaw)) {
    if (!isCustomUnitTag(input.defaultTag)) {
      return { ok: false, error: "Software products use one of the built-in Software units." };
    }
    if (unitRaw === NEW_UNIT) {
      const made = await createCustomUnit(organizationId, {
        name: input.newUnitName ?? "",
        contains: Number(input.newUnitContains),
        baseUnit: input.newUnitBase ?? "",
        tag: input.defaultTag,
      });
      if ("error" in made) return { ok: false, error: made.error };
      customUnitId = made.id;
    } else {
      const id = customUnitIdOf(unitRaw)!;
      const found = await prisma.variationOption.findFirst({
        where: { id, organizationId, builtInUnit: null, group: { kind: "UNIT" } },
        select: { id: true, name: true, tag: true, archivedAt: true },
      });
      if (!found) return { ok: false, error: "That unit is gone. Pick another." };
      // A retired unit stays on a product that already has it (the box
      // offers it back), but isn't picked fresh.
      if (found.archivedAt && found.id !== currentCustomUnitId) {
        return { ok: false, error: `${found.name} was retired. Pick another unit.` };
      }
      if (found.tag !== input.defaultTag) {
        return { ok: false, error: `${found.name} belongs to the ${found.tag === "LABOR" ? "Labor" : "Materials"} list, not ${TAG_LABELS[input.defaultTag]}` };
      }
      customUnitId = found.id;
    }
  } else if (unitRaw) {
    if (!(UNITS_OF_MEASURE as readonly string[]).includes(unitRaw)) {
      return { ok: false, error: "Pick a unit from the list." };
    }
    unitOfMeasure = unitRaw as (typeof UNITS_OF_MEASURE)[number];
    if (!unitAllowedForTag(unitOfMeasure, input.defaultTag)) {
      const group = unitGroupFor(unitOfMeasure);
      return {
        ok: false,
        error: `That unit belongs to the ${group ? UNIT_GROUP_LABELS[group] : "other"} list, not ${TAG_LABELS[input.defaultTag]}`,
      };
    }
  }

  // Rate and term only mean something for software units.
  let softwareRate: Resolved["scalars"]["softwareRate"] = null;
  let softwareTerm: number | null = null;
  if (isSoftwareUnit(unitOfMeasure)) {
    softwareRate = input.softwareRate || null;
    if (input.softwareTerm) {
      const term = Number.parseInt(input.softwareTerm, 10);
      if (!Number.isInteger(term) || term < 1 || term > 1200) {
        return { ok: false, error: "Term must be a whole number of periods (1–1200)" };
      }
      softwareTerm = term;
    }
  }

  // Manufacturer: existing id, a new name, or none.
  let manufacturerId: string | null = null;
  if (input.manufacturerId === NEW_OPTION) {
    const name = input.newManufacturerName?.trim();
    if (!name) return { ok: false, error: "Type the manufacturer's name" };
    const manufacturer = await prisma.manufacturer.upsert({
      where: { organizationId_name: { organizationId, name } },
      create: { organizationId, name },
      update: {},
      select: { id: true },
    });
    manufacturerId = manufacturer.id;
  } else if (input.manufacturerId) {
    const manufacturer = await prisma.manufacturer.findFirst({
      where: { id: input.manufacturerId, organizationId },
      select: { id: true },
    });
    if (!manufacturer) return { ok: false, error: "That manufacturer no longer exists" };
    manufacturerId = manufacturer.id;
  }

  // Distributor, then the contacts underneath it.
  let distributorId: string | null = null;
  if (input.distributorId === NEW_OPTION) {
    const name = input.newDistributorName?.trim();
    if (!name) return { ok: false, error: "Type the distributor's name" };
    // Makes the matching Company too, so a distributor added here can be
    // picked as a line's Supplier / Contractor on a quote. Adding only the
    // Distributor record leaves the business invisible to the CRM side.
    const linked = await linkDistributorCompany(organizationId, name);
    if (!linked) return { ok: false, error: "Type the distributor's name" };
    distributorId = linked.distributorId;
  } else if (input.distributorId?.startsWith(PLATFORM_SUPPLIER_PREFIX)) {
    // Picked from "On Software Connect Brands": this workspace's own
    // supplier for that account, made or found and linked to it.
    const linked = await linkPlatformSupplier(organizationId, input.distributorId.slice(PLATFORM_SUPPLIER_PREFIX.length));
    if (!linked.ok) return { ok: false, error: linked.error };
    distributorId = linked.distributorId;
  } else if (input.distributorId) {
    const distributor = await prisma.distributor.findFirst({
      where: { id: input.distributorId, organizationId },
      select: { id: true },
    });
    if (!distributor) return { ok: false, error: "That distributor no longer exists" };
    distributorId = distributor.id;
  }

  let contactIds: string[] = [];
  let newContacts: Resolved["newContacts"] = [];
  let contactEdits: Resolved["contactEdits"] = [];
  if (distributorId) {
    // Contacts can only come from the chosen distributor: a switch of
    // distributor drops the old rep rather than carrying them across.
    const wanted = [...input.contactIds, ...input.contactEdits.map((edit) => edit.id)];
    const owned = new Set<string>();
    if (wanted.length > 0) {
      const rows = await prisma.distributorContact.findMany({
        where: { id: { in: wanted }, distributorId, organizationId },
        select: { id: true },
      });
      for (const row of rows) owned.add(row.id);
    }
    contactIds = input.contactIds.filter((id) => owned.has(id));
    newContacts = input.newContacts.map((contact) => ({
      name: contact.name,
      email: contact.email ? contact.email.toLowerCase() : null,
      phone: contact.phone?.trim() || null,
    }));
    contactEdits = input.contactEdits
      .filter((edit) => owned.has(edit.id))
      .map((edit) => ({
        id: edit.id,
        name: edit.name,
        email: edit.email ? edit.email.toLowerCase() : null,
        phone: edit.phone?.trim() || null,
      }));
  }

  // The supplier rows, each checked against this workspace.
  const rowsParsed = supplierRowsSchema.safeParse(readNewContacts(formData.get("suppliers")));
  const removedParsed = removedSuppliersSchema.safeParse(readNewContacts(formData.get("removedSuppliers")));
  if (!rowsParsed.success || !removedParsed.success) {
    return { ok: false, error: "The suppliers on this form couldn't be read. Reload the page and try again." };
  }
  const supplierIds = [...new Set(rowsParsed.data.map((row) => row.distributorId))];
  const owned = supplierIds.length
    ? await prisma.distributor.findMany({ where: { id: { in: supplierIds }, organizationId }, select: { id: true, name: true } })
    : [];
  const ownedNames = new Map(owned.map((row) => [row.id, row.name]));
  const suppliers: SupplierRowInput[] = [];
  for (const row of rowsParsed.data) {
    const name = ownedNames.get(row.distributorId);
    if (!name) return { ok: false, error: "One of the suppliers on this form no longer exists. Reload the page." };
    const rowCost = row.cost.trim() === "" ? 0 : dollarsToCents(row.cost);
    if (rowCost < 0) return { ok: false, error: `${name}'s price can't be negative` };
    const rowDiscount = row.discount.trim() === "" ? 0 : percentToBasisPoints(row.discount);
    if (rowDiscount === null || rowDiscount > MAX_DISCOUNT_BP) {
      return { ok: false, error: `${name}'s COGS discount has to be a percentage under 95` };
    }
    const rowList = row.list.trim() === "" ? null : dollarsToCents(row.list);
    if (rowList !== null && rowList < 0) return { ok: false, error: `${name}'s MSRP can't be negative` };
    const rowMinMargin = row.minMargin.trim() === "" ? null : percentToBasisPoints(row.minMargin);
    if (row.minMargin.trim() !== "" && (rowMinMargin === null || rowMinMargin > MAX_MIN_MARGIN_BP)) {
      return { ok: false, error: `${name}'s minimum margin has to be a percentage under 95` };
    }
    suppliers.push({
      distributorId: row.distributorId,
      costCents: rowCost,
      discountBp: rowDiscount,
      listPriceCents: rowList,
      minMarginBp: rowMinMargin,
    });
  }

  const variations = await resolveVariations(formData, organizationId, input.defaultTag);
  if (variations && "error" in variations) return { ok: false, error: variations.error };

  return {
    ok: true,
    data: {
      suppliers,
      removedSuppliers: removedParsed.data,
      variations,
      scalars: {
        name: input.name,
        description: optionalText(formData.get("description")) ?? "",
        sku: optionalText(formData.get("sku")),
        unitPriceCents,
        costCents,
        listPriceCents,
        defaultTag: input.defaultTag,
        serviceType: input.serviceType ? input.serviceType : null,
        unitOfMeasure,
        customUnitId,
        softwareRate,
        softwareTerm,
        manufacturerId,
        distributorId,
        active: input.active === "on",
      },
      contactIds,
      newContacts,
      contactEdits,
    },
  };
}

// The Variations card (Release 3b) posts what changed on it, never the
// whole set, and only once it was touched: a save of the price can't take
// off a label another tab added, or one retired since the page was opened.
const variationsSchema = z.object({
  added: z.array(z.string().trim().min(1).max(60)).max(2000),
  removed: z.array(z.string().trim().min(1).max(60)).max(2000),
  newLabels: z
    .array(
      z.object({
        groupId: z.string().trim().max(60).optional(),
        groupName: z.string().max(120).optional(),
        name: z.string().max(120),
      }),
    )
    .max(200),
  newGroups: z.array(z.string().max(120)).max(30),
});

async function resolveVariations(
  formData: FormData,
  organizationId: string,
  tag: string,
): Promise<{ added: string[]; removed: string[] } | { error: string } | null> {
  if (formData.get("variationsPresent") !== "1") return null;
  const parsed = variationsSchema.safeParse(readNewContacts(formData.get("variations")));
  if (!parsed.success) return { error: "The labels on this form couldn't be read. Reload the page and try again." };
  const { added, removed, newLabels, newGroups } = parsed.data;

  // New groups first, so a label typed under one lands in it.
  const groupIds = new Map<string, string>();
  for (const name of newGroups) {
    const made = await ensureGroup(organizationId, name);
    if ("error" in made) return made;
    groupIds.set(name.trim().toLowerCase(), made.id);
  }
  const fresh: string[] = [];
  for (const label of newLabels) {
    let groupId = label.groupId || null;
    if (!groupId && label.groupName) {
      groupId = groupIds.get(label.groupName.trim().toLowerCase()) ?? null;
      if (!groupId) {
        const made = await ensureGroup(organizationId, label.groupName);
        if ("error" in made) return made;
        groupId = made.id;
      }
    }
    if (!groupId) continue;
    const made = await ensureOption(organizationId, groupId, label.name);
    if ("error" in made) return made;
    fresh.push(made.id);
  }

  // Ticked labels must be this workspace's and live; a unit must be of the
  // product's own list. Anything else is left off rather than refused.
  const wanted = [...new Set(added)];
  const live = wanted.length
    ? await prisma.variationOption.findMany({
        where: { id: { in: wanted }, organizationId, archivedAt: null, group: { archivedAt: null } },
        select: { id: true, tag: true, group: { select: { kind: true } } },
      })
    : [];
  const ok = live.filter((option) => option.group.kind !== "UNIT" || option.tag === tag).map((option) => option.id);
  const removing = new Set(removed);
  return { added: [...new Set([...ok, ...fresh])].filter((id) => !removing.has(id)), removed: [...removing] };
}

// After the product is written. A unit from another tag's list never stays
// ticked: the tag decides which units a product can come in.
async function saveVariations(organizationId: string, productId: string, tag: string, data: Resolved) {
  if (data.variations) {
    const { added, removed } = data.variations;
    if (removed.length) {
      await prisma.productVariation.deleteMany({ where: { organizationId, productId, optionId: { in: removed } } });
    }
    if (added.length) {
      await prisma.productVariation.createMany({
        data: added.map((optionId) => ({ organizationId, productId, optionId })),
        skipDuplicates: true,
      });
    }
  }
  await prisma.productVariation.deleteMany({
    where: { organizationId, productId, option: { group: { kind: "UNIT" }, NOT: { tag: tag as (typeof LINE_ITEM_TAGS)[number] } } },
  });
}

// Corrections to existing contacts. Each write is scoped to the tenant and
// the distributor again, so an id that slipped past resolution still
// touches nothing.
async function applyContactEdits(organizationId: string, distributorId: string | null, data: Resolved) {
  if (!distributorId || data.contactEdits.length === 0) return;
  await prisma.$transaction(
    data.contactEdits.map((edit) =>
      prisma.distributorContact.updateMany({
        where: { id: edit.id, organizationId, distributorId },
        data: { name: edit.name, email: edit.email, phone: edit.phone },
      }),
    ),
  );
}

function contactWrites(organizationId: string, distributorId: string | null, data: Resolved) {
  if (!distributorId) return { connect: [], create: [] };
  return {
    connect: data.contactIds.map((id) => ({ id })),
    create: data.newContacts.map((contact) => ({
      organizationId,
      distributorId,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
    })),
  };
}

// A product's supplier rows after a save of the form: rows taken off go
// (only those the person removed — never one added elsewhere since the
// page was opened), the posted rows take what was typed, the starred
// supplier gets a row at the form's COGS and MSRP if it has none (a
// distributor just added or picked), the star moves to it, and the
// product carries its numbers. "— None —" in the Distributor box takes
// every supplier off.
async function saveSupplierRows(
  organizationId: string,
  productId: string,
  starId: string | null,
  data: Resolved,
  // The product's COGS and MSRP before this save, for an existing product.
  before: { costCents: number; listPriceCents: number | null } | null,
) {
  if (!starId) {
    await prisma.productSupplier.deleteMany({ where: { organizationId, productId } });
    return;
  }
  const removed = data.removedSuppliers.filter((id) => id !== starId);
  if (removed.length > 0) {
    await prisma.productSupplier.deleteMany({ where: { organizationId, productId, distributorId: { in: removed } } });
  }
  const posted = new Map(data.suppliers.map((row) => [row.distributorId, row]));
  // The COGS or MSRP box typed while the starred row was left alone: a
  // save posted before the page's JavaScript ran (the rows are then the
  // page as it loaded), or a star picked by a name that turned out to be
  // a supplier already on the product. What was typed is that supplier's
  // price — never over a discount, which makes the COGS box read-only.
  const starPosted = posted.get(starId);
  if (starPosted && before) {
    const stored = await prisma.productSupplier.findUnique({
      where: { productId_distributorId: { productId, distributorId: starId } },
      select: { costCents: true, discountBp: true, listPriceCents: true },
    });
    if (stored) {
      const next = { ...starPosted };
      const costLeft = starPosted.costCents === stored.costCents && starPosted.discountBp === stored.discountBp;
      if (costLeft && starPosted.discountBp <= 0 && data.scalars.costCents !== before.costCents) {
        next.costCents = data.scalars.costCents;
      }
      if (starPosted.listPriceCents === stored.listPriceCents && data.scalars.listPriceCents !== before.listPriceCents) {
        next.listPriceCents = data.scalars.listPriceCents;
      }
      posted.set(starId, next);
    }
  }
  if (!posted.has(starId)) {
    const existing = await prisma.productSupplier.findUnique({
      where: { productId_distributorId: { productId, distributorId: starId } },
      select: { id: true },
    });
    if (!existing) {
      posted.set(starId, {
        distributorId: starId,
        costCents: data.scalars.costCents,
        discountBp: 0,
        listPriceCents: data.scalars.listPriceCents,
        minMarginBp: null,
      });
    }
  }
  for (const row of posted.values()) {
    if (removed.includes(row.distributorId)) continue;
    const values = {
      costCents: row.costCents,
      discountBp: row.discountBp,
      listPriceCents: row.listPriceCents,
      minMarginBp: row.minMarginBp,
    };
    await prisma.productSupplier.upsert({
      where: { productId_distributorId: { productId, distributorId: row.distributorId } },
      create: { organizationId, productId, distributorId: row.distributorId, ...values },
      update: values,
    });
  }
  await starSupplier(prisma, organizationId, productId, starId);
  await syncProductFromStar(prisma, organizationId, productId);
}

// The people linked to a product after a save: the starred supplier's as
// ticked on the form, and every other supplier's people left where they
// were — the form only shows the starred one's, so it can't have meant to
// unlink anyone else's. A supplier taken off takes its people with it.
async function contactsAfterSave(organizationId: string, productId: string, starId: string | null, data: Resolved) {
  const current = await prisma.distributorContact.findMany({
    where: { organizationId, products: { some: { id: productId } } },
    select: { id: true, distributorId: true },
  });
  const rows = await prisma.productSupplier.findMany({ where: { organizationId, productId }, select: { distributorId: true } });
  const staying = new Set(rows.map((row) => row.distributorId));
  for (const row of data.suppliers) staying.add(row.distributorId);
  for (const id of data.removedSuppliers) staying.delete(id);
  if (!starId) staying.clear();
  const kept = current
    .filter((contact) => contact.distributorId !== starId && staying.has(contact.distributorId))
    .map((contact) => ({ id: contact.id }));
  return [...data.contactIds.map((id) => ({ id })), ...kept];
}

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const resolved = await resolveProductInput(formData, organizationId);
  if (!resolved.ok) return { error: resolved.error };
  const { scalars } = resolved.data;
  const contacts = contactWrites(organizationId, scalars.distributorId, resolved.data);
  await applyContactEdits(organizationId, scalars.distributorId, resolved.data);

  const made = await prisma.product.create({
    data: {
      organizationId,
      ...scalars,
      distributorContacts: { connect: contacts.connect, create: contacts.create },
    },
    select: { id: true },
  });
  await saveSupplierRows(organizationId, made.id, scalars.distributorId, resolved.data, null);
  await saveVariations(organizationId, made.id, scalars.defaultTag, resolved.data);

  revalidatePath("/dashboard/products");
  // Onto the new product's page, where its pictures go (Taylor, Nov 5).
  redirect(`/dashboard/products/${made.id}?added=1`);
}

export async function updateProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const id = idSchema.safeParse(formData.get("productId"));
  if (!id.success) return { error: "Missing product reference" };

  // Ownership first, so nothing below (including the lookups that create
  // manufacturers and distributors) runs for a product that isn't ours.
  const existing = await prisma.product.findFirst({
    where: { id: id.data, organizationId },
    select: { id: true, costCents: true, listPriceCents: true, customUnitId: true },
  });
  if (!existing) return { error: "Product not found" };

  const resolved = await resolveProductInput(formData, organizationId, existing.customUnitId);
  if (!resolved.ok) return { error: resolved.error };
  const { scalars } = resolved.data;
  const contacts = contactWrites(organizationId, scalars.distributorId, resolved.data);
  await applyContactEdits(organizationId, scalars.distributorId, resolved.data);

  // The rows brought up to date with the product as it is stored, before
  // this save writes the product: afterwards it would be the typed values
  // the rows were being compared with.
  await repairSupplierRows(organizationId, [existing.id]);
  const linked = await contactsAfterSave(organizationId, existing.id, scalars.distributorId, resolved.data);
  await prisma.product.update({
    where: { id: existing.id },
    data: {
      ...scalars,
      // `set` replaces the whole selection, which is what a checkbox list
      // means: unticked contacts come off, ticked ones stay, new ones join
      // — for the starred supplier, whose people the form shows.
      distributorContacts: { set: linked, create: contacts.create },
    },
  });
  await saveSupplierRows(organizationId, existing.id, scalars.distributorId, resolved.data, existing);
  await saveVariations(organizationId, existing.id, scalars.defaultTag, resolved.data);

  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${existing.id}`);
  return { success: "Product saved" };
}

export async function deleteProduct(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("productId"));
  if (!id.success) return;

  // Line items keep their copied name/price (productId is SetNull), so
  // deleting a product never rewrites a quote that already went out.
  await prisma.product.deleteMany({ where: { id: id.data, organizationId } });
  // Its pictures stay only where a sent quote line went out with them.
  await sweepUnusedPictures(organizationId);

  revalidatePath("/dashboard/products");
  // Back to the view the delete was made from — the search, filters and
  // page — so clearing out a supplier's old items isn't a fresh search each
  // time. Only ever the Products list itself.
  const returnTo = formData.get("returnTo");
  redirect(
    typeof returnTo === "string" && /^\/dashboard\/products(\?[^#\\]*)?$/.test(returnTo) ? returnTo : "/dashboard/products",
  );
}

// Copies every field onto a new product and lands on its edit page, since
// a clone is nearly always the starting point for a variant. The SKU is
// left blank: a code that identifies one item shouldn't identify two.
export async function cloneProduct(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("productId"));
  if (!id.success) return;

  await repairSupplierRows(organizationId, [id.data]);
  const source = await prisma.product.findFirst({
    where: { id: id.data, organizationId },
    include: {
      distributorContacts: { select: { id: true } },
      suppliers: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { distributorId: true, costCents: true, discountBp: true, listPriceCents: true, minMarginBp: true, preferredFor: true },
      },
      variations: { select: { optionId: true } },
    },
  });
  if (!source) return;

  const clone = await prisma.product.create({
    data: {
      organizationId,
      name: `${source.name} (copy)`,
      description: source.description,
      sku: null,
      unitPriceCents: source.unitPriceCents,
      costCents: source.costCents,
      listPriceCents: source.listPriceCents,
      defaultTag: source.defaultTag,
      serviceType: source.serviceType,
      unitOfMeasure: source.unitOfMeasure,
      customUnitId: source.customUnitId,
      softwareRate: source.softwareRate,
      softwareTerm: source.softwareTerm,
      manufacturerId: source.manufacturerId,
      distributorId: source.distributorId,
      active: source.active,
      distributorContacts: { connect: source.distributorContacts },
      // Every supplier comes along; the clone's star is its own.
      suppliers: {
        create: source.suppliers.map((row) => ({
          organizationId,
          distributorId: row.distributorId,
          costCents: row.costCents,
          discountBp: row.discountBp,
          listPriceCents: row.listPriceCents,
          minMarginBp: row.minMarginBp,
        })),
      },
    },
    select: { id: true },
  });
  const starred = source.suppliers.find((row) => row.preferredFor);
  if (starred) await starSupplier(prisma, organizationId, clone.id, starred.distributorId);
  // Its labels (retired ones too) and its pictures, which share the
  // source's files.
  if (source.variations.length) {
    await prisma.productVariation.createMany({
      data: source.variations.map((row) => ({ organizationId, productId: clone.id, optionId: row.optionId })),
      skipDuplicates: true,
    });
  }
  await copyPicturesTo(organizationId, source.id, clone.id);

  revalidatePath("/dashboard/products");
  redirect(`/dashboard/products/${clone.id}`);
}

export async function toggleProductActive(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("productId"));
  if (!id.success) return;

  const product = await prisma.product.findFirst({
    where: { id: id.data, organizationId },
    select: { id: true, active: true },
  });
  if (!product) return;

  await prisma.product.update({
    where: { id: product.id },
    data: { active: !product.active },
  });

  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${product.id}`);
}
