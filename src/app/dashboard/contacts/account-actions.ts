"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { findOrCreateCompany, normalizeState } from "@/lib/companies";

// "+ Additional Account" and the company page's Add person search: one
// person tied to more than one business. The contact's own `company` is
// their main one (their quotes and contracts are filed under it); every
// other company is a ContactAccount row.

export type AccountResult = { error?: string; success?: string; linked?: number };

const MAX_AT_ONCE = 25;

const linkSchema = z.object({
  contactId: z.string().trim().min(1),
  companyIds: z.array(z.string().trim().min(1)).max(MAX_AT_ONCE),
  newCompany: z
    .object({
      name: z.string().trim().min(1, "Name the new company").max(120),
      city: z.string().trim().max(120).optional(),
      state: z.string().trim().max(60).optional(),
    })
    .nullable(),
});

// Links a contact to the companies picked in the search, and to a new
// company typed there. Someone with no company at all gets the first one
// as their main company rather than an extra.
export async function linkContactAccounts(input: {
  contactId: string;
  companyIds: string[];
  newCompany: { name: string; city?: string; state?: string } | null;
}): Promise<AccountResult> {
  const { organizationId } = await requireSession();
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick at least one company" };
  const { contactId, companyIds, newCompany } = parsed.data;

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    select: { id: true, companyId: true },
  });
  if (!contact) return { error: "Contact not found" };

  // Only this workspace's companies; a guessed id from another is dropped.
  const found = companyIds.length
    ? await prisma.company.findMany({ where: { organizationId, id: { in: companyIds } }, select: { id: true } })
    : [];
  const ids = found.map((company) => company.id);

  if (newCompany) {
    const made = await findOrCreateCompany(newCompany.name, organizationId);
    const city = newCompany.city || null;
    const state = normalizeState(newCompany.state || null);
    if (city || state) {
      // Fill what the company is missing; never overwrite what it has.
      const current = await prisma.company.findFirst({ where: { id: made.id, organizationId }, select: { city: true, state: true } });
      await prisma.company.updateMany({
        where: { id: made.id, organizationId },
        data: { city: current?.city || city, state: current?.state || state },
      });
    }
    if (!ids.includes(made.id)) ids.push(made.id);
  }
  if (ids.length === 0) return { error: "Pick at least one company, or add a new one" };

  let primary = contact.companyId;
  const extras = ids.filter((id) => id !== primary);
  if (!primary && extras.length) {
    primary = extras.shift()!;
    await prisma.contact.updateMany({ where: { id: contactId, organizationId }, data: { companyId: primary } });
  }
  if (extras.length) {
    await prisma.contactAccount.createMany({
      data: extras.map((companyId) => ({ organizationId, contactId, companyId })),
      skipDuplicates: true,
    });
  }

  revalidatePath(`/dashboard/contacts/${contactId}`);
  for (const id of ids) revalidatePath(`/dashboard/companies/${id}`);
  revalidatePath("/dashboard/companies");
  const linked = ids.length;
  return { success: linked === 1 ? "Linked 1 company" : `Linked ${linked} companies`, linked };
}

export async function unlinkContactAccount(contactId: string, companyId: string): Promise<AccountResult> {
  const { organizationId } = await requireSession();
  const result = await prisma.contactAccount.deleteMany({ where: { organizationId, contactId, companyId } });
  if (result.count === 0) return { error: "That link is already gone" };
  revalidatePath(`/dashboard/contacts/${contactId}`);
  revalidatePath(`/dashboard/companies/${companyId}`);
  return { success: "Unlinked" };
}

// The company page's Add person search picked someone who already
// exists: they join this company — as their main one when they have none,
// otherwise as an additional account. Their main company never changes
// under them from here.
export async function addExistingPersonToCompany(companyId: string, contactId: string): Promise<AccountResult> {
  const { organizationId } = await requireSession();
  const [company, contact] = await Promise.all([
    prisma.company.findFirst({ where: { id: companyId, organizationId }, select: { id: true, name: true } }),
    prisma.contact.findFirst({ where: { id: contactId, organizationId }, select: { id: true, name: true, companyId: true } }),
  ]);
  if (!company) return { error: "Company not found" };
  if (!contact) return { error: "Contact not found" };

  if (contact.companyId === company.id) return { success: `${contact.name} is already here` };
  if (!contact.companyId) {
    await prisma.contact.updateMany({ where: { id: contact.id, organizationId }, data: { companyId: company.id } });
  } else {
    await prisma.contactAccount.createMany({
      data: [{ organizationId, contactId: contact.id, companyId: company.id }],
      skipDuplicates: true,
    });
  }

  revalidatePath(`/dashboard/companies/${company.id}`);
  revalidatePath(`/dashboard/contacts/${contact.id}`);
  revalidatePath("/dashboard/companies");
  return { success: `${contact.name} added to ${company.name}` };
}

const quickSchema = z.object({
  companyId: z.string().trim().min(1),
  name: z.string().trim().min(1, "Give the new contact a name").max(120),
  email: z.union([z.literal(""), z.email("Enter a valid email address")]).optional(),
  phone: z.string().trim().max(40).optional(),
});

// "+ Add new contact" inside the company page's activity form: a person
// made on the spot at this company, handed back so the form can tick
// them straight away. The rest of their details wait for their own page.
export async function quickAddContactToCompany(input: {
  companyId: string;
  name: string;
  email?: string;
  phone?: string;
}): Promise<{ error?: string; contact?: { id: string; name: string; email: string | null; phone: string | null } }> {
  const { organizationId } = await requireSession();
  const parsed = quickSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the new contact's details" };

  const company = await prisma.company.findFirst({ where: { id: parsed.data.companyId, organizationId }, select: { id: true } });
  if (!company) return { error: "Company not found" };

  const contact = await prisma.contact.create({
    data: {
      organizationId,
      companyId: company.id,
      name: parsed.data.name,
      email: parsed.data.email ? parsed.data.email.toLowerCase() : null,
      phone: parsed.data.phone || null,
    },
    select: { id: true, name: true, email: true, phone: true },
  });
  revalidatePath(`/dashboard/companies/${company.id}`);
  revalidatePath("/dashboard/contacts");
  return { contact };
}
