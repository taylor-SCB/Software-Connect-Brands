"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, type ActionState } from "@/lib/forms";
import { START_STATUSES } from "@/lib/constants";
import { normalizeWebsite, normalizeState } from "@/lib/companies";
import { ensureIndustryOptions, mergeTags, readIndustryFields } from "@/lib/industries";
import { hasFile, imageProblem, removeImage, replaceImage } from "@/lib/uploads";
import { sameTags, withoutAuto, type AutoField } from "@/lib/enrich";
import { moneyHold, moneyHoldMessage } from "@/lib/money";
import { markContacted, markMeetingSet } from "@/lib/status";

const idSchema = z.string().trim().min(1, "Missing record reference");

const companySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(120),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.literal(""), z.email("Enter a valid email address")]).optional(),
  website: z.union([z.literal(""), z.string().trim().max(200)]).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(60).optional(),
  // Only a new record's form offers a status, and only the ones before
  // the pipeline; after that it is the status button on the record's page
  // (Sept 30, 2026), which asks for dates when a step is skipped.
  status: z.enum(START_STATUSES).optional(),
});

function readCompanyForm(formData: FormData) {
  return {
    name: formData.get("name"),
    phone: formData.get("phone") ?? undefined,
    email: formData.get("email") ?? undefined,
    website: formData.get("website") ?? undefined,
    city: formData.get("city") ?? undefined,
    state: formData.get("state") ?? undefined,
    status: formData.get("status") ?? undefined,
  };
}

function companyData(parsed: z.infer<typeof companySchema>) {
  return {
    name: parsed.name.replace(/\s+/g, " "),
    phone: parsed.phone || null,
    email: parsed.email ? parsed.email.toLowerCase() : null,
    website: normalizeWebsite(parsed.website || null),
    city: parsed.city || null,
    state: normalizeState(parsed.state || null),
    ...(parsed.status ? { status: parsed.status } : {}),
  };
}

// Industry / Company Type from the picker, with anything new added to the
// workspace's lists. Absent from the form (an older client, a test) means
// leave the company's tags alone.
async function tagData(formData: FormData, organizationId: string): Promise<{ industries: string[]; companyTypes: string[] } | null> {
  const tags = readIndustryFields(formData);
  if (!tags.touched) return null;
  const canonical = await ensureIndustryOptions(organizationId, tags.industries, tags.typesByIndustry, tags.offList);
  return { industries: canonical.industries, companyTypes: mergeTags(canonical.companyTypes, tags.keepTypes) };
}

