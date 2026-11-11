"use server";

// Import Ratesheet: the server half. The dialog shows a preview from the
// same planner (src/lib/price-list.ts); nothing it computed is trusted
// here. The file is read again, planned again against the catalog as it
// is now, and only the rows the person ticked are written.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireSession } from "@/lib/session";
import { sheetDiscountFor, storeRatesheetLines } from "@/lib/ratesheet-lines";
import { applyRatesheetRows } from "@/lib/ratesheet-apply";
import { catalogByKeys, catalogBySupplier, catalogKeys, loadCatalogFor, type CatalogRow } from "@/lib/ratesheet-catalog";
import { linkDistributorCompany } from "@/lib/distributors";
import { findPlatformSupplier, linkPlatformSupplier, NOT_LISTED, squeeze } from "@/lib/platform-suppliers";
import { readPriceListFile, priceListFileKind, unsupportedFileMessage } from "@/lib/price-list-file";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/email-marketing";
import {
  COLUMN_ROLES,
  EXISTING_MODES,
  MAX_RATESHEET_BYTES,
  PRICE_RULES,
  describeRule,
  detectTabs,
  headerSignature,
  planRatesheet,
  pricingError,
  type CatalogSupplierRow,
  type ColumnRole,
  type PlanRow,
  type PricingOptions,
  type TabLayout,
} from "@/lib/price-list";

const PRODUCTS_PATH = "/dashboard/products";
const RATESHEETS_PATH = "/dashboard/products/ratesheets";
// The most rows a sheet can bring (the planner reads up to 25,000), with
// room to spare: what the screen may post as ticked or typed.
const MAX_POSTED_ROWS = 30_000;

const tabsSchema = z
  .array(
    z.object({
      sheetIndex: z.number().int().min(0).max(200),
      included: z.boolean(),
      roles: z.array(z.enum(COLUMN_ROLES)).max(500),
    }),
  )
  .min(1)
  .max(200);

const pricingSchema = z.object({
  rule: z.enum(PRICE_RULES),
  basisPoints: z.number().int().min(0).max(100_000),
  whenCostUp: z.enum(EXISTING_MODES),
  whenCostDown: z.enum(EXISTING_MODES),
});

const newContactSchema = z.object({
  firstName: z.string().trim().max(60),
  lastName: z.string().trim().max(60),
  email: z.union([z.literal(""), z.email("Enter a valid email for the point of contact")]),
  phone: z.string().trim().max(40),
});

