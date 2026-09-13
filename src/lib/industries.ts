import { prisma } from "@/lib/prisma";
import { DEFAULT_INDUSTRIES, GENERAL_COMPANY_TYPE } from "@/lib/constants";
import { TAG_SEPARATOR } from "@/lib/tag-separator";

export type IndustryPickList = { name: string; types: string[] }[];

export { TAG_SEPARATOR } from "@/lib/tag-separator";

// A workspace's lists are meant to be a few dozen entries, not a dump of
// every free-text value a spreadsheet held. Past these, values still save
// on the company but stop being added to the pick lists.
export const MAX_INDUSTRY_OPTIONS = 100;
export const MAX_TYPE_OPTIONS_PER_INDUSTRY = 100;

export function cleanName(raw: string) {
  return raw.trim().replace(/\s+/g, " ").replace(/\u001f/g, "").slice(0, 60);
}

// The workspace's Industry → Company Type lists, in the order they were
// added, seeded with the defaults the first time a workspace asks. Lazy
// seeding means workspaces that existed before this feature get the same
// starting list as a new signup, with no migration data step.
export async function getIndustryPickList(organizationId: string): Promise<IndustryPickList> {
  let industries = await loadPickList(organizationId);
  if (industries.length === 0) {
    // Two tabs opening at once both try to seed; the unique index lets
    // exactly one win and the other simply reads what it wrote.
    try {
      await seedIndustries(organizationId);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    industries = await loadPickList(organizationId);
  }
  return industries;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
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
  let industryCount = existing.length;

  const canonicalIndustries: string[] = [];
  const canonicalTypes: string[] = [];
  const addUnique = (list: string[], value: string) => {
    if (!list.some((v) => v.toLowerCase() === value.toLowerCase())) list.push(value);
  };

  const wantedIndustries = industries.map(cleanName).filter(Boolean);
  const wanted: string[] = [];
  for (const name of [...wantedIndustries, ...Object.keys(typesByIndustry).map(cleanName)]) {
    if (name) addUnique(wanted, name);
  }

  for (const rawName of wanted) {
    let row = byLower.get(rawName.toLowerCase());
    if (!row) {
      if (industryCount >= MAX_INDUSTRY_OPTIONS) {
        // Past the cap the value still tags the company; it just isn't a pick-list row.
        if (wantedIndustries.some((n) => n.toLowerCase() === rawName.toLowerCase())) addUnique(canonicalIndustries, rawName);
        continue;
      }
      try {
        row = await prisma.industryOption.create({
          data: {
            organizationId,
            name: rawName,
            sortOrder: industryCount,
            companyTypes: { create: [{ organizationId, name: GENERAL_COMPANY_TYPE }] },
          },
          include: { companyTypes: { select: { id: true, name: true } } },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Someone else created it a moment ago; use theirs.
        row = (await prisma.industryOption.findFirst({
          where: { organizationId, name: { equals: rawName, mode: "insensitive" } },
          include: { companyTypes: { select: { id: true, name: true } } },
        }))!;
      }
      industryCount += 1;
      byLower.set(rawName.toLowerCase(), row);
    }
    if (wantedIndustries.some((n) => n.toLowerCase() === row!.name.toLowerCase())) addUnique(canonicalIndustries, row.name);

    const typeKey = Object.keys(typesByIndustry).find((key) => cleanName(key).toLowerCase() === row!.name.toLowerCase());
    const types: string[] = [];
    for (const typeName of typeKey ? typesByIndustry[typeKey].map(cleanName) : []) if (typeName) addUnique(types, typeName);
    for (const typeName of types) {
      const found = row.companyTypes.find((type) => type.name.toLowerCase() === typeName.toLowerCase());
      if (found) {
        addUnique(canonicalTypes, found.name);
        continue;
      }
      if (row.companyTypes.length >= MAX_TYPE_OPTIONS_PER_INDUSTRY) {
        addUnique(canonicalTypes, typeName);
        continue;
      }
      try {
        const created = await prisma.companyTypeOption.create({
          data: { organizationId, industryId: row.id, name: typeName, sortOrder: row.companyTypes.length },
          select: { id: true, name: true },
        });
        row.companyTypes.push(created);
        addUnique(canonicalTypes, created.name);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        addUnique(canonicalTypes, typeName);
      }
    }
  }

  return { industries: canonicalIndustries, companyTypes: canonicalTypes };
}

// Union of two tag lists, ignoring case, first spelling wins.
export function mergeTags(a: string[], b: string[]) {
  const out = [...a];
  for (const value of b) if (!out.some((v) => v.toLowerCase() === value.toLowerCase())) out.push(value);
  return out;
}

// For a company type that arrived with no industry (a CSV with a Type
// column and no Industry column): the industry it already lives under in
// this workspace's lists, when there is exactly one obvious home.
export async function inferIndustriesForTypes(organizationId: string, types: string[]): Promise<Map<string, string>> {
  const homes = new Map<string, string>();
  if (types.length === 0) return homes;
  const options = await prisma.companyTypeOption.findMany({
    where: { organizationId, name: { in: types, mode: "insensitive" } },
    select: { name: true, industry: { select: { name: true, sortOrder: true } } },
    orderBy: { industry: { sortOrder: "asc" } },
  });
  for (const option of options) {
    const key = option.name.toLowerCase();
    if (!homes.has(key)) homes.set(key, option.industry.name);
  }
  return homes;
}

// Reads the Industry / Company Type picker's hidden fields. Types travel
// as "Industry<SEP>Type" so a new type knows which list it belongs to;
// `keepTypes` are types the company already had that sit under no picked
// industry, kept as they are. `touched` is only set once the user changed
// something, so an untouched form never rewrites a company's tags.
export function readIndustryFields(formData: FormData): {
  industries: string[];
  typesByIndustry: Record<string, string[]>;
  keepTypes: string[];
  touched: boolean;
} {
  const touched = formData.get("industryFieldsPresent") === "1";
  const strings = (name: string) => formData.getAll(name).filter((value): value is string => typeof value === "string").slice(0, 200);
  const industries = strings("industries").map(cleanName).filter(Boolean);
  const typesByIndustry: Record<string, string[]> = {};
  for (const value of strings("companyTypes")) {
    const at = value.indexOf(TAG_SEPARATOR);
    if (at <= 0) continue;
    const industry = cleanName(value.slice(0, at));
    const type = cleanName(value.slice(at + 1));
    if (!industry || !type) continue;
    (typesByIndustry[industry] ??= []).push(type);
  }
  const keepTypes = strings("keepTypes").map(cleanName).filter(Boolean);
  return { industries, typesByIndustry, keepTypes, touched };
}
