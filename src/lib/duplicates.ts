import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Duplicate radar and "One person, every company" (Oct 2, 2026).
//
// Finding twins is plain matching, not AI: the same phone number written
// three ways, the same email in either slot, "Matt" and "Matthew" at one
// company, the same name twice. It is free, it is instant at 200,000
// contacts, and every suggestion says exactly what matched so a person can
// judge it. The fix is always today's Merge — which, for one person filed
// at two companies, keeps one record and turns the other company into an
// Additional Account.
//
// A pair dismissed with "Not the same person" is remembered in
// DuplicateDismissal and never offered again.

export type DupKind = "contact" | "company";

export type DupReason = "phone" | "email" | "name" | "nickname" | "website";

export const REASON_LABELS: Record<DupReason, string> = {
  phone: "Same phone number",
  email: "Same email",
  name: "Same name",
  nickname: "Nickname at the same company",
  website: "Same website",
};

export type DupRecord = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  email2?: string | null;
  phone2?: string | null;
  companyId?: string | null;
  company?: string | null;
  city: string | null;
  state: string | null;
  status: string;
  createdAt: Date;
};

export type DupPair = {
  a: DupRecord;
  b: DupRecord;
  reasons: DupReason[];
  // "strong": a channel matched, or a name inside one company. "weak": the
  // name and nothing else, across companies or cities.
  strength: "strong" | "weak";
  // Contacts only: the two are filed under different main companies, so
  // merging them makes the other company an Additional Account.
  acrossCompanies: boolean;
};

// Groups bigger than this are a shared office line or info@ inbox, not one
// person written twice.
const MAX_GROUP = 6;
export const MAX_PAIRS = 200;

/* --------------------------------- Names --------------------------------- */

const NICKNAMES: Record<string, string> = {
  matt: "matthew", mat: "matthew", mike: "michael", mick: "michael", mikey: "michael", bob: "robert", rob: "robert",
  bobby: "robert", robbie: "robert", bill: "william", will: "william", billy: "william", willy: "william", liam: "william",
  jim: "james", jimmy: "james", jamie: "james", tom: "thomas", tommy: "thomas", dave: "david", davey: "david",
  dan: "daniel", danny: "daniel", joe: "joseph", joey: "joseph", jon: "jonathan", johnny: "john", jack: "john",
  chris: "christopher", kris: "christopher", steve: "steven", stephen: "steven", rick: "richard", rich: "richard",
  dick: "richard", ricky: "richard", tony: "anthony", ed: "edward", eddie: "edward", ted: "edward", nick: "nicholas",
  andy: "andrew", drew: "andrew", greg: "gregory", jeff: "jeffrey", geoff: "jeffrey", ken: "kenneth", kenny: "kenneth",
  larry: "lawrence", ron: "ronald", ronnie: "ronald", don: "donald", sam: "samuel", sammy: "samuel", ben: "benjamin",
  benny: "benjamin", pat: "patrick", charlie: "charles", chuck: "charles", chas: "charles", frank: "francis",
  fred: "frederick", freddy: "frederick", gene: "eugene", hank: "henry", harry: "henry", jerry: "gerald", josh: "joshua",
  alex: "alexander", al: "albert", ray: "raymond", tim: "timothy", timmy: "timothy", vince: "vincent", zach: "zachary",
  zack: "zachary", nate: "nathan", nat: "nathan", phil: "phillip", philip: "phillip", russ: "russell", stan: "stanley",
  walt: "walter", wes: "wesley", liz: "elizabeth", beth: "elizabeth", betty: "elizabeth", lizzie: "elizabeth",
  kate: "katherine", katie: "katherine", kathy: "katherine", cathy: "katherine", kat: "katherine", catherine: "katherine",
  kathryn: "katherine", jen: "jennifer", jenny: "jennifer", jenn: "jennifer", sue: "susan", suzy: "susan",
  peggy: "margaret", maggie: "margaret", meg: "margaret", pam: "pamela", becky: "rebecca", becca: "rebecca",
  vicky: "victoria", tori: "victoria", abby: "abigail", deb: "deborah", debbie: "deborah", sandy: "sandra",
  cindy: "cynthia", mandy: "amanda", manda: "amanda", jess: "jessica", jessie: "jessica", chrissy: "christine",
  tina: "christina", nancy: "ann", annie: "ann", anne: "ann", sally: "sarah", sara: "sarah", patty: "patricia",
  trish: "patricia", tricia: "patricia", val: "valerie", gabby: "gabrielle", lexi: "alexandra",
  sasha: "alexandra", ally: "allison", allie: "allison", alison: "allison", steph: "stephanie", terri: "theresa",
  teresa: "theresa", tess: "theresa", angie: "angela", nikki: "nicole", dot: "dorothy", dottie: "dorothy",
};

