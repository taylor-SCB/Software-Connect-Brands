import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { cleanName } from "@/lib/industries";
import { supplierLabelNames } from "@/lib/distributors";
import { BUILT_IN_LEAD_LABELS, MAX_LEAD_LABEL_LENGTH, NO_LEAD_LABEL, canonicalLeadLabel, isBuiltInLeadLabel } from "@/lib/lead-labels";

// The CRM Labels screen (/dashboard/labels, Nov 10, 2026, Taylor): every
// Industry, Company Type, Lead Label and Job Title the workspace uses, how
// many records carry each, and Rename / Merge into… / Retire.
//
// - Industry and Company Type live on Company as plain text arrays; the
//   pick lists are IndustryOption and CompanyTypeOption (a type sits under
//   an industry, but a company carries the bare name, so "Owner" under MDU
//   and "Owner" under Student are one value here).
// - Lead Label lives on Opportunity.leadLabel; the five built-ins are fixed
//   (merged into, never renamed, merged away or retired), the workspace's
//   own are LeadLabelOption.
// - Job Title is Contact.title, matched ignoring case and spaces (outer
//   ones, and a run of them inside counts as one: "Sales  Manager" is
//   "Sales Manager", audit fix Nov 10, 2026). It has no pick list, so
//   nothing to retire.
//
// A merge rewrites every record carrying A to carry B instead, an array
// keeping one of each (ignoring case, in the order it had them), and takes
// A off the pick list. Retire takes a value off the pick list and leaves
// every record alone. Each change is one batch of statements in a
// transaction, set-based, never a loop over rows; none of them touches
// updatedAt, so the lists don't reshuffle.

export type LabelKind = "industry" | "type" | "lead" | "title";

export type LabelRow = {
  name: string;
  count: number;
  // On the pick list (an option row exists and is not retired).
  onList: boolean;
  retired: boolean;
  builtIn?: boolean;
  // Company types: the industries it sits under.
  under?: string[];
  // Can't be renamed, merged away or retired (built-in lead labels, the
  // Distributor company type the supplier pickers rely on).
  locked?: boolean;
};

export type LabelSections = { industry: LabelRow[]; type: LabelRow[]; lead: LabelRow[]; title: LabelRow[]; titleTotal: number };

export const TITLE_LIMIT = 300;

const byName = (a: LabelRow, b: LabelRow) => a.name.localeCompare(b.name);

// A job title as the screen groups it: no outer spaces, inner runs as one,
// any case. The same rule as clean("title"), so a name picked on the
// screen finds every contact in its group.
const TITLE_KEY = Prisma.sql`lower(regexp_replace(btrim(title), '\\s+', ' ', 'g'))`;

