"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, type ActionState } from "@/lib/forms";
import { CONTACT_STATUSES } from "@/lib/constants";
import { normalizeWebsite, normalizeState } from "@/lib/companies";
import { ensureIndustryOptions, mergeTags, readIndustryFields } from "@/lib/industries";
import { hasFile, imageProblem, removeImage, replaceImage } from "@/lib/uploads";

const idSchema = z.string().trim().min(1, "Missing record reference");

const companySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(120),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.literal(""), z.email("Enter a valid email address")]).optional(),
  website: z.union([z.literal(""), z.string().trim().max(200)]).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(60).optional(),
  status: z.enum(CONTACT_STATUSES),
});

function readCompanyForm(formData: FormData) {
  return {
    name: formData.get("name"),
    phone: formData.get("phone") ?? undefined,
    email: formData.get("email") ?? undefined,
    website: formData.get("website") ?? undefined,
    city: formData.get("city") ?? undefined,
    state: formData.get("state") ?? undefined,
    status: formData.get("status"),
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
    status: parsed.status,
  };
}

// Industry / Company Type from the picker, with anything new added to the
// workspace's lists. Absent from the form (an older client, a test) means
// leave the company's tags alone.
async function tagData(formData: FormData, organizationId: string) {
  const tags = readIndustryFields(formData);
  if (!tags.touched) return {};
  const canonical = await ensureIndustryOptions(organizationId, tags.industries, tags.typesByIndustry);
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
    data: { organizationId, ...data, ...(await tagData(formData, organizationId)) },
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

  const existing = await prisma.company.findFirst({ where: { id: id.data, organizationId }, select: { id: true } });
  if (!existing) return { error: "Company not found" };

  const logo: { logoUrl?: string | null } = {};
  if (hasFile(logoFile)) {
    logo.logoUrl = await replaceImage({ organizationId, kind: "COMPANY_LOGO", file: logoFile, companyId: id.data });
  } else if (formData.get("removeLogo") === "true") {
    await removeImage({ organizationId, kind: "COMPANY_LOGO", companyId: id.data });
    logo.logoUrl = null;
  }

  const result = await prisma.company.updateMany({
    where: { id: id.data, organizationId },
    data: { ...data, ...logo, ...(await tagData(formData, organizationId)) },
  });
  if (result.count === 0) return { error: "Company not found" };

  revalidatePath("/dashboard/companies");
  revalidatePath(`/dashboard/companies/${id.data}`);
  revalidatePath("/dashboard/contacts");
  return { success: "Company saved" };
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

// The people stay; they just lose their company link (the database sets
// it to null). Notes and activity logged on the company itself go with it.
export async function deleteCompany(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("companyId"));
  if (!id.success) return;

  await prisma.company.deleteMany({ where: { id: id.data, organizationId } });
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/contacts");
  redirect("/dashboard/companies");
}
