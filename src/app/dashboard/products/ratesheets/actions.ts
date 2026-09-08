"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, optionalText, type ActionState } from "@/lib/forms";
import { publicToken } from "@/lib/tokens";
import { RATESHEET_VISIBILITIES } from "@/lib/constants";
import { dateInputToUtcNoon, ratesheetState, respondByFor } from "@/lib/ratesheets";

const idSchema = z.string().trim().min(1, "Missing record reference");

const RATESHEETS_PATH = "/dashboard/products/ratesheets";

const ratesheetSchema = z.object({
  name: z.string().trim().min(1, "Give the ratesheet a name").max(160),
  visibility: z.enum(RATESHEET_VISIBILITIES),
  expiresOn: z.string().trim().optional(),
  respondWithinDays: z.string().trim().max(4).optional(),
  partnerEmail: z
    .union([z.literal(""), z.email("Enter the partner's email address")])
    .optional(),
  partnerName: z.string().trim().max(120).optional(),
  productIds: z.array(z.string().trim().min(1)).max(2000),
});

async function resolveRatesheetInput(formData: FormData, organizationId: string) {
  const parsed = parseForm(ratesheetSchema, {
    name: formData.get("name"),
    visibility: formData.get("visibility"),
    expiresOn: formData.get("expiresOn") ?? "",
    respondWithinDays: formData.get("respondWithinDays") ?? "",
    partnerEmail: formData.get("partnerEmail") ?? "",
    partnerName: formData.get("partnerName") ?? "",
    productIds: formData.getAll("productIds"),
  });
  if (!parsed.ok) return parsed;
  const input = parsed.data;

  const expiresOn = input.expiresOn ? dateInputToUtcNoon(input.expiresOn) : null;
  if (input.expiresOn && !expiresOn) return { ok: false as const, error: "That expiry date isn't valid" };

  // Public sheets are simply open until they expire, so the window is
  // dropped server-side no matter what a stale form posted.
  let respondWithinDays: number | null = null;
  if (input.visibility !== "PUBLIC" && input.respondWithinDays) {
    const days = Number.parseInt(input.respondWithinDays, 10);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return { ok: false as const, error: "Approved/Decline Within must be between 1 and 365 days" };
    }
    respondWithinDays = days;
  }

  // Only this workspace's products can go on its ratesheet; anything else
  // in the list is dropped, the same way quote line items are checked.
  let productIds: string[] = [];
  if (input.productIds.length > 0) {
    const owned = await prisma.product.findMany({
      where: { id: { in: input.productIds }, organizationId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((product) => product.id));
    // De-duplicated as well as scoped: the same product twice would trip
    // the (ratesheetId, productId) unique constraint.
    productIds = [...new Set(input.productIds)].filter((id) => ownedIds.has(id));
  }
  if (productIds.length === 0) {
    return { ok: false as const, error: "Pick at least one product for the ratesheet" };
  }

  return {
    ok: true as const,
    data: {
      name: input.name,
      visibility: input.visibility,
      expiresOn,
      respondWithinDays,
      partnerEmail: input.partnerEmail ? input.partnerEmail.toLowerCase() : null,
      partnerName: optionalText(formData.get("partnerName")),
      productIds,
    },
  };
}

export async function createRatesheet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const resolved = await resolveRatesheetInput(formData, organizationId);
  if (!resolved.ok) return { error: resolved.error };
  const input = resolved.data;

  if (input.visibility === "PARTNER_SPECIFIC" && !input.partnerEmail) {
    return { error: "Enter the email address of the partner to send this to" };
  }

  const sentAt = new Date();
  const ratesheet = await prisma.ratesheet.create({
    data: {
      organizationId,
      name: input.name,
      visibility: input.visibility,
      expiresOn: input.expiresOn,
      respondWithinDays: input.respondWithinDays,
      publicToken: publicToken(),
      items: {
        create: input.productIds.map((productId, position) => ({ productId, position })),
      },
      ...(input.visibility === "PARTNER_SPECIFIC" && input.partnerEmail
        ? {
            invites: {
              create: {
                organizationId,
                partnerEmail: input.partnerEmail,
                partnerName: input.partnerName,
                token: publicToken(),
                sentAt,
                respondBy: respondByFor(sentAt, input.respondWithinDays),
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });

  revalidatePath(RATESHEETS_PATH);
  redirect(`${RATESHEETS_PATH}/${ratesheet.id}?created=1`);
}

export async function updateRatesheet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const id = idSchema.safeParse(formData.get("ratesheetId"));
  if (!id.success) return { error: "Missing ratesheet reference" };

  const existing = await prisma.ratesheet.findFirst({
    where: { id: id.data, organizationId },
    select: { id: true },
  });
  if (!existing) return { error: "Ratesheet not found" };

  const resolved = await resolveRatesheetInput(formData, organizationId);
  if (!resolved.ok) return { error: resolved.error };
  const input = resolved.data;

  await prisma.ratesheet.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      visibility: input.visibility,
      expiresOn: input.expiresOn,
      respondWithinDays: input.respondWithinDays,
      // The product list is replaced wholesale: what is ticked is the sheet.
      items: {
        deleteMany: {},
        create: input.productIds.map((productId, position) => ({ productId, position })),
      },
    },
  });

  revalidatePath(RATESHEETS_PATH);
  revalidatePath(`${RATESHEETS_PATH}/${existing.id}`);
  return { success: "Ratesheet saved. Changes to the window apply to new sends only." };
}

export async function toggleRatesheetActive(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("ratesheetId"));
  if (!id.success) return;

  const ratesheet = await prisma.ratesheet.findFirst({
    where: { id: id.data, organizationId },
    select: { id: true, active: true },
  });
  if (!ratesheet) return;

  await prisma.ratesheet.update({
    where: { id: ratesheet.id },
    data: { active: !ratesheet.active },
  });

  revalidatePath(RATESHEETS_PATH);
  revalidatePath(`${RATESHEETS_PATH}/${ratesheet.id}`);
}

