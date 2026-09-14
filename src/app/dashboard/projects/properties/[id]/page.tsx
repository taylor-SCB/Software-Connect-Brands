import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { leftCents } from "@/lib/projects";
import { parseStages, rollUp } from "@/lib/properties";
import { PROJECT_STAGE_LABELS } from "@/lib/constants";
import { PageHeader, Card, CardHeader, StatTile, Meter, StatusBadge, EmptyState } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { IconHardHat } from "@/components/icons";
import { DeleteRecordForm } from "@/components/delete-record-form";
import { PropertyForm } from "../property-form";
import { StageChips } from "../stage-chips";
import { PickJobs, type JobChoice } from "./pick-jobs";
import { deleteProperty } from "../actions";

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

// One building: its roll-up, and every job at it. The bar is the sum of
// the jobs below it, so the two can never disagree.
export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stages?: string }>;
}) {
  const { organizationId } = await requireSession();
  const { id } = await params;
  const stages = parseStages((await searchParams).stages);

  const [property, companies, contacts, allJobs] = await Promise.all([
    prisma.property.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        state: true,
        notes: true,
        companyId: true,
        contactId: true,
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
        projects: {
          orderBy: { number: "desc" },
          select: { id: true, number: true, name: true, customerName: true, ...TOTALS },
        },
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
    prisma.project.findMany({
      where: { organizationId },
      orderBy: { number: "desc" },
      take: 300,
      select: {
        id: true,
        number: true,
        name: true,
        stage: true,
        awardedCents: true,
        propertyId: true,
        property: { select: { name: true } },
      },
    }),
  ]);
  if (!property) notFound();

  const totals = rollUp(property.projects, stages);
  const used = totals.spentCents + totals.committedCents;
  const where = [property.address, property.city, property.state].filter(Boolean).join(", ");
  const basePath = `/dashboard/projects/properties/${property.id}`;

  const jobChoices: JobChoice[] = allJobs.map((job) => ({
    id: job.id,
    number: job.number,
    name: job.name,
    stage: job.stage,
    awardedCents: job.awardedCents,
    onOther: job.propertyId && job.propertyId !== property.id ? (job.property?.name ?? "another property") : null,
  }));

  // Shown even when the stage chips exclude them, so nothing at the
  // building is invisible — they just do not count toward the bar.
  const counted = new Set(property.projects.filter((job) => stages.includes(job.stage)).map((job) => job.id));

  return (
    <div>
      <BackLink href="/dashboard/projects/properties" label="Properties" current={property.name} />

      <PageHeader
        eyebrow="Property"
        title={property.name}
        subtitle={where || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {property.company && (
              <Link href={`/dashboard/companies/${property.company.id}`} className="btn btn-ghost btn-sm">
                {property.company.name}
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-4">
        <StageChips stages={stages} basePath={basePath} />
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Awarded here"
          value={formatCents(totals.awardedCents)}
          hint={`Across ${totals.jobs} ${totals.jobs === 1 ? "job" : "jobs"}`}
        />
        <StatTile label="Spent" value={formatCents(totals.spentCents)} hint="Paid out" accent="#fbbf24" />
        <StatTile
          label="Committed"
          value={formatCents(totals.committedCents)}
          hint="Ordered or logged, not paid"
          accent="#a78bfa"
        />
        <StatTile
          label="Left"
          value={
            totals.leftCents < 0 ? `Over by ${formatCents(-totals.leftCents)}` : formatCents(totals.leftCents)
          }
          hint="Awarded less spent and committed"
          accent={totals.leftCents < 0 ? "#f87171" : "#34d399"}
        />
      </div>

      <Card lit className="mb-5">
        <div className="space-y-3 p-5" data-testid="property-rollup" data-awarded={totals.awardedCents}>
          {totals.jobs === 0 ? (
            <p className="faint text-sm">
              No jobs counted with the stages currently on. Turn one back on above, or put a job here.
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
                  Billed <span className="num font-medium">{formatCents(totals.billedCents)}</span>
                </span>
                <span className="muted">
                  Collected <span className="num font-medium">{formatCents(totals.receivedCents)}</span>
                </span>
                <span className="muted" data-testid="property-owed">
                  Still owed <span className="num font-medium">{formatCents(totals.stillOwedCents)}</span>
                </span>
                {totals.laborSpentCents + totals.laborCommittedCents > 0 && (
                  <span className="muted">
                    Of which crew time{" "}
                    <span className="num font-medium">
                      {formatCents(totals.laborSpentCents + totals.laborCommittedCents)}
                    </span>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </Card>

      <Card lit className="mb-5">
        <CardHeader
          title="Jobs at this property"
          subtitle="Every job here, whether or not the stages above count it."
          actions={
            <PickJobs
              propertyId={property.id}
              jobs={jobChoices}
              picked={property.projects.map((job) => job.id)}
            />
          }
        />
        {property.projects.length === 0 ? (
          <EmptyState
            icon={<IconHardHat size={20} />}
            title="No jobs here yet"
            body="Pick the jobs done at this building and the budget rolls up on its own."
          />
        ) : (
          <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
            {property.projects.map((job) => {
              const left = leftCents(job);
              const inTotal = counted.has(job.id);
              return (
                <li
                  key={job.id}
                  className={`px-5 py-3 ${inTotal ? "" : "opacity-50"}`}
                  data-testid="property-job"
                  data-counted={inTotal}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">
                      <Link href={`/dashboard/projects/${job.id}`} className="link">
                        PRJ-{job.number} {job.name}
                      </Link>
                    </p>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={job.stage} />
                      <span className="num text-sm font-medium">{formatCents(job.awardedCents)}</span>
                    </div>
                  </div>
                  <p className="faint num text-xs">
                    {job.customerName} · Spent {formatCents(job.spentCents)} · Left{" "}
                    {left < 0 ? `over by ${formatCents(-left)}` : formatCents(left)}
                    {!inTotal && ` · ${PROJECT_STAGE_LABELS[job.stage]} is not being counted`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card lit>
        <CardHeader title="About this property" subtitle="Where it is, who manages it, and how to get in." />
        <div className="p-5">
          <PropertyForm
            property={{
              id: property.id,
              name: property.name,
              address: property.address,
              city: property.city,
              state: property.state,
              companyId: property.companyId,
              contactId: property.contactId,
              notes: property.notes,
            }}
            companies={companies}
            contacts={contacts}
          />
        </div>
      </Card>

      <Card className="mt-5 border-[rgb(251_113_133/0.25)]">
        <CardHeader
          title="Danger zone"
          subtitle="Deleting the property leaves every job at it exactly as it is — they just stop belonging to a building, and drop out of this roll-up."
        />
        <DeleteRecordForm
          action={deleteProperty}
          hiddenName="propertyId"
          hiddenValue={property.id}
          label="Delete property"
        />
      </Card>
    </div>
  );
}