function cleanName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(mr|mrs|ms|dr|jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalFirst(first: string) {
  return NICKNAMES[first] ?? first;
}

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

/** Whether two first names are plausibly the same person's: Matt/Matthew, Jon/John, Kathy/Katherine. */
export function sameFirstName(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ca = canonicalFirst(a);
  const cb = canonicalFirst(b);
  if (ca === cb) return true;
  // "Matt" inside "Matthew", "Sam" inside "Samantha": a prefix of three or more.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  // One letter off: Jon / John, Steven / Stephen is in the map already.
  return short.length >= 3 && editDistance(a, b) <= 1;
}

/** Whether two full names could be one person: same last name, first names that match as above. */
export function namesMatch(a: string, b: string) {
  const pa = cleanName(a).split(" ").filter(Boolean);
  const pb = cleanName(b).split(" ").filter(Boolean);
  if (pa.length === 0 || pb.length === 0) return false;
  if (pa.join(" ") === pb.join(" ")) return true;
  if (pa.length < 2 || pb.length < 2) return false;
  return pa[pa.length - 1] === pb[pb.length - 1] && sameFirstName(pa[0], pb[0]);
}

/** The digits that identify a phone number: the last ten, ignoring +1, dashes and brackets. */
export function phoneKey(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
}

export function emailKey(email: string | null | undefined) {
  const value = (email ?? "").trim().toLowerCase();
  return value.includes("@") ? value : null;
}

const COMPANY_NOISE = /\b(the|inc|incorporated|llc|l l c|ltd|limited|co|corp|corporation|company|pllc|lp|llp|group)\b/g;

export function companyNameKey(name: string) {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(COMPANY_NOISE, " ").replace(/\s+/g, "").trim();
}

export function websiteKey(website: string | null | undefined) {
  const value = (website ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return value.includes(".") ? value : null;
}

/* ------------------------------ Pair building ----------------------------- */

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

class PairSet {
  reasons = new Map<string, Set<DupReason>>();
  add(ids: string[], reason: DupReason) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (ids[i] === ids[j]) continue;
        const key = pairKey(ids[i], ids[j]);
        const set = this.reasons.get(key) ?? new Set<DupReason>();
        set.add(reason);
        this.reasons.set(key, set);
      }
    }
  }
}

async function dismissedKeys(organizationId: string, kind: DupKind) {
  const rows = await prisma.duplicateDismissal.findMany({ where: { organizationId, kind }, select: { aId: true, bId: true } });
  return new Set(rows.map((row) => pairKey(row.aId, row.bId)));
}

const CONTACT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  email2: true,
  phone2: true,
  city: true,
  state: true,
  status: true,
  createdAt: true,
  companyId: true,
  company: { select: { name: true } },
} as const;

type ContactRow = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>;

function contactRecord(row: ContactRow): DupRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    email2: row.email2,
    phone2: row.phone2,
    companyId: row.companyId,
    company: row.company?.name ?? null,
    city: row.city,
    state: row.state,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function strengthOf(reasons: Set<DupReason>, sameHome: boolean): "strong" | "weak" {
  if (reasons.has("phone") || reasons.has("email") || reasons.has("nickname") || reasons.has("website")) return "strong";
  return sameHome ? "strong" : "weak";
}

function orderPair(x: DupRecord, y: DupRecord): [DupRecord, DupRecord] {
  // The older record first: it is usually the one to keep.
  return x.createdAt <= y.createdAt ? [x, y] : [y, x];
}

