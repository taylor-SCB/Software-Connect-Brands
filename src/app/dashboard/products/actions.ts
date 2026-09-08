"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, optionalText, type ActionState } from "@/lib/forms";
import { dollarsToCents } from "@/lib/format";
import {
  LINE_ITEM_TAGS,
  TAG_LABELS,
  UNITS_OF_MEASURE,
  UNIT_GROUP_LABELS,
  SOFTWARE_RATES,
  isSoftwareUnit,
  unitAllowedForTag,
  unitGroupFor,
} from "@/lib/constants";

const idSchema = z.string().trim().min(1, "Missing record reference");

// "__new__" in a pick list means the user typed a name that doesn't exist
// yet; it is created on save so a brand new workspace never hits an empty
// dropdown it can't fill.
const NEW_OPTION = "__new__";

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
  unitOfMeasure: optionalEnum(UNITS_OF_MEASURE),
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
    unitOfMeasure: formData.get("unitOfMeasure") ?? "",
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
    defaultTag: (typeof LINE_ITEM_TAGS)[number];
    unitOfMeasure: (typeof UNITS_OF_MEASURE)[number] | null;
    softwareRate: (typeof SOFTWARE_RATES)[number] | null;
    softwareTerm: number | null;
    manufacturerId: string | null;
    distributorId: string | null;
    active: boolean;
  };
  contactIds: string[];
  newContacts: { name: string; email: string | null; phone: string | null }[];
  contactEdits: { id: string; name: string; email: string | null; phone: string | null }[];
};

// Turns the posted form into something Prisma can write, creating the
// manufacturer, distributor and any new contacts on the way. Everything it
// looks up is scoped to the organization, so an id pasted in from another
// tenant resolves to "not found" rather than to their record.
async function resolveProductInput(
  formData: FormData,
  organizationId: string,
): Promise<{ ok: true; data: Resolved } | { ok: false; error: string }> {
  const parsed = parseForm(productSchema, readInput(formData));
  if (!parsed.ok) return parsed;
  const input = parsed.data;

  const costCents = dollarsToCents(formData.get("cost"));
  if (costCents < 0) return { ok: false, error: "COGS can't be negative" };
  const unitPriceCents = dollarsToCents(formData.get("unitPrice"));

  // Each unit list belongs to a tag: a Labor product can't be "Per
  // Gallon". The form only offers the right list; this is the check for
  // a stale form or a hand-built post.
  const unitOfMeasure = input.unitOfMeasure || null;
  if (!unitAllowedForTag(unitOfMeasure, input.defaultTag)) {
    const group = unitGroupFor(unitOfMeasure);
    return {
      ok: false,
      error: `That unit belongs to the ${group ? UNIT_GROUP_LABELS[group] : "other"} list, not ${TAG_LABELS[input.defaultTag]}`,
    };
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
    const distributor = await prisma.distributor.upsert({
      where: { organizationId_name: { organizationId, name } },
      create: { organizationId, name },
      update: {},
      select: { id: true },
    });
    distributorId = distributor.id;
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

  return {
    ok: true,
    data: {
      scalars: {
        name: input.name,
        description: optionalText(formData.get("description")) ?? "",
        sku: optionalText(formData.get("sku")),
        unitPriceCents,
        costCents,
        defaultTag: input.defaultTag,
        unitOfMeasure,
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

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const resolved = await resolveProductInput(formData, organizationId);
  if (!resolved.ok) return { error: resolved.error };
  const { scalars } = resolved.data;
  const contacts = contactWrites(organizationId, scalars.distributorId, resolved.data);
  await applyContactEdits(organizationId, scalars.distributorId, resolved.data);

  await prisma.product.create({
    data: {
      organizationId,
      ...scalars,
      distributorContacts: { connect: contacts.connect, create: contacts.create },
    },
  });

  revalidatePath("/dashboard/products");
  redirect("/dashboard/products");
}

export async function updateProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const id = idSchema.safeParse(formData.get("productId"));
  if (!id.success) return { error: "Missing product reference" };

  // Ownership first, so nothing below (including the lookups that create
  // manufacturers and distributors) runs for a product that isn't ours.
  const existing = await prisma.product.findFirst({
    where: { id: id.data, organizationId },
    select: { id: true },
  });
  if (!existing) return { error: "Product not found" };

  const resolved = await resolveProductInput(formData, organizationId);
  if (!resolved.ok) return { error: resolved.error };
  const { scalars } = resolved.data;
  const contacts = contactWrites(organizationId, scalars.distributorId, resolved.data);
  await applyContactEdits(organizationId, scalars.distributorId, resolved.data);

  await prisma.product.update({
    where: { id: existing.id },
    data: {
      ...scalars,
      // `set` replaces the whole selection, which is what a checkbox list
      // means: unticked contacts come off, ticked ones stay, new ones join.
      distributorContacts: { set: contacts.connect, create: contacts.create },
    },
  });

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

  revalidatePath("/dashboard/products");
  redirect("/dashboard/products");
}

// Copies every field onto a new product and lands on its edit page, since
// a clone is nearly always the starting point for a variant. The SKU is
// left blank: a code that identifies one item shouldn't identify two.
export async function cloneProduct(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("productId"));
  if (!id.success) return;

  const source = await prisma.product.findFirst({
    where: { id: id.data, organizationId },
    include: { distributorContacts: { select: { id: true } } },
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
      defaultTag: source.defaultTag,
      unitOfMeasure: source.unitOfMeasure,
      softwareRate: source.softwareRate,
      softwareTerm: source.softwareTerm,
      manufacturerId: source.manufacturerId,
      distributorId: source.distributorId,
      active: source.active,
      distributorContacts: { connect: source.distributorContacts },
    },
    select: { id: true },
  });

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