export async function loadLabelSections(organizationId: string, titleQuery = ""): Promise<LabelSections> {
  const needle = titleQuery.trim().replace(/[%_\\]/g, " ").slice(0, 60);
  const [industryOptions, typeOptions, leadOptions, industryUse, typeUse, leadUse, titles, titleTotal, supplier] = await Promise.all([
    prisma.industryOption.findMany({ where: { organizationId }, select: { name: true, retiredAt: true } }),
    prisma.companyTypeOption.findMany({ where: { organizationId }, select: { name: true, retiredAt: true, industry: { select: { name: true } } } }),
    prisma.leadLabelOption.findMany({ where: { organizationId }, select: { name: true, retiredAt: true } }),
    prisma.$queryRaw<{ name: string; n: number }[]>`
      SELECT v AS name, count(*)::int AS n FROM "Company" c, unnest(c.industries) v
       WHERE c."organizationId" = ${organizationId} GROUP BY v`,
    prisma.$queryRaw<{ name: string; n: number }[]>`
      SELECT v AS name, count(*)::int AS n FROM "Company" c, unnest(c."companyTypes") v
       WHERE c."organizationId" = ${organizationId} GROUP BY v`,
    prisma.$queryRaw<{ name: string; n: number }[]>`
      SELECT "leadLabel" AS name, count(*)::int AS n FROM "Opportunity"
       WHERE "organizationId" = ${organizationId} AND "leadLabel" IS NOT NULL GROUP BY 1`,
    prisma.$queryRaw<{ name: string; n: number }[]>`
      SELECT mode() WITHIN GROUP (ORDER BY regexp_replace(btrim(title), '\\s+', ' ', 'g')) AS name, count(*)::int AS n
        FROM "Contact"
       WHERE "organizationId" = ${organizationId} AND btrim(coalesce(title, '')) <> ''
         ${needle ? Prisma.sql`AND title ILIKE ${`%${needle}%`}` : Prisma.empty}
       GROUP BY ${TITLE_KEY}
       ORDER BY n DESC, name
       LIMIT ${TITLE_LIMIT}`,
    prisma.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT ${TITLE_KEY})::int AS n FROM "Contact"
       WHERE "organizationId" = ${organizationId} AND btrim(coalesce(title, '')) <> ''`,
    supplierLabelNames(organizationId),
  ]);

  const industry = new Map<string, LabelRow>();
  for (const option of industryOptions) {
    industry.set(option.name, { name: option.name, count: 0, onList: !option.retiredAt, retired: Boolean(option.retiredAt) });
  }
  for (const use of industryUse) {
    const row = industry.get(use.name) ?? { name: use.name, count: 0, onList: false, retired: false };
    row.count = use.n;
    industry.set(use.name, row);
  }
  const serviceProvider = industry.get(supplier.industry);
  if (serviceProvider) serviceProvider.locked = true;

  const type = new Map<string, LabelRow>();
  for (const option of typeOptions) {
    const row = type.get(option.name) ?? { name: option.name, count: 0, onList: false, retired: true, under: [] };
    row.under!.push(option.industry.name);
    // On the list when any of its rows is; retired when all of them are.
    if (!option.retiredAt) {
      row.onList = true;
      row.retired = false;
    }
    type.set(option.name, row);
  }
  for (const use of typeUse) {
    const row = type.get(use.name) ?? { name: use.name, count: 0, onList: false, retired: false, under: [] };
    row.count = use.n;
    type.set(use.name, row);
  }
  // Only the spelling suppliers are found by (audit fix, Nov 10, 2026): a
  // stray "distributor" used to be locked too, so it could never be folded
  // into the real one.
  const distributor = type.get(supplier.type);
  if (distributor) distributor.locked = true;

  const lead = new Map<string, LabelRow>();
  for (const name of BUILT_IN_LEAD_LABELS) lead.set(name, { name, count: 0, onList: true, retired: false, builtIn: true, locked: true });
  for (const option of leadOptions) {
    if (lead.has(option.name)) continue;
    lead.set(option.name, { name: option.name, count: 0, onList: !option.retiredAt, retired: Boolean(option.retiredAt) });
  }
  for (const use of leadUse) {
    const row = lead.get(use.name) ?? { name: use.name, count: 0, onList: false, retired: false };
    row.count = use.n;
    lead.set(use.name, row);
  }

  return {
    industry: Array.from(industry.values()).sort(byName),
    type: Array.from(type.values()).sort(byName),
    lead: [...BUILT_IN_LEAD_LABELS.map((name) => lead.get(name)!), ...Array.from(lead.values()).filter((row) => !row.builtIn).sort(byName)],
    title: titles.map((row) => ({ name: row.name, count: row.n, onList: false, retired: false })),
    titleTotal: titleTotal[0]?.n ?? 0,
  };
}

// The Lead Label filter on the Contacts and Companies lists: N/A, the
// built-ins, and the workspace's own still on the pick list plus any an
// opportunity still carries.
export async function loadLeadLabelChoices(organizationId: string): Promise<string[]> {
  const [options, used] = await Promise.all([
    prisma.leadLabelOption.findMany({ where: { organizationId, retiredAt: null }, select: { name: true } }),
    prisma.opportunity.groupBy({ by: ["leadLabel"], where: { organizationId, leadLabel: { not: null } } }),
  ]);
  const custom = new Set([...options.map((o) => o.name), ...used.map((u) => u.leadLabel!)]);
  for (const name of BUILT_IN_LEAD_LABELS) custom.delete(name);
  return [NO_LEAD_LABEL, ...BUILT_IN_LEAD_LABELS, ...Array.from(custom).sort((a, b) => a.localeCompare(b))];
}

export type LabelResult = { error: string } | { message: string; records: number };

// Rewrites one value in a Company text array, keeping one of each
// (ignoring case) in the order the company had them. One statement; the
// GIN index on the column finds the companies carrying it.
function replaceInCompanies(column: "industries" | "companyTypes", organizationId: string, from: string, to: string) {
  const col = Prisma.raw(`"${column}"`);
  return prisma.$executeRaw`
    UPDATE "Company" c SET ${col} = ARRAY(
      SELECT s.v FROM (
        SELECT DISTINCT ON (lower(t.v)) t.v, t.o FROM (
          SELECT CASE WHEN u.x = ${from} THEN ${to} ELSE u.x END AS v, u.o
            FROM unnest(c.${col}) WITH ORDINALITY AS u(x, o)
        ) t ORDER BY lower(t.v), t.o
      ) s ORDER BY s.o)
     WHERE c."organizationId" = ${organizationId} AND c.${col} @> ARRAY[${from}]::text[]`;
}

function clean(kind: LabelKind, raw: string) {
  if (kind === "lead") return (raw ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_LEAD_LABEL_LENGTH);
  if (kind === "title") return (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  return cleanName(raw ?? "");
}

const RECORDS: Record<LabelKind, string> = { industry: "company", type: "company", lead: "opportunity", title: "contact" };
const plural = (kind: LabelKind, n: number) =>
  `${n.toLocaleString()} ${n === 1 ? RECORDS[kind] : RECORDS[kind] === "company" ? "companies" : RECORDS[kind] === "opportunity" ? "opportunities" : "contacts"}`;

// Does this exact value exist anywhere — on the pick list or on a record?
async function exists(kind: LabelKind, organizationId: string, name: string): Promise<boolean> {
  if (kind === "industry") {
    const [option, used] = await Promise.all([
      prisma.industryOption.findFirst({ where: { organizationId, name }, select: { id: true } }),
      prisma.company.findFirst({ where: { organizationId, industries: { has: name } }, select: { id: true } }),
    ]);
    return Boolean(option || used);
  }
  if (kind === "type") {
    const [option, used] = await Promise.all([
      prisma.companyTypeOption.findFirst({ where: { organizationId, name }, select: { id: true } }),
      prisma.company.findFirst({ where: { organizationId, companyTypes: { has: name } }, select: { id: true } }),
    ]);
    return Boolean(option || used);
  }
  if (kind === "lead") {
    if (isBuiltInLeadLabel(name)) return true;
    const [option, used] = await Promise.all([
      prisma.leadLabelOption.findFirst({ where: { organizationId, name }, select: { id: true } }),
      prisma.opportunity.findFirst({ where: { organizationId, leadLabel: name }, select: { id: true } }),
    ]);
    return Boolean(option || used);
  }
  const used = await prisma.$queryRaw<{ n: number }[]>`
    SELECT 1 AS n FROM "Contact" WHERE "organizationId" = ${organizationId} AND ${TITLE_KEY} = lower(${clean("title", name)}) LIMIT 1`;
  return used.length > 0;
}

// A name already taken ignoring case (other than `except` exactly), for
// rename. `except` is compared exactly in SQL (audit fix, Nov 10, 2026):
// Prisma's insensitive mode applied to `not` as well, so renaming "vip" to
// "VIP" ruled out "VIP" itself, the rename went ahead and hit the pick
// list's unique name.
async function takenIgnoringCase(kind: Exclude<LabelKind, "title">, organizationId: string, name: string, except: string): Promise<string | null> {
  if (kind === "lead") {
    const builtIn = BUILT_IN_LEAD_LABELS.find((label) => label.toLowerCase() === name.toLowerCase());
    if (builtIn) return builtIn;
    const rows = await prisma.$queryRaw<{ v: string }[]>`
      SELECT name AS v FROM "LeadLabelOption"
       WHERE "organizationId" = ${organizationId} AND lower(name) = lower(${name}) AND name <> ${except}
      UNION ALL
      SELECT "leadLabel" FROM "Opportunity"
       WHERE "organizationId" = ${organizationId} AND lower("leadLabel") = lower(${name}) AND "leadLabel" <> ${except}
      LIMIT 1`;
    return rows[0]?.v ?? null;
  }
  const column = kind === "industry" ? Prisma.raw("industries") : Prisma.raw(`"companyTypes"`);
  const table = kind === "industry" ? Prisma.raw(`"IndustryOption"`) : Prisma.raw(`"CompanyTypeOption"`);
  const rows = await prisma.$queryRaw<{ v: string }[]>`
    SELECT name AS v FROM ${table}
     WHERE "organizationId" = ${organizationId} AND lower(name) = lower(${name}) AND name <> ${except}
    UNION ALL
    SELECT v FROM "Company" c, unnest(c.${column}) v
     WHERE c."organizationId" = ${organizationId} AND lower(v) = lower(${name}) AND v <> ${except}
    LIMIT 1`;
  return rows[0]?.v ?? null;
}

async function lockedReason(organizationId: string, kind: LabelKind, name: string): Promise<string | null> {
  if (kind === "lead" && isBuiltInLeadLabel(name)) return `${name} is built in: it can be merged into, but not renamed, merged away or retired.`;
  if (kind !== "type" && kind !== "industry") return null;
  const supplier = await supplierLabelNames(organizationId);
  if (kind === "type" && name === supplier.type) return `${name} is how suppliers are found for products and quotes, so it stays as it is.`;
  if (kind === "industry" && name === supplier.industry) return `${name} is where new suppliers are filed, so it stays as it is.`;
  return null;
}

export async function renameLabel(organizationId: string, kind: LabelKind, rawFrom: string, rawTo: string): Promise<LabelResult> {
  const from = String(rawFrom ?? "");
  const to = clean(kind, rawTo);
  if (!to) return { error: "Type the new name." };
  if (kind === "lead" && to.toUpperCase() === NO_LEAD_LABEL) return { error: "N/A means no label; pick another name." };
  const locked = await lockedReason(organizationId, kind, from);
  if (locked) return { error: locked };
  if (to === from) return { error: "That's the name it already has." };
  if (!(await exists(kind, organizationId, from))) return { error: `"${from}" isn't used any more. Reload the page.` };
  // Renaming onto a name already in use is a merge; say so rather than
  // quietly folding two together.
  if (kind !== "title") {
    const taken = await takenIgnoringCase(kind, organizationId, to, from);
    if (taken) return { error: `"${taken}" already exists. Use Merge into… to fold "${from}" into it.` };
  }
  return rewrite(organizationId, kind, from, to, "rename");
}

export async function mergeLabel(organizationId: string, kind: LabelKind, rawFrom: string, rawInto: string): Promise<LabelResult> {
  const from = String(rawFrom ?? "");
  const into = kind === "lead" ? (canonicalLeadLabel(rawInto) ?? "") : clean(kind, rawInto);
  if (!into) return { error: "Pick what to merge it into." };
  const locked = await lockedReason(organizationId, kind, from);
  if (locked) return { error: locked };
  if (kind === "title" ? clean("title", from).toLowerCase() === into.toLowerCase() : from === into) return { error: "Pick a different one to merge into." };
  if (!(await exists(kind, organizationId, from))) return { error: `"${from}" isn't used any more. Reload the page.` };
  if (!(await exists(kind, organizationId, into))) return { error: `"${into}" isn't one of yours. Pick it from the list.` };
  return rewrite(organizationId, kind, from, into, "merge");
}

async function rewrite(organizationId: string, kind: LabelKind, from: string, to: string, how: "rename" | "merge"): Promise<LabelResult> {
  let records = 0;
  if (kind === "title") {
    records = await prisma.$executeRaw`
      UPDATE "Contact" SET title = ${to}
       WHERE "organizationId" = ${organizationId} AND ${TITLE_KEY} = lower(${clean("title", from)})`;
  } else if (kind === "lead") {
    const statements: Prisma.PrismaPromise<unknown>[] = [
      prisma.opportunity.updateMany({ where: { organizationId, leadLabel: from }, data: { leadLabel: to } }),
    ];
    if (how === "rename") {
      statements.push(prisma.leadLabelOption.updateMany({ where: { organizationId, name: from }, data: { name: to } }));
    } else {
      statements.push(prisma.leadLabelOption.deleteMany({ where: { organizationId, name: from } }));
    }
    // A custom label carried on the pick list only by its records gets a row.
    if (!isBuiltInLeadLabel(to)) {
      statements.push(prisma.leadLabelOption.createMany({ data: [{ organizationId, name: to }], skipDuplicates: true }));
    }
    const done = await prisma.$transaction(statements);
    records = (done[0] as { count: number }).count;
  } else if (kind === "industry") {
    const [fromOption, toOption] = await Promise.all([
      prisma.industryOption.findFirst({ where: { organizationId, name: from }, include: { companyTypes: { select: { id: true, name: true } } } }),
      prisma.industryOption.findFirst({ where: { organizationId, name: to }, include: { companyTypes: { select: { name: true } } } }),
    ]);
    const statements: Prisma.PrismaPromise<unknown>[] = [replaceInCompanies("industries", organizationId, from, to)];
    if (fromOption && !toOption) {
      // B has no pick-list row: A's row becomes B's, its types with it.
      statements.push(prisma.industryOption.update({ where: { id: fromOption.id }, data: { name: to } }));
    } else if (fromOption && toOption) {
      // A's company types move under B where B lacks them, then A goes.
      const have = new Set(toOption.companyTypes.map((type) => type.name.toLowerCase()));
      const move = fromOption.companyTypes.filter((type) => !have.has(type.name.toLowerCase())).map((type) => type.id);
      if (move.length) statements.push(prisma.companyTypeOption.updateMany({ where: { id: { in: move } }, data: { industryId: toOption.id } }));
      statements.push(prisma.industryOption.delete({ where: { id: fromOption.id } }));
    }
    const done = await prisma.$transaction(statements);
    records = done[0] as number;
  } else {
    const [fromOptions, toOptions] = await Promise.all([
      prisma.companyTypeOption.findMany({ where: { organizationId, name: from }, select: { id: true, industryId: true } }),
      prisma.companyTypeOption.findMany({ where: { organizationId, name: to }, select: { industryId: true } }),
    ]);
    const under = new Set(toOptions.map((option) => option.industryId));
    const clash = fromOptions.filter((option) => under.has(option.industryId)).map((option) => option.id);
    const free = fromOptions.filter((option) => !under.has(option.industryId)).map((option) => option.id);
    const statements: Prisma.PrismaPromise<unknown>[] = [replaceInCompanies("companyTypes", organizationId, from, to)];
    // Under an industry that already has B, A's row goes; elsewhere it is
    // renamed to B, so every industry that offered A now offers B.
    if (clash.length) statements.push(prisma.companyTypeOption.deleteMany({ where: { id: { in: clash } } }));
    if (free.length) statements.push(prisma.companyTypeOption.updateMany({ where: { id: { in: free } }, data: { name: to } }));
    const done = await prisma.$transaction(statements);
    records = done[0] as number;
  }
  const verb = how === "rename" ? `Renamed "${from}" to "${to}"` : `Merged "${from}" into "${to}"`;
  return { message: `${verb}: ${plural(kind, records)} changed.`, records };
}

export async function setLabelRetired(organizationId: string, kind: LabelKind, name: string, retired: boolean): Promise<LabelResult> {
  if (kind === "title") return { error: "Job titles have no pick list, so there's nothing to retire. Merge or rename instead." };
  const locked = await lockedReason(organizationId, kind, name);
  if (locked) return { error: locked };
  const retiredAt = retired ? new Date() : null;
  const result =
    kind === "industry"
      ? await prisma.industryOption.updateMany({ where: { organizationId, name }, data: { retiredAt } })
      : kind === "type"
        ? await prisma.companyTypeOption.updateMany({ where: { organizationId, name }, data: { retiredAt } })
        : await prisma.leadLabelOption.updateMany({ where: { organizationId, name }, data: { retiredAt } });
  if (result.count === 0) {
    if (!retired) return { error: `"${name}" isn't on the pick list any more. Reload the page.` };
    return { error: `"${name}" isn't on the pick list (it was typed on a record), so there's nothing to retire.` };
  }
  return {
    message: retired
      ? `Retired "${name}": it's off the pick lists, and the records that have it keep it.`
      : `"${name}" is back on the pick lists.`,
    records: 0,
  };
}
