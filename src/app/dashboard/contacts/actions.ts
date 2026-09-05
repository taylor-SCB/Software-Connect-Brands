"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  company: z.string().trim().optional().or(z.literal("")),
  status: z.enum(["LEAD", "CUSTOMER", "ARCHIVED"]),
});

export async function createContact(_prevState: { error?: string }, formData: FormData) {
  const { organizationId } = await requireSession();

  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    company: formData.get("company"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { name, email, phone, company, status } = parsed.data;

  const contact = await prisma.contact.create({
    data: {
      organizationId,
      name,
      email: email || null,
      phone: phone || null,
      company: company || null,
      status,
    },
  });

  redirect(`/dashboard/contacts/${contact.id}`);
}

export async function addNote(_prevState: { error?: string }, formData: FormData) {
  const { organizationId, userId } = await requireSession();
  const contactId = formData.get("contactId") as string;
  const body = (formData.get("body") as string)?.trim();

  if (!body) {
    return { error: "Note can't be empty" };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
  });
  if (!contact) {
    return { error: "Contact not found" };
  }

  await prisma.note.create({
    data: { organizationId, contactId, authorId: userId, body },
  });

  revalidatePath(`/dashboard/contacts/${contactId}`);
  return { error: undefined };
}

export async function createDealForContact(
  _prevState: { error?: string },
  formData: FormData,
) {
  const { organizationId } = await requireSession();
  const contactId = formData.get("contactId") as string;
  const title = (formData.get("title") as string)?.trim();
  const valueDollars = Number(formData.get("value") ?? 0);

  if (!title) {
    return { error: "Deal title is required" };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
  });
  if (!contact) {
    return { error: "Contact not found" };
  }

  await prisma.deal.create({
    data: {
      organizationId,
      contactId,
      title,
      valueCents: Math.round((Number.isFinite(valueDollars) ? valueDollars : 0) * 100),
    },
  });

  revalidatePath(`/dashboard/contacts/${contactId}`);
  return { error: undefined };
}
