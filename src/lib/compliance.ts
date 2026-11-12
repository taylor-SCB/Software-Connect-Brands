import { prisma } from "@/lib/prisma";
import { complianceFlags, type ComplianceFlag } from "@/lib/contract-checks";
import { limitsOf, type ComplianceLimit } from "@/lib/compliance-shared";

// The compliance watchdog's reads (Release B, Nov 12, 2026): which of the
// workspace's own papers, and which subcontractors' papers, have run out,
// run out within 30 days, or are made out to somebody else. No AI here;
// these flags show whether or not the key is set.

// The workspace's own files that need a look, for the Compliance tile.
export async function workspaceComplianceFlagCount(organizationId: string): Promise<number> {
  const [organization, docs] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    prisma.upload.findMany({
      where: { organizationId, kind: "COMPLIANCE", OR: [{ compliance: null }, { compliance: { crewId: null } }] },
      take: 500,
      select: { expiresOn: true, compliance: { select: { namedInsured: true } } },
    }),
  ]);
  return docs.filter((doc) => complianceFlags({ expiresOn: doc.expiresOn, namedInsured: doc.compliance?.namedInsured ?? null }, organization?.name ?? null).length > 0).length;
}

export type CrewComplianceDoc = {
  id: string;
  name: string;
  fileName: string;
  category: string | null;
  expiresOn: Date | null;
  publicToken: string;
  createdAt: Date;
  sizeBytes: number;
  namedInsured: string | null;
  insurer: string | null;
  policyNumber: string | null;
  limits: ComplianceLimit[];
  flags: ComplianceFlag[];
};

// Each crew's compliance files with their flags, in one read. A crew's
// papers should name the company that bills you, else the crew.
export async function crewComplianceDocs(organizationId: string, crews: { id: string; name: string; companyName: string | null }[]) {
  const result = new Map<string, CrewComplianceDoc[]>();
  if (crews.length === 0) return result;
  const rows = await prisma.complianceInfo.findMany({
    where: { organizationId, crewId: { in: crews.map((crew) => crew.id) } },
    orderBy: { createdAt: "desc" },
    select: {
      crewId: true,
      namedInsured: true,
      insurer: true,
      policyNumber: true,
      limits: true,
      upload: { select: { id: true, name: true, fileName: true, category: true, expiresOn: true, publicToken: true, createdAt: true, sizeBytes: true } },
    },
  });
  const byId = new Map(crews.map((crew) => [crew.id, crew]));
  for (const row of rows) {
    if (!row.crewId) continue;
    const crew = byId.get(row.crewId);
    const list = result.get(row.crewId) ?? [];
    list.push({
      ...row.upload,
      namedInsured: row.namedInsured,
      insurer: row.insurer,
      policyNumber: row.policyNumber,
      limits: limitsOf(row.limits),
      flags: complianceFlags({ expiresOn: row.upload.expiresOn, namedInsured: row.namedInsured }, crew?.companyName ?? crew?.name ?? null),
    });
    result.set(row.crewId, list);
  }
  return result;
}

// The worst flag across a crew's papers, for a badge: an expired one beats
// one running out, which beats a name.
export function worstFlag(docs: { flags: ComplianceFlag[]; category: string | null }[]): { flag: ComplianceFlag; category: string | null } | null {
  for (const flag of ["EXPIRED", "EXPIRING", "NAME"] as ComplianceFlag[]) {
    const doc = docs.find((row) => row.flags.includes(flag));
    if (doc) return { flag, category: doc.category };
  }
  return null;
}