function rank(pairs: DupPair[]) {
  return pairs.sort((p, q) => {
    if (p.strength !== q.strength) return p.strength === "strong" ? -1 : 1;
    if (p.reasons.length !== q.reasons.length) return q.reasons.length - p.reasons.length;
    return p.a.name.localeCompare(q.a.name);
  });
}

async function contactPairsFrom(organizationId: string, found: PairSet, limit: number): Promise<DupPair[]> {
  const dismissed = await dismissedKeys(organizationId, "contact");
  const keys = [...found.reasons.keys()].filter((key) => !dismissed.has(key));
  const ids = [...new Set(keys.flatMap((key) => key.split("|")))];
  const rows = ids.length
    ? await prisma.contact.findMany({ where: { organizationId, id: { in: ids }, status: { not: "ARCHIVED" } }, select: CONTACT_SELECT })
    : [];
  const byId = new Map(rows.map((row) => [row.id, contactRecord(row)]));
  const pairs: DupPair[] = [];
  for (const key of keys) {
    const [x, y] = key.split("|").map((id) => byId.get(id));
    if (!x || !y) continue;
    const reasons = found.reasons.get(key)!;
    const acrossCompanies = Boolean(x.companyId && y.companyId && x.companyId !== y.companyId);
    // The same name at two different companies, with nothing else in
    // common, is usually two different people; offer it only when one of
    // them has no company at all or both share one.
    const sameHome = !acrossCompanies;
    const [a, b] = orderPair(x, y);
    pairs.push({ a, b, reasons: [...reasons], strength: strengthOf(reasons, sameHome), acrossCompanies });
  }
  return rank(pairs).slice(0, limit);
}

/** Every likely pair of twins in the workspace's contacts, strongest first. */
export async function findContactDuplicates(organizationId: string, limit = MAX_PAIRS): Promise<DupPair[]> {
  const found = new PairSet();
  const [phones, emails, names, families] = await Promise.all([
    prisma.$queryRaw<{ ids: string[] }[]>`
      WITH p AS (
        SELECT id, right(regexp_replace(phone, '\\D', '', 'g'), 10) AS d FROM "Contact"
          WHERE "organizationId" = ${organizationId} AND phone IS NOT NULL AND status <> 'ARCHIVED'
        UNION ALL
        SELECT id, right(regexp_replace(phone2, '\\D', '', 'g'), 10) FROM "Contact"
          WHERE "organizationId" = ${organizationId} AND phone2 IS NOT NULL AND status <> 'ARCHIVED'
      )
      SELECT array_agg(DISTINCT id) AS ids FROM p WHERE length(d) >= 7
      GROUP BY d HAVING count(DISTINCT id) BETWEEN 2 AND ${MAX_GROUP} LIMIT 2000`,
    prisma.$queryRaw<{ ids: string[] }[]>`
      WITH e AS (
        SELECT id, lower(trim(email)) AS v FROM "Contact"
          WHERE "organizationId" = ${organizationId} AND email IS NOT NULL AND status <> 'ARCHIVED'
        UNION ALL
        SELECT id, lower(trim(email2)) FROM "Contact"
          WHERE "organizationId" = ${organizationId} AND email2 IS NOT NULL AND status <> 'ARCHIVED'
      )
      SELECT array_agg(DISTINCT id) AS ids FROM e WHERE v LIKE '%@%'
      GROUP BY v HAVING count(DISTINCT id) BETWEEN 2 AND ${MAX_GROUP} LIMIT 2000`,
    prisma.$queryRaw<{ ids: string[] }[]>`
      SELECT array_agg(id) AS ids FROM "Contact"
      WHERE "organizationId" = ${organizationId} AND status <> 'ARCHIVED'
      GROUP BY regexp_replace(lower(trim(name)), '[^a-z]+', '', 'g')
      HAVING count(*) BETWEEN 2 AND ${MAX_GROUP} AND length(regexp_replace(lower(trim(name)), '[^a-z]+', '', 'g')) >= 4
      LIMIT 2000`,
    // People at one company sharing a last name: compared by first name
    // below (Matt / Matthew). Capped per company so a family business of
    // thirty Smiths is not thirty-squared pairs.
    prisma.$queryRaw<{ ids: string[]; names: string[] }[]>`
      SELECT array_agg(id) AS ids, array_agg(name) AS names FROM "Contact"
      WHERE "organizationId" = ${organizationId} AND "companyId" IS NOT NULL AND status <> 'ARCHIVED' AND name LIKE '% %'
      GROUP BY "companyId", lower(regexp_replace(name, '^.*\\s', ''))
      HAVING count(*) BETWEEN 2 AND 12
      LIMIT 2000`,
  ]);
  for (const row of phones) found.add(row.ids, "phone");
  for (const row of emails) found.add(row.ids, "email");
  for (const row of names) found.add(row.ids, "name");
  for (const row of families) {
    for (let i = 0; i < row.ids.length; i++) {
      for (let j = i + 1; j < row.ids.length; j++) {
        if (cleanName(row.names[i]) === cleanName(row.names[j])) continue; // caught as "name"
        if (namesMatch(row.names[i], row.names[j])) found.add([row.ids[i], row.ids[j]], "nickname");
      }
    }
  }
  return contactPairsFrom(organizationId, found, limit);
}

