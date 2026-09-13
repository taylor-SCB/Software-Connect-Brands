"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, type ActionState } from "@/lib/forms";
import { dollarsToCents } from "@/lib/format";
import { CONTACT_STATUSES } from "@/lib/constants";
import { findOrCreateCompany, normalizeState } from "@/lib/companies";
import { ensureIndustryOptions, mergeTags, readIndustryFields } from "@/lib/industries";
import {
  targetSchema,
  readTarget,
  resolveTargets,
  noteBodySchema,
  noteLabelSchema,
  activityTypeSchema,
  activityBodySchema,
} from "@/lib/logging";

import { hasFile, imageProblem, removeImage, replaceImage } from "@/lib/uploads";

const idSchema = z.string().trim().min(1, "Missing record reference");

const contactSchema = z.object({
  name: z.string().trim().min(1, "Contact name is required"),
  title: z.string().trim().max(120).optional(),
  companyName: z.string().trim().max(120).optional(),
  email: z.union([z.literal(""), z.email("Enter a valid email address")]).optional(),
  phone: z.string().trim().max(40).optional(),
  website: z.union([z.literal(""), z.string().trim().max(200)]).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(60).optional(),
  birthday: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Birthday isn't a valid date")]).optional(),
  status: z.enum(CONTACT_STATUSES),
});

// Accepts "acme.com" as well as a full URL — people type the bare domain.
function normalizeWebsite(value: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

// A date input gives "1984-03-09"; store it as that calendar day.
function toBirthday(value: string | undefined) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function readContactForm(formData: FormData) {
  return {
    name: formData.get("name"),
    title: formData.get("title") ?? undefined,
    companyName: formData.get("companyName") ?? undefined,
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    website: formData.get("website") ?? undefined,
    city: formData.get("city") ?? undefined,
    state: formData.get("state") ?? undefined,
    birthday: formData.get("birthday") ?? undefined,
    status: formData.get("status"),
  };
}

async function assertContact(contactId: string, organizationId: string) {
  return prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    select: { id: true },
  });
}

async function contactData(
  parsed: z.infer<typeof contactSchema>,
  organizationId: string,
  formData: FormData,
) {
  const companyId = parsed.companyName
    ? (await findOrCreateCompany(parsed.companyName, organizationId)).id
    : null;
  // Industry and Company Type belong to the company; the contact form
  // edits them in place so one business is never tagged three ways.
  const tags = readIndustryFields(formData);
  if (companyId && tags.touched) {
    const canonical = await ensureIndustryOptions(organizationId, tags.industries, tags.typesByIndustry);
    await prisma.company.updateMany({
      where: { id: companyId, organizationId },
      data: { industries: canonical.industries, companyTypes: mergeTags(canonical.companyTypes, tags.keepTypes) },
    });
  }
  return {
    name: parsed.name,
    title: parsed.title || null,
    companyId,
    email: parsed.email ? parsed.email.toLowerCase() : null,
    phone: parsed.phone || null,
    website: normalizeWebsite(parsed.website || null),
    city: parsed.city || null,
    state: normalizeState(parsed.state || null),
    birthday: toBirthday(parsed.birthday),
    status: parsed.status,
  };
}

export async function createContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(contactSchema, readContactForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const imageFile = formData.get("imageFile");
  const problem = imageProblem(imageFile);
  if (problem) return { error: problem };

  const contact = await prisma.contact.create({
    data: { organizationId, ...(await contactData(parsed.data, organizationId, formData)) },
  });
  if (hasFile(imageFile)) {
    const imageUrl = await replaceImage({ organizationId, kind: "CONTACT_IMAGE", file: imageFile, contactId: contact.id });
    await prisma.contact.update({ where: { id: contact.id }, data: { imageUrl } });
  }

  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  redirect(`/dashboard/contacts/${contact.id}`);
}