function readJson(formData: FormData, name: string): unknown {
  const raw = formData.get(name);
  if (typeof raw !== "string" || raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function text(formData: FormData, name: string, max = 200) {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

// ------------------------------------------------------------------
// The catalog, as much of it as one sheet can touch
// ------------------------------------------------------------------

// The preview's read, in pieces small enough to come back under the
// hosting's response limit on a 25,000-row sheet: either the products
// matching a batch of the sheet's keys, or one page of the supplier's own.
// Each row goes back as a tuple to keep the response small.
export type CatalogTuple = [
  id: string,
  name: string,
  sku: string | null,
  costCents: number,
  unitPriceCents: number,
  listPriceCents: number | null,
  distributorId: string | null,
  active: boolean,
  createdAtMs: number,
  suppliers: CatalogSupplierRow[],
];
const CATALOG_BATCH = 5000;

export async function loadRatesheetCatalog(
  input: unknown,
): Promise<{ rows: CatalogTuple[]; supplierNames: Record<string, string>; next: string | null }> {
  const { organizationId } = await requireSession();
  const empty = { rows: [], supplierNames: {}, next: null };
  const parsed = z
    .union([
      z.object({
        skus: z.array(z.string().max(80)).max(CATALOG_BATCH),
        names: z.array(z.string().max(200)).max(CATALOG_BATCH),
      }),
      z.object({ supplierId: z.string().trim().min(1).max(60), after: z.string().max(60).nullable() }),
    ])
    .safeParse(input);
  if (!parsed.success) return empty;

  let rows: CatalogRow[];
  let next: string | null = null;
  if ("supplierId" in parsed.data) {
    const supplierId = parsed.data.supplierId;
    const owned = await prisma.distributor.findFirst({ where: { id: supplierId, organizationId }, select: { id: true } });
    if (!owned) return empty;
    rows = await catalogBySupplier(organizationId, supplierId, parsed.data.after, CATALOG_BATCH);
    if (rows.length === CATALOG_BATCH) next = rows[rows.length - 1].id;
  } else {
    const { skuKeys, nameKeys } = catalogKeys(parsed.data.skus, parsed.data.names);
    rows = await catalogByKeys(organizationId, skuKeys, nameKeys);
  }
  const supplierNames: Record<string, string> = {};
  for (const row of rows) if (row.distributorId && row.distributorName) supplierNames[row.distributorId] = row.distributorName;
  return {
    rows: rows.map((row) => [
      row.id,
      row.name,
      row.sku,
      row.costCents,
      row.unitPriceCents,
      row.listPriceCents,
      row.distributorId,
      row.active,
      row.createdAt.getTime(),
      row.suppliers,
    ]),
    supplierNames,
    next,
  };
}

// ------------------------------------------------------------------
// Shared: the file, the supplier and the column layout off a form
// ------------------------------------------------------------------

type LoadedFile = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array<ArrayBuffer>;
  savedFileId: string | null;
  savedDistributorId: string | null;
  // The sheet's COGS discount (See product list), once it has one: a
  // sheet imported or accepted before. Null for a fresh file or one only
  // uploaded, which takes the supplier's discount from their last sheet.
  discountBp: number | null;
};

// For a Decline the file is evidence, not something to read, so any type
// is taken; one too big to send arrives as its name and size only.
async function loadFile(
  formData: FormData,
  organizationId: string,
  forDecline = false,
): Promise<{ ok: true; file: LoadedFile } | { ok: false; error: string }> {
  const savedFileId = text(formData, "savedFileId", 60);
  if (savedFileId) {
    const saved = await prisma.linkedRatesheet.findFirst({
      where: { id: savedFileId, organizationId },
      select: { id: true, data: true, fileName: true, mimeType: true, distributorId: true, discountBp: true, importedAt: true },
    });
    if (!saved) return { ok: false, error: "That saved file is gone. Choose the file again." };
    // A copy at its exact length: a small bytea comes back as a view
    // into a shared 8 KB buffer, and reading `.buffer` would read the
    // whole pool.
    return {
      ok: true,
      file: {
        fileName: saved.fileName,
        mimeType: saved.mimeType,
        bytes: new Uint8Array(saved.data),
        savedFileId: saved.id,
        savedDistributorId: saved.distributorId,
        discountBp: saved.importedAt ? saved.discountBp : null,
      },
    };
  }

  const file = formData.get("file");
  if (forDecline && !(file instanceof File)) {
    const name = text(formData, "fileName", 200);
    if (!name) return { ok: false, error: "Choose the ratesheet file." };
    return {
      ok: true,
      file: { fileName: name, mimeType: "application/octet-stream", bytes: new Uint8Array(0), savedFileId: null, savedDistributorId: null, discountBp: null },
    };
  }
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the ratesheet file." };
  if (file.size > MAX_RATESHEET_BYTES) return { ok: false, error: "That file is over 4 MB. Ask the supplier for a smaller export, or split it." };
  const fileName = file.name.trim().slice(0, 200) || "ratesheet";
  if (!forDecline && !priceListFileKind(fileName)) return { ok: false, error: unsupportedFileMessage(fileName) };
  return {
    ok: true,
    file: {
      fileName,
      mimeType: file.type || "application/octet-stream",
      bytes: new Uint8Array(await file.arrayBuffer()),
      savedFileId: null,
      savedDistributorId: null,
      discountBp: null,
    },
  };
}

// The posted roles laid over the file's own header rows. A posted tab the
// file doesn't have, or a role list the wrong length, means the file and
// the screen disagree — refused rather than guessed at.
function applyPostedTabs(detected: TabLayout[], posted: z.infer<typeof tabsSchema>): TabLayout[] | null {
  const bySheet = new Map(posted.map((tab) => [tab.sheetIndex, tab]));
  if (posted.some((tab) => !detected.some((found) => found.sheetIndex === tab.sheetIndex))) return null;
  const tabs: TabLayout[] = [];
  for (const tab of detected) {
    const mine = bySheet.get(tab.sheetIndex);
    if (!mine) {
      tabs.push({ ...tab, included: false });
      continue;
    }
    if (mine.roles.length !== tab.headers.length) return null;
    tabs.push({ ...tab, included: mine.included, roles: mine.roles as ColumnRole[] });
  }
  return tabs;
}

// ------------------------------------------------------------------
// Import
// ------------------------------------------------------------------

export type ImportRatesheetResult =
  | {
      ok: true;
      message: string;
      linkedRatesheetId: string;
      supplierId: string;
    }
  | { ok: false; error: string };

export async function importRatesheet(formData: FormData): Promise<ImportRatesheetResult> {
  const { organizationId, userId } = await requireSession();

  const loaded = await loadFile(formData, organizationId);
  if (!loaded.ok) return loaded;
  const { file } = loaded;
  const read = await readPriceListFile(file.fileName, file.bytes.slice().buffer);
  if (!read.ok) return { ok: false, error: read.error };

  const postedTabs = tabsSchema.safeParse(readJson(formData, "tabs"));
  const pricingParsed = pricingSchema.safeParse(readJson(formData, "pricing"));
  const selectedParsed = z.array(z.string().max(40)).max(MAX_POSTED_ROWS).safeParse(readJson(formData, "selected"));
  const overridesParsed = z
    .record(z.string().max(40), z.number().int().min(0).max(2_000_000_000))
    .refine((map) => Object.keys(map).length <= MAX_POSTED_ROWS)
    .safeParse(readJson(formData, "overrides") ?? {});
  if (!postedTabs.success || !pricingParsed.success || !selectedParsed.success || !overridesParsed.success) {
    return { ok: false, error: "The import screen sent something the server couldn't read. Close it and try again." };
  }
  const pricing: PricingOptions = pricingParsed.data;
  const pricingProblem = pricingError(pricing);
  if (pricingProblem) return { ok: false, error: pricingProblem };

  const tabs = applyPostedTabs(detectTabs(read.sheets), postedTabs.data);
  if (!tabs) return { ok: false, error: "That file doesn't match what's on screen anymore. Choose it again." };
  if (!tabs.some((tab) => tab.included)) return { ok: false, error: "Tick at least one tab to import." };

  // Everything that can refuse is checked before anything is written: a
  // new supplier or contact must not be left behind by an import that
  // then says no.
  const supplierId = text(formData, "supplierId", 60);
  const newSupplierName = text(formData, "newSupplierName", 160);
  const platformSupplierId = text(formData, "platformSupplierId", 60);
  let existingSupplier: { id: string; name: string } | null = null;
  let platformSupplier: { id: string; name: string } | null = null;
  // The supplier already on file that a platform pick lands on: the one
  // the preview used for its products, people and settings.
  let platformTwin: { id: string; name: string } | null = null;
  if (supplierId) {
    existingSupplier = await prisma.distributor.findFirst({
      where: { id: supplierId, organizationId },
      select: { id: true, name: true },
    });
    if (!existingSupplier) return { ok: false, error: "That supplier no longer exists. Pick who sent the ratesheet again." };
  } else if (platformSupplierId) {
    // Picked from "On Software Connect Brands". Linked only once the
    // import is sure to go in, like a new name; one linked here already is
    // simply that supplier.
    platformSupplier = await findPlatformSupplier(organizationId, platformSupplierId);
    if (!platformSupplier) return { ok: false, error: NOT_LISTED };
    existingSupplier = await prisma.distributor.findUnique({
      where: { organizationId_platformOrganizationId: { organizationId, platformOrganizationId: platformSupplier.id } },
      select: { id: true, name: true },
    });
    if (!existingSupplier) {
      // Spaces squeezed on both sides, as the screen compares them.
      const twins = await prisma.$queryRaw<{ id: string; name: string }[]>`
        SELECT "id", "name" FROM "Distributor"
         WHERE "organizationId" = ${organizationId}
           AND lower(regexp_replace(btrim("name"), '\\s+', ' ', 'g')) = lower(${squeeze(platformSupplier.name)})
           AND "platformOrganizationId" IS NULL
         ORDER BY "createdAt" ASC
         LIMIT 1`;
      platformTwin = twins[0] ?? null;
    }
  } else if (!newSupplierName) {
    return { ok: false, error: "Pick who sent this ratesheet: a distributor, manufacturer or software provider." };
  }

  const pickedContact = text(formData, "contactId", 60);
  const typedRaw = readJson(formData, "newContact");
  let typed: { name: string; email: string | null; phone: string | null } | null = null;
  const contactOwner = existingSupplier ?? platformTwin;
  if (pickedContact) {
    if (!contactOwner) return { ok: false, error: "Pick the point of contact again." };
    const owned = await prisma.distributorContact.findFirst({
      where: { id: pickedContact, organizationId, distributorId: contactOwner.id },
      select: { id: true },
    });
    if (!owned) return { ok: false, error: "That point of contact isn't on this supplier anymore. Pick them again." };
  } else if (typedRaw !== undefined) {
    const parsedContact = newContactSchema.safeParse(typedRaw);
    if (!parsedContact.success) return { ok: false, error: parsedContact.error.issues[0]?.message ?? "Check the point of contact." };
    const contact = parsedContact.data;
    const name = `${contact.firstName} ${contact.lastName}`.trim();
    const anything = name || contact.email || contact.phone;
    if (anything && !name) return { ok: false, error: "Type the point of contact's first or last name." };
    if (name) typed = { name, email: contact.email ? contact.email.toLowerCase() : null, phone: contact.phone || null };
  }

  const effectiveRaw = text(formData, "effectiveOn", 10);
  const effectiveOn = /^\d{4}-\d{2}-\d{2}$/.test(effectiveRaw) ? new Date(`${effectiveRaw}T00:00:00.000Z`) : null;

  // Plan against the catalog as it is now, importing exactly the rows
  // that were ticked. A supplier still to be made has no products yet.
  let discountBp = 0;
  const planFor = async (forSupplierId: string | null) => {
    discountBp = await sheetDiscountFor(organizationId, file.discountBp, forSupplierId);
    const outline = planRatesheet({ sheets: read.sheets, tabs, catalog: [], supplierId: forSupplierId, pricing });
    const catalog = await loadCatalogFor(
      organizationId,
      forSupplierId,
      outline.rows.map((row) => row.sku ?? "").filter(Boolean),
      outline.rows.map((row) => row.name),
    );
    const plan = planRatesheet({
      sheets: read.sheets,
      tabs,
      catalog,
      supplierId: forSupplierId,
      pricing,
      overrides: overridesParsed.data,
      selected: selectedParsed.data,
      costDiscountBp: discountBp,
    });
    return { catalog, plan };
  };
  const plannedFor = existingSupplier?.id ?? platformTwin?.id ?? null;
  let { plan } = await planFor(plannedFor);
  if (!plan.rows.some((row) => row.included)) return { ok: false, error: "Tick at least one product to import." };

  // Who sent it: an existing supplier, or a new one (which also makes the
  // matching Company, like everywhere else a supplier is added). A name
  // already on file is that supplier, so the plan is redone for it.
  //
  // A pick or a typed name that lands on a supplier already on file other
  // than the one the preview planned for (a renamed company, an account
  // whose name is a company of yours) is refused, not re-planned: the
  // preview showed that supplier's products as someone else's, at another
  // discount, so what it would save isn't what was shown.
  // Who was on file before this import could make anyone (ids, not
  // timestamps: the app's clock and the database's needn't agree), and
  // whose products the screen's preview was worked out for (blank for a
  // new supplier; an older screen that doesn't say is taken at the
  // server's own reading).
  const onFileBefore = new Map(
    (
      await prisma.distributor.findMany({
        where: { organizationId },
        select: { id: true, name: true, platformOrganizationId: true },
      })
    ).map((row) => [row.id, row]),
  );
  const previewed = formData.has("previewSupplierId") ? text(formData, "previewSupplierId", 60) || null : plannedFor;
  const unplanned = (distributorId: string) => {
    if (distributorId === previewed || !onFileBefore.has(distributorId)) return null;
    return `${onFileBefore.get(distributorId)!.name} is already one of your suppliers. Pick it under "Who sent it?" so the preview shows what changes on its products, then import.`;
  };
  let supplier: { id: string; name: string };
  if (existingSupplier) {
    const refused = unplanned(existingSupplier.id);
    if (refused) return { ok: false, error: refused };
    supplier = existingSupplier;
  } else if (platformSupplier) {
    const linked = await linkPlatformSupplier(organizationId, platformSupplier.id, userId);
    if (!linked.ok) return { ok: false, error: linked.error };
    const refused = unplanned(linked.distributorId);
    if (refused) {
      // Nothing goes in, so the link this import just made comes off too:
      // left on, the next click would find it and import as that supplier.
      if (onFileBefore.get(linked.distributorId)?.platformOrganizationId === null) {
        await prisma.distributor.updateMany({
          where: { id: linked.distributorId, organizationId, platformOrganizationId: platformSupplier.id },
          data: { platformOrganizationId: null, platformLinkedAs: null, platformLinkedAt: null },
        });
      }
      return { ok: false, error: refused };
    }
    supplier = { id: linked.distributorId, name: linked.name };
    if (supplier.id !== plannedFor) ({ plan } = await planFor(supplier.id));
  } else {
    const linked = await linkDistributorCompany(organizationId, newSupplierName, userId);
    if (!linked) return { ok: false, error: "Type the distributor's name." };
    const refused = unplanned(linked.distributorId);
    if (refused) return { ok: false, error: refused };
    supplier = { id: linked.distributorId, name: linked.name };
    ({ plan } = await planFor(supplier.id));
  }

  // The point of contact. A typed one already on file (same email, or the
  // same name when there is no email) is reused rather than made twice —
  // compared here in code, since Prisma's case-insensitive equals is a
  // LIKE that reads _ and % in an address as wildcards.
  // A contact picked off the supplier the preview showed, if the account
  // went onto a different one after all, isn't theirs.
  let contactId: string | null = pickedContact && contactOwner?.id === supplier.id ? pickedContact : null;
  if (typed) {
    const people = await prisma.distributorContact.findMany({
      where: { organizationId, distributorId: supplier.id },
      select: { id: true, name: true, email: true },
    });
    const same = people.find((person) =>
      typed.email
        ? person.email?.toLowerCase() === typed.email
        : !person.email && person.name.trim().toLowerCase() === typed.name.toLowerCase(),
    );
    contactId =
      same?.id ??
      (
        await prisma.distributorContact.create({
          data: { organizationId, distributorId: supplier.id, name: typed.name, email: typed.email, phone: typed.phone },
          select: { id: true },
        })
      ).id;
  }

  const rows = plan.rows.filter((row) => row.included);
  if (rows.length === 0) return { ok: false, error: "Tick at least one product to import." };

  // The file is saved first and its counts filled in last, so a write that
  // fails halfway leaves a record of which sheet it was, with no counts.
  const linkedId = file.savedFileId
    ? (
        await prisma.linkedRatesheet.update({
          where: { id: file.savedFileId },
          data: { distributorId: supplier.id, effectiveOn, discountBp },
          select: { id: true },
        })
      ).id
    : (
        await prisma.linkedRatesheet.create({
          data: {
            organizationId,
            name: `${supplier.name} — ${file.fileName.replace(/\.[^.]+$/, "")}`.slice(0, 160),
            fileName: file.fileName,
            mimeType: file.mimeType,
            sizeBytes: file.bytes.byteLength,
            data: file.bytes,
            distributorId: supplier.id,
            effectiveOn,
            discountBp,
          },
          select: { id: true },
        })
      ).id;

  const { createdByKey, starUpdates, secondUpdates } = await applyRatesheetRows({
    organizationId,
    supplierId: supplier.id,
    linkedRatesheetId: linkedId,
    discountBp,
    rows,
  });
  const updates = [...starUpdates, ...secondUpdates];
  const createdIds = [...createdByKey.values()];

  // The rep picked for this sheet goes on every product it touched. Nobody
  // else's comes off: a product bought from two suppliers keeps both
  // suppliers' people.
  if (contactId) {
    const touched = [...createdIds, ...updates.map((row) => row.match!.id)];
    for (let start = 0; start < touched.length; start += 2000) {
      await prisma.$executeRaw`
        INSERT INTO "_DistributorContactToProduct" ("A", "B")
        SELECT ${contactId}, id FROM unnest(${touched.slice(start, start + 2000)}::text[]) AS id
        ON CONFLICT DO NOTHING`;
    }
  }

  let deactivated = 0;
  if (text(formData, "markMissingInactive") === "1" && plan.missing && plan.missing.length > 0) {
    const result = await prisma.product.updateMany({
      where: { id: { in: plan.missing.map((item) => item.id) }, organizationId, distributorId: supplier.id },
      data: { active: false },
    });
    deactivated = result.count;
  }

  // Every product row on the sheet is kept, imported or not, so See
  // product list can show the whole sheet and add more later. Each line
  // remembers the product it is; whether it is in Products is whether
  // that product carries this supplier.
  const supplied = (row: PlanRow) => createdByKey.get(row.key) ?? row.match?.id ?? null;
  await storeRatesheetLines(organizationId, linkedId, plan.rows, supplied);
  // Remember how this supplier's sheet was read and priced, so the next
  // one opens the same way.
  const supplierRecord = await prisma.distributor.findUnique({
    where: { id: supplier.id },
    select: { ratesheetColumns: true },
  });
  const remembered: Record<string, ColumnRole[]> =
    supplierRecord?.ratesheetColumns && typeof supplierRecord.ratesheetColumns === "object" && !Array.isArray(supplierRecord.ratesheetColumns)
      ? { ...(supplierRecord.ratesheetColumns as Record<string, ColumnRole[]>) }
      : {};
  for (const tab of tabs.filter((tab) => tab.included)) {
    delete remembered[headerSignature(tab.headers)];
    remembered[headerSignature(tab.headers)] = tab.roles;
  }
  const keep = Object.keys(remembered).slice(-20);
  await prisma.distributor.update({
    where: { id: supplier.id },
    data: {
      priceRule: pricing.rule,
      priceRuleBasisPoints: pricing.basisPoints,
      ratesheetColumns: Object.fromEntries(keep.map((key) => [key, remembered[key]])),
    },
  });

  const counts = {
    addedCount: createdIds.length,
    // Updated means the product's own cost or price could move; a supplier
    // only added beside the starred one is counted on its own.
    updatedCount: starUpdates.length,
    besideCount: secondUpdates.length,
    costUpCount: rows.filter((row) => row.costChange === "up").length,
    costDownCount: rows.filter((row) => row.costChange === "down").length,
  };
  await prisma.linkedRatesheet.update({
    where: { id: linkedId },
    data: { importedAt: new Date(), ...counts },
  });

  revalidatePath(PRODUCTS_PATH);
  revalidatePath(RATESHEETS_PATH);

  const n = (value: number) => value.toLocaleString("en-US");
  const parts = [`${n(counts.addedCount)} new`, `${n(starUpdates.length)} updated`];
  const moved = [
    counts.costUpCount ? `${n(counts.costUpCount)} cost more` : "",
    counts.costDownCount ? `${n(counts.costDownCount)} cost less` : "",
  ].filter(Boolean);
  const total = counts.addedCount + counts.updatedCount + counts.besideCount;
  let message = `Imported ${n(total)} ${total === 1 ? "product" : "products"} from ${supplier.name}: ${parts.join(", ")}`;
  if (moved.length) message += ` (${moved.join(", ")})`;
  if (counts.besideCount) message += `, ${n(counts.besideCount)} added beside another supplier`;
  message += ".";
  if (deactivated) message += ` ${n(deactivated)} no longer on their list marked inactive.`;
  return { ok: true, message, linkedRatesheetId: linkedId, supplierId: supplier.id };
}

// ------------------------------------------------------------------
// Decline: "this read wrong" — nothing imports, the operator hears
// ------------------------------------------------------------------

export async function declineRatesheet(formData: FormData): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { organizationId, userId, name: userName, email: userEmail } = await requireSession();

  const note = text(formData, "note", 2000);
  if (!note) return { ok: false, error: "Tell us what was wrong with the import, so we can fix how it reads this sheet." };

  const loaded = await loadFile(formData, organizationId, true);
  if (!loaded.ok) return loaded;
  const { file } = loaded;
  // Too big to send: say how big, since the file itself isn't here.
  const sentSize = Number(text(formData, "fileSize", 20)) || 0;
  const fullNote =
    file.bytes.byteLength === 0 && sentSize > 0
      ? `${note}\n\n(The file was ${(sentSize / 1024 / 1024).toFixed(1)} MB, too big to attach.)`
      : note;

  // What the app made of it, rebuilt here from the file rather than
  // taken from the screen.
  const read =
    file.bytes.byteLength > 0 && priceListFileKind(file.fileName)
      ? await readPriceListFile(file.fileName, file.bytes.slice().buffer)
      : ({ ok: false, error: file.bytes.byteLength === 0 ? "The file was too big to send." : unsupportedFileMessage(file.fileName) } as const);
  const detectedTabs = read.ok ? detectTabs(read.sheets) : [];
  const postedTabs = tabsSchema.safeParse(readJson(formData, "tabs"));
  const pricing = pricingSchema.safeParse(readJson(formData, "pricing"));
  const supplierId = text(formData, "supplierId", 60);
  const supplier = supplierId
    ? await prisma.distributor.findFirst({ where: { id: supplierId, organizationId }, select: { id: true, name: true } })
    : null;
  // A supplier picked from Software Connect Brands is only named here;
  // a decline links nothing.
  const platformSupplier = await findPlatformSupplier(organizationId, text(formData, "platformSupplierId", 60));
  const detected = {
    readError: read.ok ? null : read.error,
    supplier: supplier?.name ?? platformSupplier?.name ?? (text(formData, "newSupplierName", 160) || null),
    rule: pricing.success ? describeRule(pricing.data) : null,
    tabs: detectedTabs.map((tab) => {
      const posted = postedTabs.success ? postedTabs.data.find((item) => item.sheetIndex === tab.sheetIndex) : undefined;
      return {
        name: tab.name,
        headerRow: read.ok ? read.sheets[tab.sheetIndex].rows[tab.headerIndex]?.line ?? null : null,
        headers: tab.headers,
        detectedRoles: tab.roles,
        chosenRoles: posted?.roles ?? null,
        included: posted?.included ?? tab.included,
        rows: tab.dataRows,
      };
    }),
  };

  const issue = await prisma.ratesheetImportIssue.create({
    data: {
      organizationId,
      userId,
      distributorId: supplier?.id ?? null,
      note: fullNote,
      detected: detected as Prisma.InputJsonValue,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.byteLength,
      data: file.bytes,
    },
    select: { id: true },
  });

  // Let the operator know. Best effort: the issue is saved either way and
  // waits in /admin.
  if (isEmailConfigured()) {
    const [operators, organization] = await Promise.all([
      prisma.user.findMany({ where: { isSuperAdmin: true, removedAt: null }, select: { email: true } }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    ]);
    const link = await absoluteUrl("/admin#ratesheet-issues");
    for (const operator of operators) {
      await sendEmail({
        to: operator.email,
        subject: `Ratesheet import declined — ${organization?.name ?? "a workspace"}`,
        text: `${userName} (${userEmail}) at ${organization?.name ?? "a workspace"} declined an import of ${file.fileName}.\n\nWhat was wrong: ${note}\n\nOpen it: ${link}`,
        html: [
          `<p><strong>${escapeHtml(userName)}</strong> (${escapeHtml(userEmail)}) at ${escapeHtml(organization?.name ?? "a workspace")} declined an import of <strong>${escapeHtml(file.fileName)}</strong>.</p>`,
          `<p>What was wrong: ${escapeHtml(note)}</p>`,
          `<p><a href="${link}">Open it in the operator console</a></p>`,
        ].join("\n"),
      });
    }
  }

  return { ok: true, message: `Thanks — nothing was imported, and we've got the file and your note (ref ${issue.id.slice(-6)}).` };
}