/**
 * The likely twins of one contact: the card on their page. Looked up by
 * that person's own phone, email and name through the indexes, so it is
 * quick however big the workspace is.
 */
export async function findTwinsOf(organizationId: string, contactId: string): Promise<DupPair[]> {
  const me = await prisma.contact.findFirst({ where: { id: contactId, organizationId }, select: CONTACT_SELECT });
  if (!me) return [];
  const phones = [phoneKey(me.phone), phoneKey(me.phone2)].filter((value): value is string => Boolean(value));
  const emails = [emailKey(me.email), emailKey(me.email2)].filter((value): value is string => Boolean(value));
  const parts = cleanName(me.name).split(" ").filter(Boolean);
  const last = parts.length >= 2 ? parts[parts.length - 1] : null;

  const or: Prisma.ContactWhereInput[] = [];
  // The last seven digits, found with the trigram index and checked
  // exactly below, so (512) 555-0101 finds 512.555.0101.
  for (const digits of phones) {
    const tail = digits.slice(-4);
    or.push({ phone: { contains: tail } }, { phone2: { contains: tail } });
  }
  for (const email of emails) {
    or.push({ email: { equals: email, mode: "insensitive" } }, { email2: { equals: email, mode: "insensitive" } });
  }
  or.push({ name: { equals: me.name.trim(), mode: "insensitive" } });
  if (last && me.companyId) or.push({ companyId: me.companyId, name: { endsWith: last, mode: "insensitive" } });

  const others = await prisma.contact.findMany({
    where: { organizationId, id: { not: me.id }, status: { not: "ARCHIVED" }, OR: or },
    select: CONTACT_SELECT,
    take: 500,
  });

  const found = new PairSet();
  const myName = cleanName(me.name);
  for (const other of others) {
    const ids = [me.id, other.id];
    const theirPhones = [phoneKey(other.phone), phoneKey(other.phone2)];
    if (phones.some((value) => theirPhones.includes(value))) found.add(ids, "phone");
    const theirEmails = [emailKey(other.email), emailKey(other.email2)];
    if (emails.some((value) => theirEmails.includes(value))) found.add(ids, "email");
    const theirName = cleanName(other.name);
    if (theirName === myName && myName.replace(/\s/g, "").length >= 4) found.add(ids, "name");
    else if (me.companyId && other.companyId === me.companyId && namesMatch(me.name, other.name)) found.add(ids, "nickname");
  }
  const pairs = await contactPairsFrom(organizationId, found, 20);
  // Shown from this person's side: them first.
  return pairs.map((pair) => (pair.a.id === me.id ? pair : { ...pair, a: pair.b, b: pair.a }));
}

/* -------------------------------- Companies ------------------------------- */