export async function deleteRatesheet(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("ratesheetId"));
  if (!id.success) return;

  // Items and invites cascade; the partner links stop resolving.
  await prisma.ratesheet.deleteMany({ where: { id: id.data, organizationId } });

  revalidatePath(RATESHEETS_PATH);
  redirect(RATESHEETS_PATH);
}

// Sends the sheet to one more partner: creates the invite and its link.
// Nothing emails it (the app sends no email yet) — the link is shown on
// the page to copy, exactly as quote links are today.
export async function sendRatesheetInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(
    z.object({
      ratesheetId: idSchema,
      partnerEmail: z.email("Enter the partner's email address"),
      partnerName: z.string().trim().max(120).optional(),
    }),
    {
      ratesheetId: formData.get("ratesheetId"),
      partnerEmail: String(formData.get("partnerEmail") ?? "").trim().toLowerCase(),
      partnerName: formData.get("partnerName") ?? "",
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const ratesheet = await prisma.ratesheet.findFirst({
    where: { id: parsed.data.ratesheetId, organizationId },
    select: { id: true, active: true, expiresOn: true, respondWithinDays: true },
  });
  if (!ratesheet) return { error: "Ratesheet not found" };
  if (ratesheetState(ratesheet) !== "ACTIVE") {
    return { error: "This ratesheet is inactive or expired — reactivate it or move the expiry date first" };
  }

  const sentAt = new Date();
  await prisma.ratesheetInvite.create({
    data: {
      organizationId,
      ratesheetId: ratesheet.id,
      partnerEmail: parsed.data.partnerEmail,
      partnerName: optionalText(formData.get("partnerName")),
      token: publicToken(),
      sentAt,
      respondBy: respondByFor(sentAt, ratesheet.respondWithinDays),
    },
  });

  revalidatePath(RATESHEETS_PATH);
  revalidatePath(`${RATESHEETS_PATH}/${ratesheet.id}`);
  return { success: "Link created — copy it from the list below and send it to your partner." };
}

// ------------------------------------------------------------------
// Uploaded ratesheet files ("Link Ratesheet → Upload File")
// ------------------------------------------------------------------

// Mirrored in link-ratesheet-button.tsx, which refuses bigger files
// before the request is even sent. ("use server" files can only export
// functions, so the number lives in both places.)
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function uploadLinkedRatesheet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload" };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is over 4 MB. Export a smaller version and try again." };

  const fileName = file.name.trim().slice(0, 200) || "ratesheet";
  const name = optionalText(formData.get("name"))?.slice(0, 160) ?? fileName.replace(/\.[^.]+$/, "");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const linked = await prisma.linkedRatesheet.create({
    data: {
      organizationId,
      name,
      fileName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: bytes.byteLength,
      data: bytes,
    },
    select: { id: true },
  });

  revalidatePath(RATESHEETS_PATH);
  redirect(`${RATESHEETS_PATH}?uploaded=${linked.id}`);
}

export async function deleteLinkedRatesheet(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("linkedRatesheetId"));
  if (!id.success) return;

  await prisma.linkedRatesheet.deleteMany({ where: { id: id.data, organizationId } });
  revalidatePath(RATESHEETS_PATH);
}
