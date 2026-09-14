"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { CONTACT_STATUSES } from "@/lib/constants";
import { ensureIndustryOptions, inferIndustriesForTypes, mergeTags } from "@/lib/industries";
import { IMPORT_BATCH_SIZE, emptyBatchResult, type ImportBatchResult } from "@/lib/contacts-csv";
import type { AutoField, ContactHint } from "@/lib/enrich";
import { dropAutoMarks, enrichCompanies, loadCompaniesForEnrichment } from "@/lib/enrich-companies";
import type { Prisma } from "@/generated/prisma/client";

const text = (max: number) => z.string().trim().max(max).nullable();
const statusSchema = z.enum(CONTACT_STATUSES).nullable();

const companySchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: text(40),
  email: text(200),
  website: text(200),
  city: text(120),
  state: text(60),
  status: statusSchema,
  industries: z.array(z.string().trim().min(1).max(60)).max(20),
  companyTypes: z.array(z.string().trim().min(1).max(60)).max(20),
});

const rowSchema = z.object({
  line: z.number().int().positive(),
  name: text(160),
  title: text(120),
  email: text(200),
  phone: text(40),
  website: text(200),
  city: text(120),
  state: text(60),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  status: statusSchema,
  company: companySchema.nullable(),
  notes: z.array(z.string()).optional(),
});

const batchSchema = z.array(rowSchema).min(1).max(IMPORT_BATCH_SIZE);

const lower = (value: string) => value.toLowerCase();