export async function findCompanyDuplicates(organizationId: string, limit = MAX_PAIRS): Promise<DupPair[]> {
  const found = new PairSet();
  const [names, phones, sites] = await Promise.all([
    prisma.$queryRaw<{ ids: string[] }[]>`
      SELECT array_agg(id) AS ids FROM "Company"
      WHERE "organizationId" = ${organizationId} AND status <> 'ARCHIVED'
      GROUP BY regexp_replace(
        regexp_replace(regexp_replace(lower(replace(name, '&', ' and ')), '[^a-z0-9 ]+', ' ', 'g'),
          '\\m(the|inc|incorporated|llc|ltd|limited|co|corp|corporation|company|pllc|lp|llp|group)\\M', ' ', 'g'),
        '\\s+', '', 'g')
      HAVING count(*) BETWEEN 2 AND ${MAX_GROUP}
      LIMIT 2000`,
    prisma.$queryRaw<{ ids: string[] }[]>`
      SELECT array_agg(id) AS ids FROM "Company"
      WHERE "organizationId" = ${organizationId} AND phone IS NOT NULL AND status <> 'ARCHIVED'
        AND length(regexp_replace(phone, '\\D', '', 'g')) >= 7
      GROUP BY right(regexp_replace(phone, '\\D', '', 'g'), 10)
      HAVING count(*) BETWEEN 2 AND ${MAX_GROUP}
      LIMIT 2000`,
    prisma.$queryRaw<{ ids: string[] }[]>`
      SELECT array_agg(id) AS ids FROM "Company"
      WHERE "organizationId" = ${organizationId} AND website IS NOT NULL AND website LIKE '%.%' AND status <> 'ARCHIVED'
      GROUP BY split_part(regexp_replace(regexp_replace(lower(trim(website)), '^https?://', ''), '^www\\.', ''), '/', 1)
      HAVING count(*) BETWEEN 2 AND ${MAX_GROUP}
      LIMIT 2000`,
  ]);
  for (const row of names) found.add(row.ids, "name");
  for (const row of phones) found.add(row.ids, "phone");
  for (const row of sites) found.add(row.ids, "website");

  const dismissed = await dismissedKeys(organizationId, "company");
  const keys = [...found.reasons.keys()].filter((key) => !dismissed.has(key));
  const ids = [...new Set(keys.flatMap((key) => key.split("|")))];
  const rows = ids.length
    ? await prisma.company.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, name: true, email: true, phone: true, city: true, state: true, status: true, createdAt: true },
      })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pairs: DupPair[] = [];
  for (const key of keys) {
    const [x, y] = key.split("|").map((id) => byId.get(id));
    if (!x || !y) continue;
    const reasons = found.reasons.get(key)!;
    // Two Acme Roofings in different cities are often two businesses.
    const sameCity = !x.city || !y.city || x.city.trim().toLowerCase() === y.city.trim().toLowerCase();
    const [a, b] = orderPair(x, y);
    pairs.push({ a, b, reasons: [...reasons], strength: strengthOf(reasons, sameCity), acrossCompanies: false });
  }
  return rank(pairs).slice(0, limit);
}

export async function dismissPair(organizationId: string, userId: string, kind: DupKind, x: string, y: string) {
  const [aId, bId] = x < y ? [x, y] : [y, x];
  await prisma.duplicateDismissal.upsert({
    where: { organizationId_kind_aId_bId: { organizationId, kind, aId, bId } },
    create: { organizationId, kind, aId, bId, userId },
    update: {},
  });
}

/* ------------------------------ The list badge ----------------------------- */

// The "N possible" badge beside Merge shows what the radar last found. The
// full check reads every record, so it runs only on the radar page and at
// the end of an import — never when a list opens.
export async function storedDuplicateCount(organizationId: string, kind: DupKind) {
  const row = await prisma.duplicateScan.findUnique({ where: { organizationId_kind: { organizationId, kind } }, select: { count: true } });
  return row?.count ?? null;
}

export async function scanDuplicates(organizationId: string, kind: DupKind) {
  const pairs = kind === "contact" ? await findContactDuplicates(organizationId) : await findCompanyDuplicates(organizationId);
  await saveDuplicateCount(organizationId, kind, pairs.length);
  return pairs;
}

export async function saveDuplicateCount(organizationId: string, kind: DupKind, count: number) {
  await prisma.duplicateScan.upsert({
    where: { organizationId_kind: { organizationId, kind } },
    create: { organizationId, kind, count },
    update: { count, scannedAt: new Date() },
  });
}
