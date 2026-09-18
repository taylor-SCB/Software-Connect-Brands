import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import { getTimeZone } from "@/lib/organization";
import { getServiceTypes } from "@/lib/service-types";
import { leftCents, DEFAULT_SCOPE_NAME } from "@/lib/projects";
import { TAG_LABELS, LINE_ITEM_TAGS, type LineItemTagValue } from "@/lib/constants";
import { lineTotalCents } from "@/lib/quote-math";
import { PageHeader, Card, CardHeader, StatTile, StatusBadge, Meter, Badge } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { IconClock } from "@/components/icons";
import { ProjectTabs } from "./project-tabs";
import { ProjectHeaderForm } from "./project-header-form";
import { ScopeCard } from "./scope-card";
import { AddScopeForm } from "./add-scope-form";
import { CloseOutButton } from "./close-out-button";
import { ProjectNotes, type ProjectNoteView } from "./project-notes";
import { PropertyPicker } from "./property-picker";
import { openItems } from "@/lib/close-out";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requireSession();
  const { id } = await params;
  const timeZone = await getTimeZone();

  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      number: true,
      name: true,
      stage: true,
      customerName: true,
      siteAddress: true,
      awardedAt: true,
      awardedOffline: true,
      companyId: true,
      contactId: true,
      dealId: true,
      awardedCents: true,
      spentCents: true,
      committedCents: true,
      receivedCents: true,
      billedCents: true,
      plannedCostCents: true,
      laborSpentCents: true,
      laborCommittedCents: true,
      closedAt: true,
      closeOutNote: true,
      propertyId: true,
      property: { select: { id: true, name: true } },
      notes: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      },
      scopes: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          serviceType: true,
          description: true,
          crewLabel: true,
          crew: { select: { name: true } },
          isDefault: true,
          awardedCents: true,
          spentCents: true,
          committedCents: true,
          receivedCents: true,
          billedCents: true,
          plannedCostCents: true,
          awards: {
            orderBy: { createdAt: "asc" },
            select: { id: true, kind: true, deltaCents: true, note: true, createdAt: true },
          },
          lineItems: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              quantity: true,
              unitPriceCents: true,
              tag: true,
              contract: { select: { id: true, number: true, type: true, payable: true, status: true } },
            },
          },
        },
      },
    },
  });
  if (!project) notFound();

  const [serviceTypes, open, properties] = await Promise.all([
    getServiceTypes(organizationId),
    openItems(organizationId, project.id),
    prisma.property.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, name: true },
    }),
  ]);

  const projectNotes: ProjectNoteView[] = project.notes.map((note) => ({
    id: note.id,
    body: note.body,
    author: note.author.name,
    when: formatDateTime(note.createdAt, timeZone),
  }));
  const left = leftCents(project);
  const used = project.spentCents + project.committedCents;
  // The crew-time part of what has been used, so the bar can be explained
  // without opening the Crew & time tab.
  const labor = project.laborSpentCents + project.laborCommittedCents;
  // The whole-job scope is a bucket for untagged rows. When the job is
  // split and nothing landed in it, showing it as an empty budget is
  // noise, so it only appears when it holds something.
  const shownScopes = project.scopes.filter(
    (scope) =>
      !scope.isDefault ||
      scope.lineItems.length > 0 ||
      scope.awardedCents !== 0 ||
      scope.committedCents !== 0 ||
      scope.spentCents !== 0,
  );
  // A job with one scope shows a single bar and never mentions the word:
  // a painter should not have to learn it.
  const showScopes = shownScopes.length > 1;
  const single = shownScopes[0] ?? project.scopes[0];
  const scopeOptions = project.scopes.map((scope) => ({ id: scope.id, name: scope.name }));

  return (
    <div>
      <BackLink href="/dashboard/projects" label="Projects" current={project.name} />

      <PageHeader
        eyebrow={`Job · PRJ-${project.number}`}
        title={project.name}
        subtitle={
          project.companyId || project.contactId ? undefined : project.customerName
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={project.stage} />
            {project.dealId && (
              <Link href={`/dashboard/deals/tracker?dealId=${project.dealId}`} className="btn btn-ghost btn-sm">
                <IconClock size={13} />
                Contract Coordinator
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {project.companyId ? (
          <Link href={`/dashboard/companies/${project.companyId}`} className="link">
            {project.customerName}
          </Link>
        ) : project.contactId ? (
          <Link href={`/dashboard/contacts/${project.contactId}`} className="link">
            {project.customerName}
          </Link>
        ) : (
          <span className="muted">{project.customerName}</span>
        )}
        <span className="faint">
          Awarded {formatDate(project.awardedAt, timeZone)}
          {project.awardedOffline && " · recorded by hand"}
        </span>
        {project.property && (
          <Link href={`/dashboard/projects/properties/${project.property.id}`} className="link">
            {project.property.name}
          </Link>
        )}
      </div>

      <ProjectTabs projectId={project.id} current="budget" />

      <div className="mb-4">
        <CloseOutButton
          projectId={project.id}
          projectName={project.name}
          closed={project.stage === "COMPLETED"}
          closedNote={
            project.closedAt
              ? `Closed ${formatDate(project.closedAt, timeZone)}${
                  project.closeOutNote ? ` · ${project.closeOutNote}` : ""
                }`
              : null
          }
          openItems={open}
        />
      </div>

      <ProjectHeaderForm
        projectId={project.id}
        name={project.name}
        siteAddress={project.siteAddress}
        stage={project.stage}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Awarded" value={formatCents(project.awardedCents)} hint="What the customer agreed to" />
        <StatTile
          label="Spent"
          value={formatCents(project.spentCents)}
          hint="Paid out on this job"
          accent="#fbbf24"
        />
        <StatTile
          label="Committed"
          value={formatCents(project.committedCents)}
          hint="Ordered, not yet paid"
          accent="#a78bfa"
        />
        <StatTile
          label="Left"
          value={left < 0 ? `Over by ${formatCents(-left)}` : formatCents(left)}
          hint={project.awardedCents === 0 ? "Nothing awarded yet" : "Awarded less spent and committed"}
          accent={left < 0 ? "#f87171" : "#34d399"}
        />
      </div>

      <Card lit className="mt-4">
        <div className="space-y-3 p-5">
          <Meter
            max={project.awardedCents}
            segments={[
              { cents: project.spentCents, tone: "spent" },
              { cents: project.committedCents, tone: "committed" },
            ]}
            label={`${formatCents(used)} of ${formatCents(project.awardedCents)} used`}
          />
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <span className="muted">
              Spent <span className="num font-medium">{formatCents(project.spentCents)}</span>
            </span>
            <span className="muted">
              Committed <span className="num font-medium">{formatCents(project.committedCents)}</span>
            </span>
            <span className="muted">
              Left{" "}
              <span className={`num font-medium ${left < 0 ? "text-[var(--danger)]" : ""}`} data-testid="project-left">
                {formatCents(left)}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-[rgb(255_255_255/0.06)] pt-3 text-xs">
            <span className="muted">
              Billed <span className="num font-medium">{formatCents(project.billedCents)}</span>
            </span>
            <span className="muted">
              Collected <span className="num font-medium">{formatCents(project.receivedCents)}</span>
            </span>
            <span className="muted" data-testid="project-owed">
              Still owed{" "}
              <span className="num font-medium">{formatCents(project.billedCents - project.receivedCents)}</span>
            </span>
            {labor > 0 && (
              <span className="muted" data-testid="project-labor">
                Of which crew time{" "}
                <span className="num font-medium">{formatCents(labor)}</span>
              </span>
            )}
            {project.plannedCostCents > 0 && (
              <span className="faint" data-testid="planned-cost">
                Expected cost on file{" "}
                <span className="num font-medium">{formatCents(project.plannedCostCents)}</span>
              </span>
            )}
          </div>
        </div>
      </Card>

      {showScopes && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Scopes of work</h2>
            <p className="faint text-xs">Each kind of work keeps its own budget; together they make the job&apos;s.</p>
          </div>
          {shownScopes.map((scope) => (
            <ScopeCard
              key={scope.id}
              scope={{
                ...scope,
                crewName: scope.crew?.name ?? null,
                awards: scope.awards.map((award) => ({
                  ...award,
                  createdAt: formatDate(award.createdAt, timeZone),
                })),
                tagTotals: tagTotals(scope.lineItems),
              }}
              scopeOptions={scopeOptions}
              serviceTypes={serviceTypes}
            />
          ))}
        </div>
      )}

      {!showScopes && single && (
        <Card lit className="mt-5">
          <CardHeader
            title="What is on this job"
            subtitle="Every row from the signed paperwork, and what it is for."
          />
          <ScopeLines lines={single.lineItems} scopeOptions={scopeOptions} showScopePicker={false} />
          <div className="border-t border-[rgb(255_255_255/0.06)] px-5 py-4">
            <p className="eyebrow mb-2">Awarded amount, and why</p>
            <ul className="space-y-1 text-xs">
              {single.awards.length === 0 && <li className="faint">Nothing awarded yet.</li>}
              {single.awards.map((award) => (
                <li key={award.id} className="flex items-baseline justify-between gap-3">
                  <span className="muted">
                    {formatDate(award.createdAt, timeZone)} · {award.note || AWARD_LABELS[award.kind]}
                  </span>
                  <span className="num font-medium">
                    {award.deltaCents < 0 ? "−" : "+"}
                    {formatCents(Math.abs(award.deltaCents))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <div className="mt-4">
        <AddScopeForm projectId={project.id} serviceTypes={serviceTypes} hasScopes={showScopes} />
      </div>

      <Card lit className="mt-5">
        <CardHeader
          title="Notes on this job"
          subtitle="What was said on site, kept with the job rather than with a person."
        />
        <ProjectNotes projectId={project.id} notes={projectNotes} />
      </Card>

      <Card lit className="mt-5">
        <CardHeader
          title="Which building"
          subtitle="Several jobs at one property roll up into a single budget."
        />
        <div className="p-5">
          <PropertyPicker
            projectId={project.id}
            propertyId={project.propertyId}
            properties={properties}
          />
        </div>
      </Card>

      {showScopes && shownScopes.some((scope) => scope.isDefault) && (
        <p className="faint mt-6 text-xs">
          {DEFAULT_SCOPE_NAME} holds anything with no service type on it.
        </p>
      )}
    </div>
  );
}

const AWARD_LABELS: Record<string, string> = {
  CONTRACT: "Signed agreement",
  CHANGE_ORDER: "Change order",
  CONTRACT_REMOVED: "Paperwork removed",
  QUOTE: "From the quote",
  MANUAL: "Changed by hand",
};

type Line = {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  tag: string;
  contract: { id: string; number: number; type: string; payable: boolean; status: string };
};

function tagTotals(lines: Line[]) {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.contract.payable) continue;
    totals.set(line.tag, (totals.get(line.tag) ?? 0) + lineTotalCents(line.quantity, line.unitPriceCents));
  }
  return LINE_ITEM_TAGS.filter((tag) => (totals.get(tag) ?? 0) !== 0).map((tag) => ({
    tag: tag as LineItemTagValue,
    label: TAG_LABELS[tag as LineItemTagValue],
    cents: totals.get(tag) ?? 0,
  }));
}

// The rows on a scope, with which piece of paperwork each came from.
export function ScopeLines({
  lines,
  scopeOptions,
  showScopePicker,
}: {
  lines: Line[];
  scopeOptions: { id: string; name: string }[];
  showScopePicker: boolean;
}) {
  if (lines.length === 0) {
    return <p className="faint px-5 py-4 text-sm">No rows on this scope yet.</p>;
  }
  return (
    <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
      {lines.map((line) => (
        <li key={line.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3" data-testid="scope-line">
          <div className="min-w-0">
            <p className="text-sm font-medium">{line.name}</p>
            <p className="faint num text-xs">
              <Link href={`/dashboard/contracts/${line.contract.id}`} className="link">
                CON-{line.contract.number}
              </Link>
              {" · "}
              {line.contract.type}
              {line.contract.payable && (
                <>
                  {" · "}
                  <Badge color="#a78bfa">Money out</Badge>
                </>
              )}
              {" · "}
              {line.quantity} × {formatCents(line.unitPriceCents)}
            </p>
          </div>
          <span className="num text-sm font-medium">
            {formatCents(lineTotalCents(line.quantity, line.unitPriceCents))}
          </span>
        </li>
      ))}
      {showScopePicker && scopeOptions.length > 1 && null}
    </ul>
  );
}