// Two companies with the same name is almost always a typo, and the
// contact form's picker can't tell them apart, so the name is unique per
// workspace (ignoring case).
async function nameTaken(name: string, organizationId: string, exceptId?: string) {
  const clash = await prisma.company.findFirst({
    where: {
      organizationId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(clash);
}

export async function createCompany(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(companySchema, readCompanyForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const logoFile = formData.get("logoFile");
  const problem = imageProblem(logoFile);
  if (problem) return { error: problem };

  const data = companyData(parsed.data);
  if (await nameTaken(data.name, organizationId)) {
    return { error: "A company with that name already exists" };
  }

  const company = await prisma.company.create({
    data: { organizationId, ...data, ...((await tagData(formData, organizationId)) ?? {}) },
  });
  if (hasFile(logoFile)) {
    const logoUrl = await replaceImage({ organizationId, kind: "COMPANY_LOGO", file: logoFile, companyId: company.id });
    await prisma.company.update({ where: { id: company.id }, data: { logoUrl } });
  }

  revalidatePath("/dashboard/companies");
  redirect(`/dashboard/companies/${company.id}`);
}

export async function updateCompany(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const id = idSchema.safeParse(formData.get("companyId"));
  if (!id.success) return { error: "Missing company reference" };

  const parsed = parseForm(companySchema, readCompanyForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const logoFile = formData.get("logoFile");
  const problem = imageProblem(logoFile);
  if (problem) return { error: problem };

  const data = companyData(parsed.data);
  if (await nameTaken(data.name, organizationId, id.data)) {
    return { error: "A company with that name already exists" };
  }

  const existing = await prisma.company.findFirst({
    where: { id: id.data, organizationId },
    select: { id: true, phone: true, website: true, industries: true, companyTypes: true, autoFilled: true },
  });
  if (!existing) return { error: "Company not found" };

  const logo: { logoUrl?: string | null } = {};
  if (hasFile(logoFile)) {
    logo.logoUrl = await replaceImage({ organizationId, kind: "COMPANY_LOGO", file: logoFile, companyId: id.data });
  } else if (formData.get("removeLogo") === "true") {
    await removeImage({ organizationId, kind: "COMPANY_LOGO", companyId: id.data });
    logo.logoUrl = null;
  }

  // A field the app filled in stops being "auto" the moment a person
  // changes it; the mark stays if they saved without touching it.
  const tags = await tagData(formData, organizationId);
  const edited: AutoField[] = [];
  if (data.phone !== existing.phone) edited.push("phone");
  if (data.website !== existing.website) edited.push("website");
  if (tags && (!sameTags(tags.industries, existing.industries) || !sameTags(tags.companyTypes, existing.companyTypes))) {
    edited.push("industries", "companyTypes");
  }
  const autoFilled = withoutAuto(existing.autoFilled, edited);
  const marks = autoFilled.length !== existing.autoFilled.length ? { autoFilled } : {};

  const result = await prisma.company.updateMany({
    where: { id: id.data, organizationId },
    data: { ...data, ...logo, ...(tags ?? {}), ...marks },
  });
  if (result.count === 0) return { error: "Company not found" };

  revalidatePath("/dashboard/companies");
  revalidatePath(`/dashboard/companies/${id.data}`);
  revalidatePath("/dashboard/contacts");
  return { success: "Company saved" };
}

// "Looks right" on the company page: the person has read what the app
// filled in and is keeping it, so the "auto" marks come off. The values
// stay; updatedAt stays too, since nothing about the company changed.
export async function confirmCompanyDetails(companyId: string): Promise<{ ok: true } | { error: string }> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(companyId);
  if (!id.success) return { error: "Missing company reference" };
  const company = await prisma.company.findFirst({
    where: { id: id.data, organizationId },
    select: { updatedAt: true },
  });
  if (!company) return { error: "Company not found" };
  await prisma.company.updateMany({
    where: { id: id.data, organizationId },
    data: { autoFilled: [], updatedAt: company.updatedAt },
  });
  revalidatePath("/dashboard/companies");
  revalidatePath(`/dashboard/companies/${id.data}`);
  revalidatePath("/dashboard/contacts");
  return { ok: true };
}

// The star. Returns the new state so the button can settle on it.
export async function setCompanyFavorite(
  companyId: string,
  favorite: boolean,
): Promise<{ favorite: boolean } | { error: string }> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(companyId);
  if (!id.success) return { error: "Missing company reference" };
  const result = await prisma.company.updateMany({
    where: { id: id.data, organizationId },
    data: { favorite: Boolean(favorite) },
  });
  if (result.count === 0) return { error: "Company not found" };
  revalidatePath("/dashboard/companies");
  revalidatePath(`/dashboard/companies/${id.data}`);
  return { favorite: Boolean(favorite) };
}

// Claiming from Other Contacts (Oct 4, 2026): activities logged on the
// company with nobody linked move onto a real person at it. The person
// must be at that company (their main one, or linked as an additional
// account). Their history, Contacted status and the calendar entries the
// activities made follow, as if they had been logged on them to begin
// with — which is why the company link is cleared, the same shape as a
// touch logged on a person.
export async function claimActivities(input: { activityIds: string[]; contactId: string }): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();
  const parsed = z
    .object({ activityIds: z.array(idSchema).min(1, "Nothing to claim").max(500), contactId: idSchema })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick who it was with" };

  const contact = await prisma.contact.findFirst({
    where: { id: parsed.data.contactId, organizationId },
    select: { id: true, name: true, companyId: true, accounts: { select: { companyId: true } } },
  });
  if (!contact) return { error: "That person is no longer here" };
  const at = new Set([contact.companyId, ...contact.accounts.map((row) => row.companyId)].filter(Boolean));

  const activities = await prisma.activity.findMany({
    where: { id: { in: parsed.data.activityIds }, organizationId, contactId: null, companyId: { not: null } },
    select: { id: true, companyId: true, type: true, occurredAt: true },
  });
  if (activities.length === 0) return { error: "Those activities were already claimed" };
  if (activities.some((row) => !at.has(row.companyId!))) return { error: `${contact.name} is not at this company` };

  const ids = activities.map((row) => row.id);
  await prisma.$transaction([
    prisma.activity.updateMany({ where: { id: { in: ids }, organizationId }, data: { contactId: contact.id, companyId: null } }),
    prisma.calendarEvent.updateMany({ where: { activityId: { in: ids }, organizationId }, data: { contactId: contact.id } }),
  ]);

  // The ladder, as if logged on them: the earliest touch makes them
  // Contacted, the earliest meeting sets Meeting Set.
  const who = { organizationId, userId };
  const earliest = (rows: typeof activities) => rows.map((row) => row.occurredAt).sort((a, b) => a.getTime() - b.getTime())[0];
  await markContacted(who, { contactIds: [contact.id], companyId: activities[0].companyId }, earliest(activities));
  const meetings = activities.filter((row) => row.type === "MEETING");
  if (meetings.length) await markMeetingSet(who, [contact.id], earliest(meetings));

  for (const companyId of new Set(activities.map((row) => row.companyId!))) revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath(`/dashboard/contacts/${contact.id}`);
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/calendar");
  return { success: ids.length === 1 ? `Moved onto ${contact.name}` : `${ids.length} moved onto ${contact.name}` };
}

// The people stay; they just lose their company link (the database sets
// it to null). Notes and activity logged on the company itself go with it.
// Refused once money is on the company's contracts — payments recorded,
// or a signed Money-in contract still owed — since the money tracking
// hangs off the company row. Archive it instead.
export async function deleteCompany(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("companyId"));
  if (!id.success) return { error: "Missing company reference" };

  const company = await prisma.company.findFirst({
    where: { id: id.data, organizationId },
    select: { name: true },
  });
  if (!company) return { error: "Company not found" };

  const hold = await moneyHold(organizationId, {
    OR: [{ companyId: id.data }, { contact: { companyId: id.data } }],
  });
  const refusal = moneyHoldMessage(company.name, hold, "company");
  if (refusal) return { error: refusal };

  await prisma.company.deleteMany({ where: { id: id.data, organizationId } });
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/contacts");
  redirect("/dashboard/companies");
}
