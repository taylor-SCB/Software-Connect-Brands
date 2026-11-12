import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { crewComplianceDocs, worstFlag } from "@/lib/compliance";

// Release B, the compliance watchdog on a job: a subcontractor scheduled
// here (on a scope of work or a day on the calendar) whose COI, license or
// W-9 has run out, runs out within 30 days, names somebody else, or isn't
// on file at all. Nothing when everyone's papers are in order.
export async function JobComplianceBanner({ organizationId, projectId }: { organizationId: string; projectId: string }) {
  const crews = await prisma.crew.findMany({
    where: {
      organizationId,
      kind: "SUBCONTRACTOR",
      OR: [{ scopes: { some: { projectId } } }, { events: { some: { projectId } } }],
    },
    orderBy: { name: "asc" },
    take: 50,
    select: { id: true, name: true, company: { select: { name: true } } },
  });
  if (crews.length === 0) return null;
  const docs = await crewComplianceDocs(
    organizationId,
    crews.map((crew) => ({ id: crew.id, name: crew.name, companyName: crew.company?.name ?? null })),
  );
  const lines = crews.flatMap((crew) => {
    const list = docs.get(crew.id) ?? [];
    if (list.length === 0) return [{ crew, text: "has no COI on file" }];
    const worst = worstFlag(list);
    if (!worst) return [];
    const what = worst.category && worst.category !== "Other" ? worst.category : "paperwork";
    const text =
      worst.flag === "EXPIRED"
        ? `${what} has expired`
        : worst.flag === "EXPIRING"
          ? `${what} runs out within 30 days`
          : `${what} is made out to another name`;
    return [{ crew, text }];
  });
  if (lines.length === 0) return null;
  return (
    <div
      role="note"
      className="mb-5 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_7%,transparent)] px-4 py-3 text-sm"
      data-testid="job-compliance"
    >
      <p className="font-semibold text-[var(--text-strong)]">Subcontractor paperwork</p>
      <ul className="mt-1 space-y-0.5">
        {lines.map(({ crew, text }) => (
          <li key={crew.id} data-testid="job-compliance-line">
            <Link href="/dashboard/projects/crews" className="link">
              {crew.name}
            </Link>
            <span className="text-[var(--text-strong)]">: {text}.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