// One batch of planned rows from the import dialog. Companies first (find
// by name ignoring case, create what is missing, fill blanks on what
// exists), then contacts (a row matching an existing contact by email, or
// by name + company, updates it; the rest are created). Re-running the
// same file is safe: the second pass updates instead of doubling up.
export async function importContactsBatch(input: unknown): Promise<ImportBatchResult | { error: string }> {
  const { organizationId } = await requireSession();
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { error: "That batch couldn't be read. Refresh and try the import again." };
  const rows = parsed.data;
  const result = emptyBatchResult();

  // ---- Companies ------------------------------------------------------
  const wantedCompanies = new Map<string, (typeof rows)[number]["company"] & object>();
  for (const row of rows) {
    if (!row.company) continue;
    const key = lower(row.company.name);
    const existing = wantedCompanies.get(key);
    // Several rows can name the same company; merge what they know.
    wantedCompanies.set(key, existing ? mergeCompany(existing, row.company) : { ...row.company });
  }

  // A company type with no industry on its row (a sheet with a Type column
  // and no Industry column) is filed under the industry it already lives
  // in here — "Integrator" lands on Service Provider — and that industry
  // is added to the company so the type stays visible on the forms. A
  // type nobody has seen before goes under "Uncategorized".
  const orphanTypes = Array.from(
    new Set(
      Array.from(wantedCompanies.values())
        .filter((company) => company.industries.length === 0)
        .flatMap((company) => company.companyTypes),
    ),
  );
  const homes = await inferIndustriesForTypes(organizationId, orphanTypes);
  for (const company of wantedCompanies.values()) {
    if (company.industries.length > 0 || company.companyTypes.length === 0) continue;
    company.industries = mergeTags([], company.companyTypes.map((type) => homes.get(lower(type)) ?? "Uncategorized"));
  }

  // Every industry / type this batch mentions, canonicalised once.
  const industryNames = new Set<string>();
  const typesByIndustry: Record<string, string[]> = {};
  for (const company of wantedCompanies.values()) {
    for (const industry of company.industries) industryNames.add(industry);
    for (const type of company.companyTypes) {
      const home = homes.get(lower(type));
      const under = home && company.industries.some((i) => lower(i) === lower(home)) ? home : company.industries[0];
      if (under) (typesByIndustry[under] ??= []).push(type);
    }
  }
  const canonical =
    industryNames.size || Object.keys(typesByIndustry).length
      ? await ensureIndustryOptions(organizationId, Array.from(industryNames), typesByIndustry)
      : { industries: [] as string[], companyTypes: [] as string[] };
  const canonIndustry = (name: string) => canonical.industries.find((c) => lower(c) === lower(name)) ?? name;
  const canonType = (name: string) => canonical.companyTypes.find((c) => lower(c) === lower(name)) ?? name;

  const companyIds = new Map<string, string>();
  if (wantedCompanies.size > 0) {
    const names = Array.from(wantedCompanies.values()).map((company) => company.name);
    const existing = await prisma.company.findMany({
      where: { organizationId, name: { in: names, mode: "insensitive" } },
      select: { id: true, name: true, phone: true, email: true, website: true, city: true, state: true, industries: true, companyTypes: true, autoFilled: true },
    });
    for (const company of existing) companyIds.set(lower(company.name), company.id);

    // Fill blanks on the ones we already have; never overwrite a value a
    // person entered. The one deliberate exception: a phone, website or
    // tag the app filled in on its own (Company.autoFilled) is a guess, and
    // a person's spreadsheet beats a guess — the file's value replaces it
    // and the "auto" mark comes off.
    for (const company of existing) {
      const wanted = wantedCompanies.get(lower(company.name));
      if (!wanted) continue;
      const data: Prisma.CompanyUpdateManyMutationInput = {};
      const auto = company.autoFilled;
      // The marks to take off: one for each field the file is writing.
      // Removed on the database side (dropAutoMarks) rather than by
      // writing back the list read above, because "Fill in missing" in
      // another tab may have marked a field since then — the file's value
      // must never end up wearing an "auto" mark.
      const unmark: AutoField[] = [];
      if (wanted.phone && (!company.phone || auto.includes("phone"))) {
        data.phone = wanted.phone;
        unmark.push("phone");
      }
      if (!company.email && wanted.email) data.email = wanted.email;
      if (wanted.website && (!company.website || auto.includes("website"))) {
        data.website = wanted.website;
        unmark.push("website");
      }
      if (!company.city && wanted.city) data.city = wanted.city;
      if (!company.state && wanted.state) data.state = wanted.state;
      const fileHasTags = wanted.industries.length > 0 || wanted.companyTypes.length > 0;
      const guessed = auto.includes("industries") || auto.includes("companyTypes");
      const untagged = company.industries.length === 0 && company.companyTypes.length === 0;
      if (fileHasTags && (guessed || untagged)) {
        // The file's tags replace the guess rather than joining it, so the
        // guess never lingers looking like something a person chose. An
        // untagged company gets both lists written whole for the same
        // reason: a guess made in the meantime must not stay behind.
        data.industries = mergeTags([], wanted.industries.map(canonIndustry));
        data.companyTypes = mergeTags([], wanted.companyTypes.map(canonType));
        unmark.push("industries", "companyTypes");
      } else {
        const industries = union(company.industries, wanted.industries.map(canonIndustry));
        if (industries.length !== company.industries.length) data.industries = industries;
        const companyTypes = union(company.companyTypes, wanted.companyTypes.map(canonType));
        if (companyTypes.length !== company.companyTypes.length) data.companyTypes = companyTypes;
      }
      if (Object.keys(data).length === 0) continue;
      await prisma.$transaction([
        prisma.company.updateMany({ where: { id: company.id, organizationId }, data }),
        ...(unmark.length > 0 ? [dropAutoMarks(organizationId, company.id, unmark)] : []),
      ]);
      result.companiesUpdated += 1;
    }

    const missing = Array.from(wantedCompanies.entries()).filter(([key]) => !companyIds.has(key));
    if (missing.length > 0) {
      await prisma.company.createMany({
        data: missing.map(([, company]) => ({
          organizationId,
          name: company.name,
          phone: company.phone,
          email: company.email,
          website: company.website,
          city: company.city,
          state: company.state,
          status: company.status ?? "LEAD",
          industries: mergeTags([], company.industries.map(canonIndustry)),
          companyTypes: mergeTags([], company.companyTypes.map(canonType)),
        })),
      });
      result.companiesCreated += missing.length;
      const created = await prisma.company.findMany({
        where: { organizationId, name: { in: missing.map(([, company]) => company.name), mode: "insensitive" } },
        select: { id: true, name: true },
      });
      for (const company of created) companyIds.set(lower(company.name), company.id);
    }
  }

  // ---- Contacts -------------------------------------------------------
  const people = rows.filter((row) => row.name);
  if (people.length === 0) {
    await fillInBlanks(organizationId, Array.from(companyIds.values()), result);
    revalidateLists();
    return result;
  }

  const emails = people.map((row) => row.email).filter((email): email is string => Boolean(email));
  const names = people.map((row) => row.name!);
  const [byEmail, byName] = await Promise.all([
    emails.length
      ? prisma.contact.findMany({
          where: { organizationId, email: { in: emails, mode: "insensitive" } },
          select: { id: true, email: true },
        })
      : [],
    // Name + company matching covers contacts with an email too: a phone
    // list without emails must still find the people already here.
    prisma.contact.findMany({
      where: { organizationId, name: { in: names, mode: "insensitive" } },
      select: { id: true, name: true, companyId: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const emailIds = new Map(byEmail.map((contact) => [lower(contact.email!), contact.id]));
  const nameIds = new Map<string, string>();
  for (const contact of byName) {
    const k = `${lower(contact.name)}|${contact.companyId ?? ""}`;
    if (!nameIds.has(k)) nameIds.set(k, contact.id);
  }

  const creates: Prisma.ContactCreateManyInput[] = [];
  const seenNew = new Set<string>();
  // This batch's people by company, for fillInBlanks below: what the file
  // says about them counts for their company whether the row became a new
  // contact or updated one, and however many people the company has.
  const batchRows = new Map<string, ContactHint[]>();
  for (const row of people) {
    const companyId = row.company ? (companyIds.get(lower(row.company.name)) ?? null) : null;
    if (row.company && !companyId) {
      result.skipped.push({ line: row.line, reason: `Company "${row.company.name}" couldn't be created` });
      continue;
    }
    if (companyId) {
      const hints = batchRows.get(companyId) ?? [];
      hints.push({ phone: row.phone, email: row.email, title: row.title, website: row.website });
      batchRows.set(companyId, hints);
    }
    const existingId =
      (row.email ? emailIds.get(row.email) : undefined) ?? nameIds.get(`${lower(row.name!)}|${companyId ?? ""}`);

    if (existingId) {
      // The row is the newer truth for every cell it fills, the name included.
      const data: Prisma.ContactUncheckedUpdateManyInput = { name: row.name! };
      if (row.title) data.title = row.title;
      if (row.phone) data.phone = row.phone;
      if (row.website) data.website = row.website;
      if (row.city) data.city = row.city;
      if (row.state) data.state = row.state;
      if (row.birthday) data.birthday = new Date(`${row.birthday}T00:00:00.000Z`);
      if (row.status) data.status = row.status;
      if (row.email) data.email = row.email;
      if (companyId) data.companyId = companyId;
      await prisma.contact.updateMany({ where: { id: existingId, organizationId }, data });
      result.contactsUpdated += 1;
      continue;
    }

    const newKey = row.email ? `email:${row.email}` : `person:${lower(row.name!)}|${companyId ?? ""}`;
    if (seenNew.has(newKey)) {
      result.skipped.push({ line: row.line, reason: "Duplicate of an earlier row" });
      continue;
    }
    seenNew.add(newKey);
    creates.push({
      organizationId,
      companyId,
      name: row.name!,
      title: row.title,
      email: row.email,
      phone: row.phone,
      website: row.website,
      city: row.city,
      state: row.state,
      birthday: row.birthday ? new Date(`${row.birthday}T00:00:00.000Z`) : null,
      status: row.status ?? "LEAD",
    });
  }
  if (creates.length > 0) {
    await prisma.contact.createMany({ data: creates });
    result.contactsCreated += creates.length;
  }

  await fillInBlanks(organizationId, Array.from(companyIds.values()), result, batchRows);
  revalidateLists();
  return result;
}

// After the file's own values are in: tag every company this batch
// touched that still has no industry or type, and copy a phone or website
// up from its people where those are blank (src/lib/enrich.ts). Runs once
// the batch's contacts are written, and the batch's own rows are handed
// over as well, so the people just imported count.
async function fillInBlanks(organizationId: string, companyIds: string[], result: ImportBatchResult, batchRows?: Map<string, ContactHint[]>) {
  if (companyIds.length === 0) return;
  const counts = await enrichCompanies(organizationId, await loadCompaniesForEnrichment(organizationId, companyIds, batchRows));
  result.tagged += counts.tagged;
  result.phonesFilled += counts.phonesFilled;
  result.websitesFilled += counts.websitesFilled;
}

function revalidateLists() {
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
}

type CompanyInput = z.infer<typeof companySchema>;
function mergeCompany(a: CompanyInput, b: CompanyInput): CompanyInput {
  return {
    name: a.name,
    phone: a.phone ?? b.phone,
    email: a.email ?? b.email,
    website: a.website ?? b.website,
    city: a.city ?? b.city,
    state: a.state ?? b.state,
    status: a.status ?? b.status,
    industries: union(a.industries, b.industries),
    companyTypes: union(a.companyTypes, b.companyTypes),
  };
}

const union = mergeTags;
