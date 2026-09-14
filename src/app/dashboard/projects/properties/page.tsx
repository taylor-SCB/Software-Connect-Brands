import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { parseStages, rollUp } from "@/lib/properties";
import { PageHeader, Card, CardHeader, Meter, EmptyState, Badge } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { IconBuilding } from "@/components/icons";
import { NewPropertyButton } from "./property-form";
import { StageChips } from "./stage-chips";

// Far more buildings than a service business has, and low enough that
// the nested read of their jobs stays cheap.
const MAX_PROPERTIES = 200;

const TOTALS = {
  stage: true,
  awardedCents: true,
  spentCents: true,
  committedCents: true,
  receivedCents: true,
  billedCents: true,
  laborSpentCents: true,
  laborCommittedCents: true,
} as const;

// Every building, with what has been awarded and spent across the jobs at
// it. The bar is a sum of the jobs' own numbers, so it can never disagree
// with them.
export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ stages?: string | string[] }>;
}) {
  const { organizationId } = await requireSession();
  const params = await searchParams;
  const stages = parseStages(params.stages);

  const [properties, companies, contacts, loose] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      // Capped rather than paged: a building is a thing somebody types in
      // by hand, so a workspace has tens of them, not thousands. The cap
      // is what stops one render pulling every job in the database
      // through the nested read. Paging and a search box go in with the
      // other list pages (see Known gaps in CLAUDE.md).
      take: MAX_PROPERTIES,
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        state: true,
        company: { select: { id: true, name: true } },
        projects: { select: { id: true, ...TOTALS } },
      },
    }),
    prisma.company.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, name: true },
    }),
    prisma.contact.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, name: true },
    }),
    // Jobs at no property at all, so nothing is quietly left out of every
    // roll-up without anybody noticing.
    prisma.project.count({ where: { organizationId, propertyId: null } }),
  ]);

  const rows = properties
    .map((property) => ({ property, totals: rollUp(property.projects, stages) }))
    .sort((a, b) => b.totals.awardedCents - a.totals.awardedCents);

  return (
    <div>
      <BackLink href="/dashboard/projects" label="Projects" />

      <PageHeader
        eyebrow="Projects"
        title="Properties"
        subtitle="A building at a time: what was awarded across every job there, and what is left."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <StageChips stages={stages} basePath="/dashboard/projects/properties" />
        <NewPropertyButton companies={companies} contacts={contacts} />
      </div>

      {rows.length === 0 ? (
        <Card lit>
          <EmptyState
            icon={<IconBuilding size={20} />}
            title="No properties yet"
            body="Make one for a building you work at more than once, then put its jobs on it. The budget rolls up on its own."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map(({ property, totals }) => {
            const used = totals.spentCents + totals.committedCents;
            const where = [property.address, property.city, property.state].filter(Boolean).join(", ");
            return (
              <Card key={property.id} lit>
                <CardHeader
                  title={property.name}
                  subtitle={where || undefined}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      {property.company && (
                        <Link href={`/dashboard/companies/${property.company.id}`} className="link text-xs">
                          {property.company.name}
                        </Link>
                      )}
                      <Badge color="#818cf8">
                        {totals.jobs} {totals.jobs === 1 ? "job" : "jobs"}
                      </Badge>
                      <Link
                        href={`/dashboard/projects/properties/${property.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Open
                      </Link>
                    </div>
                  }
                />
                <div
                  className="space-y-2 p-5"
                  data-testid="property-row"
                  data-property-id={property.id}
                  data-awarded={totals.awardedCents}
                >
                  {totals.jobs === 0 ? (
                    <p className="faint text-xs">
                      No jobs counted here with the stages currently on.
                    </p>
                  ) : (
                    <>
                      <Meter
                        max={totals.awardedCents}
                        segments={[
                          { cents: totals.spentCents, tone: "spent" },
                          { cents: totals.committedCents, tone: "committed" },
                        ]}
                        label={`${formatCents(used)} of ${formatCents(totals.awardedCents)} used at ${property.name}`}
                      />
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                        <span className="muted">
                          Awarded <span className="num font-medium">{formatCents(totals.awardedCents)}</span>
                        </span>
                        <span className="muted">
                          Spent <span className="num font-medium">{formatCents(totals.spentCents)}</span>
                        </span>
                        <span className="muted">
                          Committed{" "}
                          <span className="num font-medium">{formatCents(totals.committedCents)}</span>
                        </span>
                        <span className="muted">
                          Left{" "}
                          <span
                            className={`num font-medium ${totals.leftCents < 0 ? "text-[var(--danger)]" : ""}`}
                            data-testid="property-left"
                          >
                            {totals.leftCents < 0
                              ? `Over by ${formatCents(-totals.leftCents)}`
                              : formatCents(totals.leftCents)}
                          </span>
                        </span>
                        {totals.stillOwedCents > 0 && (
                          <span className="muted">
                            Still owed{" "}
                            <span className="num font-medium">{formatCents(totals.stillOwedCents)}</span>
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {rows.length >= MAX_PROPERTIES && (
        <p className="faint mt-5 text-xs" data-testid="property-cap">
          Showing the first {MAX_PROPERTIES} buildings by name.
        </p>
      )}

      {loose > 0 && (
        <p className="faint mt-5 text-xs" data-testid="loose-jobs">
          {loose} {loose === 1 ? "job is" : "jobs are"} at no property, so {loose === 1 ? "it is" : "they are"}{" "}
          in none of these totals. Put {loose === 1 ? "it" : "them"} on one from the job&apos;s own page.
        </p>
      )}
    </div>
  );
}
