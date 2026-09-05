"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, optionalText, type ActionState } from "@/lib/forms";
import { dollarsToCents } from "@/lib/format";
import { ACTIVITY_TYPES, CONTACT_STATUSES } from "@/lib/constants";

const idSchema = z.string().trim().min(1, "Missing record reference");

const contactSchema = z.object({
  name: z.string().trim().min(1, "Contact name is required"),
  company: z.string().trim().max(120).optional(),
  email: z.union([z.literal(""), z.email("Enter a valid email address")]).optional(),
  phone: z.string().trim().max(40).optional(),
  website: z
    .union([z.literal(""), z.string().trim().max(200)])
    .optional(),
  status: z.enum(CONTACT_STATUSES),
});

// Accepts "acme.com" as well as a full URL — people type the bare domain.
function normalizeWebsite(value: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

async function assertContact(contactId: string, organizationId: string) {
  return prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    select: { id: true },
  });
}

export async function createContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(contactSchema, {
    name: formData.get("name"),
    company: formData.get("company") ?? undefined,
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    website: formData.get("website") ?? undefined,
    status: formData.get("status"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const contact = await prisma.contact.create({
    data: {
      organizationId,
      name: parsed.data.name,
      company: optionalText(formData.get("company")),
      email: parsed.data.email ? parsed.data.email.toLowerCase() : null,
      phone: optionalText(formData.get("phone")),
      website: normalizeWebsite(optionalText(formData.get("website"))),
      status: parsed.data.status,
    },
  });

  revalidatePath("/dashboard/contacts");
  redirect(`/dashboard/contacts/${contact.id}`);
}

export async function updateContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const id = idSchema.safeParse(formData.get("contactId"));
  if (!id.success) return { error: "Missing contact reference" };

  const parsed = parseForm(contactSchema, {
    name: formData.get("name"),
    company: formData.get("company") ?? undefined,
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    website: formData.get("website") ?? undefined,
    status: formData.get("status"),
  });
  if (!parsed.ok) return { error: parsed.error };

  // updateMany (not update) so the organizationId scope is part of the
  // WHERE clause — a guessed id from another tenant matches zero rows.
  const result = await prisma.contact.updateMany({
    where: { id: id.data, organizationId },
    data: {
      name: parsed.data.name,
      company: optionalText(formData.get("company")),
      email: parsed.data.email ? parsed.data.email.toLowerCase() : null,
      phone: optionalText(formData.get("phone")),
      website: normalizeWebsite(optionalText(formData.get("website"))),
      status: parsed.data.status,
    },
  });
  if (result.count === 0) return { error: "Contact not found" };

  revalidatePath("/dashboard/contacts");
  revalidatePath(`/dashboard/contacts/${id.data}`);
  return { success: "Contact saved" };
}

export async function deleteContact(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("contactId"));
  if (!id.success) return;

  await prisma.contact.deleteMany({ where: { id: id.data, organizationId } });
  revalidatePath("/dashboard/contacts");
  redirect("/dashboard/contacts");
}

export async function addNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = parseForm(
    z.object({
      contactId: idSchema,
      body: z.string().trim().min(1, "Note can't be empty").max(5000),
    }),
    { contactId: formData.get("contactId"), body: formData.get("body") },
  );
  if (!parsed.ok) return { error: parsed.error };

  if (!(await assertContact(parsed.data.contactId, organizationId))) {
    return { error: "Contact not found" };
  }

  await prisma.note.create({
    data: {
      organizationId,
      contactId: parsed.data.contactId,
      authorId: userId,
      body: parsed.data.body,
    },
  });

  revalidatePath(`/dashboard/contacts/${parsed.data.contactId}`);
  revalidatePath("/dashboard/contacts");
  return { success: "Note added" };
}

export async function logActivity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = parseForm(
    z.object({
      contactId: idSchema,
      type: z.enum(ACTIVITY_TYPES),
      body: z.string().trim().min(1, "Add a short summary").max(5000),
    }),
    {
      contactId: formData.get("contactId"),
      type: formData.get("type"),
      body: formData.get("body"),
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  if (!(await assertContact(parsed.data.contactId, organizationId))) {
    return { error: "Contact not found" };
  }

  await prisma.activity.create({
    data: {
      organizationId,
      contactId: parsed.data.contactId,
      userId,
      type: parsed.data.type,
      body: parsed.data.body,
    },
  });

  revalidatePath(`/dashboard/contacts/${parsed.data.contactId}`);
  revalidatePath("/dashboard/contacts");
  return { success: "Activity logged" };
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
  return { success: "Deal added" };
}
