import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { dealValueCents, isOpenStage, QUOTES_FOR_VALUE } from "@/lib/deals";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { IconTrending, IconPlus, IconClock } from "@/components/icons";
import { loadWorkspaceUsers } from "@/lib/workspace-users";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { sweepStaleContracts } from "@/lib/status";
import { opportunityColumn, reconcileOpportunities } from "@/lib/opportunities";
import { BUILT_IN_LEAD_LABELS, NO_LEAD_LABEL } from "@/lib/lead-labels";
import { cleanSearch } from "@/lib/list-params";
import type { Prisma } from "@/generated/prisma/client";
import { PipelineBoard, type BoardTile } from "./pipeline-board";
import { PipelineFilters } from "./pipeline-filters";

// The Pipeline (Sept 30, 2026; one tile per opportunity since Oct 27,
// 2026). It starts at Meeting Set. An opportunity is a sale being worked:
// the meeting or meetings that set it and the people in them, then the one
// deal it turns into from Quote Sent on. See src/lib/opportunities.ts.
export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; q?: string; label?: string | string[] }>;
}) {
  const { organizationId } = await requireSession();
  const params = await searchParams;
  const showArchived = params.archived === "1";
  const q = cleanSearch(params.q ?? "").slice(0, 80);
  const labels = (Array.isArray(params.label) ? params.label : params.label ? [params.label] : []).map((label) => label.slice(0, 60));
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);

  // The app's own clock for the 90 / 180-day contract rule, then the
  // board's repair: every deal and everyone in the pipeline by status
  // gets an opportunity, so nobody falls off the board.
  await sweepStaleContracts(organizationId);
  await reconcileOpportunities(organizationId);

  const and: Prisma.OpportunityWhereInput[] = [{ organizationId }];
  if (!showArchived) and.push({ OR: [{ dealId: null }, { deal: { stage: { not: "ARCHIVED" } } }] });
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        {
          contacts: {
            some: {
              role: { not: "HIDDEN" },
              contact: { OR: [{ name: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] },
            },
          },
        },
      ],
    });
  }
  if (labels.length) {
    const named = labels.filter((label) => label !== NO_LEAD_LABEL);
    and.push({
      OR: [
        ...(named.length ? [{ leadLabel: { in: named } }] : []),
        ...(labels.includes(NO_LEAD_LABEL) ? [{ leadLabel: null }] : []),
      ],
    });
  }

  const [opportunities, users, customLabels, archivedCount, anyAtAll] = await Promise.all([
    prisma.opportunity.findMany({
      where: { AND: and },
      orderBy: { updatedAt: "desc" },
      take: 1000,
      select: {
        id: true,
        title: true,
        stage: true,
        leadLabel: true,
        ownerId: true,
        owner: { select: { name: true } },
        deal: {
          select: {
            id: true,
            stage: true,
            ownerId: true,
            valueCents: true,
            quotes: { select: { ...QUOTES_FOR_VALUE.select, id: true, number: true, title: true }, orderBy: { createdAt: "desc" } },
          },
        },
        contacts: {
          where: { role: { not: "HIDDEN" } },
          orderBy: { createdAt: "asc" },
          select: { role: true, contact: { select: { id: true, name: true, company: { select: { name: true } } } } },
        },
        meetings: { orderBy: { on: "desc" }, select: { on: true } },
      },
    }),
    loadWorkspaceUsers(organizationId),
    prisma.leadLabelOption.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { name: true } }),
    showArchived ? 0 : prisma.deal.count({ where: { organizationId, stage: "ARCHIVED" } }),
    prisma.opportunity.count({ where: { organizationId }, take: 1 }),
  ]);

  const tiles: BoardTile[] = opportunities.map((row) => {
    const people = row.contacts
      .map((link) => ({ id: link.contact.id, name: link.contact.name, company: link.contact.company?.name ?? null, primary: link.role === "PRIMARY" }))
      .sort((a, b) => Number(b.primary) - Number(a.primary));
    const ownerId = row.deal ? row.deal.ownerId : row.ownerId;
    return {
      id: row.id,
      title: row.title,
      column: opportunityColumn(row),
      leadLabel: row.leadLabel,
      people,
      ownerId,
      ownerName: users.find((user) => user.id === ownerId)?.name ?? row.owner?.name ?? null,
      meetingCount: row.meetings.length,
      lastMeetingOn: row.meetings[0]?.on.toISOString() ?? null,
      deal: row.deal
        ? {
            id: row.deal.id,
            stage: row.deal.stage,
            valueCents: dealValueCents(row.deal),
            quotes: row.deal.quotes.map((quote) => ({ id: quote.id, number: quote.number, title: quote.title })),
          }
        : null,
    };
  });

  const inMeetings = tiles.filter((tile) => tile.column === "MEETING_SET" || tile.column === "MEETING_COMPLETED").length;
  const openValue = tiles.filter((tile) => tile.deal && isOpenStage(tile.deal.stage)).reduce((sum, tile) => sum + (tile.deal?.valueCents ?? 0), 0);
  const labelChoices = [NO_LEAD_LABEL, ...BUILT_IN_LEAD_LABELS, ...customLabels.map((row) => row.name)];

  return (
    <div>
      <PageHeader
        eyebrow="Closer's Club"
        title="Pipeline"
        subtitle={`${inMeetings.toLocaleString()} in meetings · ${formatCents(openValue)} in quotes and contracts out`}
        actions={
          <>
            <Link
              href={showArchived ? "/dashboard/deals" : "/dashboard/deals?archived=1"}
              className="btn btn-ghost btn-sm"
              data-testid="toggle-archived"
            >
              {showArchived ? "Hide archived" : `Show archived${archivedCount ? ` (${archivedCount})` : ""}`}
            </Link>
            <Link href="/dashboard/deals/tracker" className="btn btn-ghost btn-sm">
              <IconClock size={13} />
              Contract Coordinator
            </Link>
            <Link href="/dashboard/quotes/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              New quote
            </Link>
          </>
        }
      />

      {anyAtAll === 0 ? (
        <Card lit>
          <EmptyState
            icon={<IconTrending size={20} />}
            title="Nothing on the pipeline yet"
            body="It starts at Meeting Set: log or book a meeting with a contact and it appears in the first column, with everyone who was in it."
            action={
              <Link href="/dashboard/contacts" className="btn btn-primary btn-sm">
                Go to contacts
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <PipelineFilters q={q} labels={labels} labelChoices={labelChoices} shown={tiles.length} />
          <PipelineBoard
            tiles={tiles}
            users={users.map((user) => ({ id: user.id, name: user.name }))}
            customLabels={customLabels.map((row) => row.name)}
            timeZone={timeZone}
            today={today}
          />
        </>
      )}
    </div>
  );
}
