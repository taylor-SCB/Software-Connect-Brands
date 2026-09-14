import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { paidCentsOf } from "@/lib/money";
import { sumTime, doubleCountWarning, describeTime } from "@/lib/crews";
import { PageHeader, Card, CardHeader, StatTile, StatusBadge, EmptyState } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { IconClock, IconHardHat } from "@/components/icons";
import { ProjectTabs } from "../project-tabs";
import { LogHoursForm, type CrewChoice } from "./log-hours-form";
import { TimeRow, type TimeEntryView } from "./time-row";
import { PaidThroughForm } from "./paid-through-form";
import { ScopeCrewPicker } from "./scope-crew-picker";

// Who is on this job and what their time has cost. Own crews cost the job
// their hours; a subcontractor's money comes from their purchase order, so
// their hours are tracked here and never added on top.
export default async function ProjectCrewPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requireSession();
  const { id } = await params;
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);

  const [project, crews] = await Promise.all([
    prisma.project.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        number: true,
        name: true,
        stage: true,
        customerName: true,
        laborSpentCents: true,
        laborCommittedCents: true,
        scopes: {
          orderBy: { position: "asc" },
          select: { id: true, name: true, serviceType: true, crewId: true, crewLabel: true, isDefault: true },
        },
        timeEntries: {
          orderBy: [{ workedOn: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            workerName: true,
            workedOn: true,
            hours: true,
            days: true,
            amountCents: true,
            countsAsCost: true,
            paidOn: true,
            note: true,
            crewId: true,
            crew: { select: { id: true, name: true, kind: true, companyId: true } },
            scope: { select: { name: true } },
          },
        },
        // A subcontractor's orders on this job, to spot the one mistake
        // that can double a cost: hours counted as well as the order.
        contracts: {
          where: { payable: true, status: { in: ["SENT", "SIGNED"] } },
          select: {
            companyId: true,
            payments: { select: { amountCents: true, payments: { select: { amountCents: true } } } },
          },
        },
      },
    }),
    prisma.crew.findMany({
      where: { organizationId, active: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        kind: true,
        serviceTypes: true,
        hourlyRateCents: true,
        dailyRateCents: true,
        companyId: true,
        workers: {
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, hourlyRateCents: true, dailyRateCents: true },
        },
      },
    }),
  ]);
  if (!project) notFound();

  const entries: TimeEntryView[] = project.timeEntries.map((entry) => ({
    id: entry.id,
    workerName: entry.workerName,
    crewName: entry.crew?.name ?? null,
    scopeName: entry.scope?.name ?? null,
    workedOn: entry.workedOn.toISOString().slice(0, 10),
    hours: entry.hours,
    days: entry.days,
    amountCents: entry.amountCents,
    countsAsCost: entry.countsAsCost,
    paidOn: entry.paidOn ? entry.paidOn.toISOString().slice(0, 10) : null,
    note: entry.note,
  }));

  const totals = sumTime(project.timeEntries);

  // What each crew has on this job, so the page reads by crew and not
  // only as one long list of days.
  const byCrew = new Map<
    string,
    { name: string; kind: string; companyId: string | null; entries: typeof project.timeEntries }
  >();
  for (const entry of project.timeEntries) {
    const key = entry.crewId ?? "__none__";
    const existing = byCrew.get(key) ?? {
      name: entry.crew?.name ?? entry.workerName,
      kind: entry.crew?.kind ?? "OWN",
      companyId: entry.crew?.companyId ?? null,
      entries: [],
    };
    existing.entries.push(entry);
    byCrew.set(key, existing);
  }

  // What is out to each supplier on this job, by company, for the warning.
  const orderedByCompany = new Map<string, number>();
  for (const contract of project.contracts) {
    if (!contract.companyId) continue;
    const open = contract.payments.reduce(
      (sum, row) => sum + Math.max(0, row.amountCents) - paidCentsOf(row),
      0,
    );
    const total = contract.payments.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);
    orderedByCompany.set(contract.companyId, (orderedByCompany.get(contract.companyId) ?? 0) + Math.max(open, total));
  }

  const warnings = Array.from(byCrew.values())
    .map((crew) =>
      doubleCountWarning({
        crewName: crew.name,
        countedHoursCents: crew.entries
          .filter((entry) => entry.countsAsCost)
          .reduce((sum, entry) => sum + entry.amountCents, 0),
        orderedCents: crew.kind === "SUBCONTRACTOR" && crew.companyId
          ? orderedByCompany.get(crew.companyId) ?? 0
          : 0,
      }),
    )
    .filter((message): message is string => message !== null);

  // Crews that have worked here, for the "Mark paid through" picker.
  const crewsOnJob = Array.from(byCrew.entries())
    .filter(([key]) => key !== "__none__")
    .map(([id, crew]) => ({ id, name: crew.name }));

  const crewChoices: CrewChoice[] = crews.map((crew) => ({
    id: crew.id,
    name: crew.name,
    kind: crew.kind,
    hourlyRateCents: crew.hourlyRateCents,
    dailyRateCents: crew.dailyRateCents,
    serviceTypes: crew.serviceTypes,
    workers: crew.workers,
  }));

  return (
    <div>
      <BackLink href={`/dashboard/projects/${project.id}`} label={project.name} />

      <PageHeader
        eyebrow={`Job · PRJ-${project.number}`}
        title="Crew & time"
        subtitle={`${project.name} · ${project.customerName}`}
        actions={<StatusBadge status={project.stage} />}
      />

      <ProjectTabs projectId={project.id} current="crew" />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Crew time on the job"
          value={formatCents(totals.costCents)}
          hint={describeTime({ hours: totals.hours, days: totals.days })}
          accent="#34d399"
        />
        <StatTile label="Paid out" value={formatCents(totals.paidCents)} hint="Counted in Spent" />
        <StatTile
          label="Still to pay"
          value={formatCents(totals.unpaidCents)}
          hint="Counted in Committed"
          accent="#fbbf24"
        />
        <StatTile
          label="Subs, tracked only"
          value={formatCents(totals.trackedOnlyCents)}
          hint="Their orders are the cost"
          accent="#94a3b8"
        />
      </div>

      {warnings.length > 0 && (
        <Card lit>
          <div className="p-5" data-testid="double-count-warning">
            {warnings.map((message) => (
              <p key={message} className="text-sm text-[var(--warn)]">
                {message}
              </p>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-5 space-y-5">
        <Card lit>
          <CardHeader
            title="Log time"
            subtitle="Hours, days, or both. The rate comes from the crew, and the cost lands on the budget."
            actions={
              <Link href="/dashboard/projects/crews" className="btn btn-ghost btn-sm">
                <IconHardHat size={13} />
                Manage crews
              </Link>
            }
          />
          <div className="p-5">
            <LogHoursForm
              projectId={project.id}
              scopes={project.scopes}
              crews={crewChoices}
              today={today}
            />
          </div>
        </Card>

        <Card lit>
          <CardHeader
            title="Who is on each scope"
            subtitle="The crew that does that kind of work comes first in the list."
          />
          <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
            {project.scopes.map((scope) => (
              <ScopeCrewPicker key={scope.id} scope={scope} crews={crews} />
            ))}
          </ul>
        </Card>

        <Card lit>
          <CardHeader
            title="Time logged"
            subtitle="Paid time counts as Spent on the budget; time still to pay counts as Committed."
            actions={
              entries.some((entry) => entry.countsAsCost && !entry.paidOn) ? (
                <PaidThroughForm projectId={project.id} crews={crewsOnJob} today={today} />
              ) : undefined
            }
          />
          {entries.length === 0 ? (
            <EmptyState
              icon={<IconClock size={20} />}
              title="No time logged yet"
              body="Log a day above and it shows here, with what it cost and whether it has been paid."
            />
          ) : (
            <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
              {entries.map((entry) => (
                <TimeRow key={entry.id} entry={entry} today={today} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
