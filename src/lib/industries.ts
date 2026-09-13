import { prisma } from "@/lib/prisma";
import { DEFAULT_INDUSTRIES, GENERAL_COMPANY_TYPE } from "@/lib/constants";

export type IndustryPickList = { name: string; types: string[] }[];

function cleanName(raw: string) {
  return raw.trim().replace(/\s+/g, " ").slice(0, 60);
}

// The workspace's Industry → Company Type lists, in the order they were
// added, seeded with the defaults the first time a workspace asks. Lazy
// seeding means workspaces that existed before this feature get the same
// starting list as a new signup, with no migration data step.
export async function getIndustryPickList(organizationId: string): Promise<IndustryPickList> {
  let industries = await loadPickList(organizationId);
  if (industries.length === 0) {
    await seedIndustries(organizationId);
    industries = await loadPickList(organizationId);
  }
  return industries;
}

async function loadPickList(organizationId: string) {
  const rows = await prisma.industryOption.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { companyTypes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { name: true } } },
  });
  return rows.map((row) => ({ name: row.name, types: row.companyTypes.map((type) => type.name) }));
}

export async function seedIndustries(organizationId: string) {
  for (const [index, industry] of DEFAULT_INDUSTRIES.entries()) {
    await prisma.industryOption.upsert({
      where: { organizationId_name: { organizationId, name: industry.name } },
      update: {},
      create: {
        organizationId,
        name: industry.name,
        sortOrder: index,
        companyTypes: {
          create: industry.types.map((name, typeIndex) => ({ organizationId, name, sortOrder: typeIndex })),
        },
      },
    });
  }
}

// Makes sure every industry and every "Industry::Type" pair a form or an
// import mentions exists in the pick lists, creating what is new. Returns
// the canonical spellings (the existing option's case wins, so "mdu" on a
// CSV lands on "MDU"). A brand-new industry gets "General" so it is never
// an empty bucket.
export async function ensureIndustryOptions(
  organizationId: string,
  industries: string[],
  typesByIndustry: Record<string, string[]>,
): Promise<{ industries: string[]; companyTypes: string[] }> {
  const existing = await prisma.industryOption.findMany({
    where: { organizationId },
    include: { companyTypes: { select: { id: true, name: true } } },
  });
  const byLower = new Map(existing.map((row) => [row.name.toLowerCase(), row]));

  const canonicalIndustries: string[] = [];
  const canonicalTypes = new Set<string>();

  const wanted = new Set(industries.map(cleanName).filter(Boolean));
  for (const industry of Object.keys(typesByIndustry)) {
    if (cleanName(industry)) wanted.add(cleanName(industry));
  }

  for (const rawName of wanted) {
    let row = byLower.get(rawName.toLowerCase());
    if (!row) {
      row = await prisma.industryOption.create({
        data: {
          organizationId,
          name: rawName,
          sortOrder: existing.length + byLower.size,
          companyTypes: { create: [{ organizationId, name: GENERAL_COMPANY_TYPE }] },
        },
        include: { companyTypes: { select: { id: true, name: true } } },
      });
      byLower.set(rawName.toLowerCase(), row);
    }
    if (industries.some((name) => cleanName(name).toLowerCase() === row!.name.toLowerCase())) {
      canonicalIndustries.push(row.name);
    }

    const typeKey = Object.keys(typesByIndustry).find(
      (key) => cleanName(key).toLowerCase() === row!.name.toLowerCase(),
    );
    const types = typeKey ? typesByIndustry[typeKey].map(cleanName).filter(Boolean) : [];
    for (const typeName of types) {
      const found = row.companyTypes.find((type) => type.name.toLowerCase() === typeName.toLowerCase());
      if (found) {
        canonicalTypes.add(found.name);
        continue;
      }
      const created = await prisma.companyTypeOption.create({
        data: { organizationId, industryId: row.id, name: typeName, sortOrder: row.companyTypes.length },
        select: { id: true, name: true },
      });
      row.companyTypes.push(created);
      canonicalTypes.add(created.name);
    }
  }

  return { industries: canonicalIndustries, companyTypes: Array.from(canonicalTypes) };
}

// Reads the Industry / Company Type picker's hidden fields. Types travel
// as "Industry::Type" so a new type knows which list it belongs to.
export function readIndustryFields(formData: FormData): {
  industries: string[];
  typesByIndustry: Record<string, string[]>;
  touched: boolean;
} {
  const touched = formData.get("industryFieldsPresent") === "1";
  const industries = formData.getAll("industries").filter((value): value is string => typeof value === "string");
  const typesByIndustry: Record<string, string[]> = {};
  for (const value of formData.getAll("companyTypes")) {
    if (typeof value !== "string") continue;
    const [industry, type] = value.split("::");
    if (!industry || !type) continue;
    (typesByIndustry[industry] ??= []).push(type);
  }
  return { industries, typesByIndustry, touched };
}