export async function updateContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const id = idSchema.safeParse(formData.get("contactId"));
  if (!id.success) return { error: "Missing contact reference" };

  const parsed = parseForm(contactSchema, readContactForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const imageFile = formData.get("imageFile");
  const problem = imageProblem(imageFile);
  if (problem) return { error: problem };

  if (!(await assertContact(id.data, organizationId))) return { error: "Contact not found" };

  const image: { imageUrl?: string | null } = {};
  if (hasFile(imageFile)) {
    image.imageUrl = await replaceImage({ organizationId, kind: "CONTACT_IMAGE", file: imageFile, contactId: id.data });
  } else if (formData.get("removeImage") === "true") {
    await removeImage({ organizationId, kind: "CONTACT_IMAGE", contactId: id.data });
    image.imageUrl = null;
  }

  // updateMany (not update) so the organizationId scope is part of the
  // WHERE clause — a guessed id from another tenant matches zero rows.
  const result = await prisma.contact.updateMany({
    where: { id: id.data, organizationId },
    data: { ...(await contactData(parsed.data, organizationId, formData)), ...image },
  });
  if (result.count === 0) return { error: "Contact not found" };

  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath(`/dashboard/contacts/${id.data}`);
  return { success: "Contact saved" };
}

// The star. Returns the new state so the button can settle on it.
export async function setContactFavorite(
  contactId: string,
  favorite: boolean,
): Promise<{ favorite: boolean } | { error: string }> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contactId);
  if (!id.success) return { error: "Missing contact reference" };
  const result = await prisma.contact.updateMany({
    where: { id: id.data, organizationId },
    data: { favorite: Boolean(favorite) },
  });
  if (result.count === 0) return { error: "Contact not found" };
  revalidatePath("/dashboard/contacts");
  revalidatePath(`/dashboard/contacts/${id.data}`);
  return { favorite: Boolean(favorite) };
}

export async function deleteContact(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("contactId"));
  if (!id.success) return;

  await prisma.contact.deleteMany({ where: { id: id.data, organizationId } });
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  redirect("/dashboard/contacts");
}

function revalidateTarget(primary: { contactId?: string; companyId?: string }) {
  if (primary.contactId) revalidatePath(`/dashboard/contacts/${primary.contactId}`);
  if (primary.companyId) revalidatePath(`/dashboard/companies/${primary.companyId}`);
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard");
}

// Shared by the contact page and the company page. A contact note can be
// fanned out to extra contacts; every copy shares a batchId.
export async function addNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = parseForm(
    z.object({ target: targetSchema, body: noteBodySchema, label: noteLabelSchema }),
    { target: readTarget(formData), body: formData.get("body"), label: formData.get("label") ?? undefined },
  );
  if (!parsed.ok) return { error: parsed.error };

  const targets = await resolveTargets(parsed.data.target, organizationId);
  if (!targets) return { error: "Record not found" };

  await prisma.note.createMany({
    data: targets.rows.map((row) => ({
      organizationId,
      contactId: row.contactId,
      companyId: row.companyId,
      authorId: userId,
      body: parsed.data.body,
      label: parsed.data.label || null,
      batchId: targets.batchId,
    })),
  });

  revalidateTarget(targets.primary);
  const others = targets.rows.length - 1;
  return { success: others > 0 ? `Note added to ${others + 1} contacts` : "Note added" };
}

export async function logActivity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = parseForm(
    z.object({ target: targetSchema, type: activityTypeSchema, body: activityBodySchema }),
    { target: readTarget(formData), type: formData.get("type"), body: formData.get("body") },
  );
  if (!parsed.ok) return { error: parsed.error };

  const targets = await resolveTargets(parsed.data.target, organizationId);
  if (!targets) return { error: "Record not found" };

  await prisma.activity.createMany({
    data: targets.rows.map((row) => ({
      organizationId,
      contactId: row.contactId,
      companyId: row.companyId,
      userId,
      type: parsed.data.type,
      body: parsed.data.body,
      batchId: targets.batchId,
    })),
  });

  revalidateTarget(targets.primary);
  const others = targets.rows.length - 1;
  return { success: others > 0 ? `Logged on ${others + 1} contacts` : "Activity logged" };
}

export async function createDealForContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(
    z.object({
      contactId: idSchema,
      title: z.string().trim().min(1, "Deal title is required").max(160),
    }),
    { contactId: formData.get("contactId"), title: formData.get("title") },
  );
  if (!parsed.ok) return { error: parsed.error };

  if (!(await assertContact(parsed.data.contactId, organizationId))) {
    return { error: "Contact not found" };
  }

  await prisma.deal.create({
    data: {
      organizationId,
      contactId: parsed.data.contactId,
      title: parsed.data.title,
      valueCents: dollarsToCents(formData.get("value")),
    },
  });

  revalidatePath(`/dashboard/contacts/${parsed.data.contactId}`);
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  return { success: "Deal added" };
}
