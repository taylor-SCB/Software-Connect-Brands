import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { dealValueCents, isOpenStage, pickPrimaryQuote, QUOTES_FOR_VALUE } from "@/lib/deals";
import { computeQuoteTotals } from "@/lib/quote-math";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { IconTrending } from "@/components/icons";
import { loadWorkspaceUsers } from "@/lib/workspace-users";
import { todayIso } from "@/lib/payments";
import { sweepStaleContracts } from "@/lib/status";
import { opportunityColumn, reconcileOpportunities } from "@/lib/opportunities";
import { BUILT_IN_LEAD_LABELS, NO_LEAD_LABEL } from "@/lib/lead-labels";
import { cleanSearch } from "@/lib/list-params";
import { goneQuietOpportunities } from "@/lib/gone-quiet";
import { ruleLeadLabels } from "@/lib/ai-assist";
import { aiConfigured } from "@/lib/ai";
import { healthSettings, loadOpportunityHealth } from "@/lib/health-load";
import { zoneDay } from "@/lib/health";
import { prefChoice, readUiPrefsWithLegacy, type UiPrefs } from "@/lib/user-prefs";
import { Prisma } from "@/generated/prisma/client";
import { PipelineBoard, type BoardTile } from "./pipeline-board";
import { PipelineFilters } from "./pipeline-filters";
import { PipelineMore } from "./pipeline-more";
import { groupOf, meetingFocus, meetingSortKey, tileAction, tileLine, type TileMeeting } from "./tile-line";

// The Pipeline (Sept 30, 2026; one tile per opportunity since Oct 27,
// 2026; the BDR redesign's Release 1 tiles and Release 7, Nov 11, 2026).
// It starts at Meeting Set. An opportunity is a sale being worked: the
// meeting or meetings that set it and the people in them, then the one
// deal it turns into from Quote Sent on. See src/lib/opportunities.ts.
//
// The bar: Mine | Everyone (Members open on Mine, approved decision 17;
// the choice is in the address bar and remembered on User.uiPrefs as
// pipeline.scope), Search, Gone quiet, Needs a decision (Meeting Set tiles
// whose meeting has passed with none ahead), Lead label. Show archived,
// Contract Coordinator and New quote sit under the header's ⋯.

type Scope = "mine" | "all";
const SCOPES = ["mine", "all"] as const;

// The address bar first, then the person's last pick (uiPrefs
// pipeline.scope, saved with saveUiPref like every other screen's), then
// their role's default. The Pipeline's first build saved the pick at the
// top level as pipelineScope; that is read while pipeline.scope isn't
// set, so nobody loses it, and the next pick writes the namespaced one,
// which wins from then on.
function scopeFrom(param: string | undefined, saved: { prefs: UiPrefs; legacy: Record<string, unknown> }, role: string): Scope {
  if (param === "mine" || param === "all") return param;
  const legacy = saved.legacy.pipelineScope;
  const remembered = prefChoice(saved.prefs, "pipeline", "scope", SCOPES) ?? (legacy === "mine" || legacy === "all" ? legacy : null);
  return remembered ?? (role === "MEMBER" ? "mine" : "all");
}

// Meeting Set tiles whose meeting has passed with nothing ahead: the
// "Happened — how did it go?" group and the Needs a decision filter, the
// same rule as meetingFocus() in tile-line.ts, counted for the whole
// scope (search and labels don't change the count, as with Gone quiet).
async function decisionOpportunityIds(organizationId: string, mineOf: string | null) {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT o.id
      FROM "Opportunity" o
      LEFT JOIN "Deal" d ON d.id = o."dealId"
     WHERE o."organizationId" = ${organizationId}
       AND o.stage = 'MEETING_SET'
       AND (d.id IS NULL OR d.stage NOT IN ('QUOTE_SENT', 'CONTRACT_SENT', 'WON', 'LOST', 'ARCHIVED'))
       ${mineOf ? Prisma.sql`AND (CASE WHEN d.id IS NULL THEN o."ownerId" ELSE d."ownerId" END) = ${mineOf}` : Prisma.empty}
       AND EXISTS (SELECT 1 FROM "OpportunityMeeting" m WHERE m."opportunityId" = o.id AND m."on" <= now())
       AND NOT EXISTS (
         SELECT 1 FROM "OpportunityMeeting" m
           LEFT JOIN "Activity" a ON a.id = m."activityId"
          WHERE m."opportunityId" = o.id AND m."on" > now()
            AND m.outcome IS NULL AND (a.outcome IS NULL OR a.outcome NOT IN ('HELD', 'NO_SHOW'))
       )`);
  return new Set(rows.map((row) => row.id));
}

function initialsOf(name: string | null) {
  if (!name) return "";
  const words = name.replace(/\(removed\)/, "").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? (words.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

// What a tile reads: the board's list and the one tile ?open= names.
const TILE_SELECT = {
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
      stageChangedAt: true,
      ownerId: true,
      valueCents: true,
      quotes: {
        select: { ...QUOTES_FOR_VALUE.select, id: true, number: true, title: true, sentAt: true },
        orderBy: { createdAt: "desc" },
      },
      contracts: { where: { status: "SENT", payable: false }, select: { sentAt: true }, orderBy: { sentAt: "desc" }, take: 1 },
    },
  },
  contacts: {
    where: { role: { not: "HIDDEN" } },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      contact: { select: { id: true, name: true, phone: true, mobile: true, company: { select: { name: true } } } },
    },
  },
  meetings: { orderBy: { on: "desc" }, select: { id: true, on: true, outcome: true, activityId: true, eventId: true } },
} satisfies Prisma.OpportunitySelect;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{
    archived?: string;
    q?: string;
    label?: string | string[];
    quiet?: string;
    decide?: string;
    scope?: string;
    open?: string | string[];
  }>;
}) {
  const { organizationId, userId, role } = await requireSession();
  const params = await searchParams;
  const showArchived = params.archived === "1";
  // ?open=<opportunity id> (the company page's Opportunity card and the
  // Pipeline report's Waiting longest list link to one tile this way): the
  // board opens that tile's panel. Only this workspace's are read (anything
  // else is quietly ignored), and the tile is shown for this load even when
  // Mine, Gone quiet, Needs a decision, a label, the search or hidden
  // archived deals would leave it out. Closing the panel takes ?open= off
  // the address.
  const openParam = (Array.isArray(params.open) ? params.open[0] : params.open)?.slice(0, 64) ?? "";
  // "Gone quiet" (Nov 10, 2026): only the open opportunities nobody has
  // touched in the workspace's quietDays.
  const quietOnly = params.quiet === "1";
  const decideOnly = params.decide === "1";
  const q = cleanSearch(params.q ?? "").slice(0, 80);
  const labels = (Array.isArray(params.label) ? params.label : params.label ? [params.label] : []).map((label) => label.slice(0, 60));
  const [settings, saved] = await Promise.all([healthSettings(organizationId), readUiPrefsWithLegacy(userId)]);
  const scope = scopeFrom(params.scope, saved, role);
  const timeZone = settings.timeZone;
  const today = todayIso(timeZone);

  // The app's own clock for the 90 / 180-day contract rule, then the
  // board's repair: every deal and everyone in the pipeline by status
  // gets an opportunity, so nobody falls off the board.
  await sweepStaleContracts(organizationId);
  await reconcileOpportunities(organizationId);

  const mineWhere: Prisma.OpportunityWhereInput = {
    OR: [{ dealId: null, ownerId: userId }, { deal: { ownerId: userId } }],
  };
  const [quiet, decision] = await Promise.all([
    goneQuietOpportunities(organizationId, { limit: 1000 }),
    decisionOpportunityIds(organizationId, scope === "mine" ? userId : null),
  ]);
  const quietById = new Map(quiet.opportunities.map((row) => [row.id, row.days]));
  // Gone quiet's count is goneQuietOpportunities' own list, inside Mine
  // when Mine is on.
  const quietInScope =
    scope === "mine" && quietById.size
      ? new Set(
          (
            await prisma.opportunity.findMany({
              where: { AND: [{ organizationId, id: { in: [...quietById.keys()] } }, mineWhere] },
              select: { id: true },
            })
          ).map((row) => row.id),
        )
      : new Set(quietById.keys());

  const and: Prisma.OpportunityWhereInput[] = [{ organizationId }];
  if (scope === "mine") and.push(mineWhere);
  if (quietOnly) and.push({ id: { in: [...quietInScope] } });
  if (decideOnly) and.push({ id: { in: [...decision] } });
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

  const [matching, users, customLabels, archivedCount, anyAtAll, opened] = await Promise.all([
    prisma.opportunity.findMany({ where: { AND: and }, orderBy: { updatedAt: "desc" }, take: 1000, select: TILE_SELECT }),
    loadWorkspaceUsers(organizationId),
    prisma.leadLabelOption.findMany({ where: { organizationId, retiredAt: null }, orderBy: { name: "asc" }, select: { name: true } }),
    showArchived ? 0 : prisma.deal.count({ where: { organizationId, stage: "ARCHIVED" } }),
    prisma.opportunity.count({ where: { organizationId }, take: 1 }),
    openParam ? prisma.opportunity.findFirst({ where: { id: openParam, organizationId }, select: TILE_SELECT }) : null,
  ]);
  // The tile ?open= names joins the board for this load when the filters
  // left it out, and isn't counted in the header or the filter's matches.
  const forced = opened && !matching.some((row) => row.id === opened.id) ? opened : null;
  const opportunities = forced ? [...matching, forced] : matching;

  // Each meeting's day and time come from its calendar entry when it has
  // one (a booked meeting with no time stays untimed), and how it went
  // from the history line it was logged as. Two batched reads.
  const eventIds = [...new Set(opportunities.flatMap((row) => row.meetings.map((meeting) => meeting.eventId)).filter((id): id is string => Boolean(id)))];
  const activityIds = [
    ...new Set(opportunities.flatMap((row) => row.meetings.map((meeting) => meeting.activityId)).filter((id): id is string => Boolean(id))),
  ];
  const ids = opportunities.map((row) => row.id);
  const [events, activities, health, suggested] = await Promise.all([
    eventIds.length
      ? prisma.calendarEvent.findMany({ where: { organizationId, id: { in: eventIds } }, select: { id: true, startOn: true, startTime: true } })
      : [],
    activityIds.length
      ? prisma.activity.findMany({ where: { organizationId, id: { in: activityIds } }, select: { id: true, outcome: true } })
      : [],
    loadOpportunityHealth(organizationId, ids, { settings }),
    // The faint suggested label for a tile with none, from the rules
    // alone; it shows in the panel (the AI is only asked on "Suggest label").
    ruleLeadLabels(
      organizationId,
      opportunities.filter((row) => !row.leadLabel).map((row) => row.id),
    ),
  ]);
  const eventById = new Map(events.map((row) => [row.id, row]));
  const outcomeOfActivity = new Map(activities.map((row) => [row.id, row.outcome]));

  const now = new Date();
  const tiles: BoardTile[] = opportunities.map((row) => {
    const people = row.contacts
      .map((link) => ({
        id: link.contact.id,
        name: link.contact.name,
        company: link.contact.company?.name ?? null,
        primary: link.role === "PRIMARY",
        phone: link.contact.mobile || link.contact.phone || null,
      }))
      .sort((a, b) => Number(b.primary) - Number(a.primary));
    const ownerId = row.deal ? row.deal.ownerId : row.ownerId;
    const ownerName = users.find((user) => user.id === ownerId)?.name ?? row.owner?.name ?? null;
    const column = opportunityColumn(row);

    const meetings: TileMeeting[] = row.meetings.map((meeting) => {
      const event = meeting.eventId ? eventById.get(meeting.eventId) : undefined;
      const logged = meeting.activityId ? outcomeOfActivity.get(meeting.activityId) : null;
      const outcome = meeting.outcome ?? logged ?? null;
      return {
        id: meeting.id,
        at: meeting.on.toISOString(),
        day: event ? event.startOn.toISOString().slice(0, 10) : zoneDay(meeting.on, timeZone),
        time: event?.startTime ?? null,
        outcome: outcome === "HELD" || outcome === "NO_SHOW" ? outcome : null,
      };
    });
    const focus = column === "MEETING_SET" ? meetingFocus(meetings, now) : null;
    const lastMet = meetings.filter((meeting) => Date.parse(meeting.at) <= now.getTime() && meeting.outcome !== "NO_SHOW")[0] ?? null;

    const deal = row.deal;
    const valueCents = deal ? dealValueCents(deal) : 0;
    const sent = deal?.quotes.find((quote) => quote.status === "SENT" && quote.sentAt);
    const draft = deal && !deal.quotes.some((quote) => quote.status !== "DRAFT") ? pickPrimaryQuote(deal.quotes) : undefined;
    const tileHealth = health.get(row.id) ?? null;
    const line = tileLine({
      column,
      focus,
      lastMet,
      today,
      quietDays: quietById.get(row.id) ?? null,
      valueCents,
      sentQuote: sent ? { cents: computeQuoteTotals(sent.lineItems, sent).totalCents, day: zoneDay(sent.sentAt!, timeZone) } : null,
      draftQuote: draft ? { cents: computeQuoteTotals(draft.lineItems, draft).totalCents } : null,
      contractSentDay: deal?.contracts[0]?.sentAt ? zoneDay(deal.contracts[0].sentAt, timeZone) : null,
      stageDay: deal ? zoneDay(deal.stageChangedAt, timeZone) : null,
      owes: tileHealth?.owes?.text ?? null,
      closedReason: tileHealth?.meter.closed?.reason ?? null,
    });

    return {
      id: row.id,
      title: row.title,
      column,
      leadLabel: row.leadLabel,
      people,
      ownerId,
      ownerName,
      ownerInitials: initialsOf(ownerName),
      quietDays: quietById.get(row.id) ?? null,
      suggestedLabel: row.leadLabel ? null : (suggested.get(row.id) ?? null),
      health: tileHealth,
      group: column === "MEETING_SET" ? groupOf(focus) : null,
      // A tile with nothing ahead whose meeting has passed is the same
      // set the Needs a decision count reads.
      decide: decision.has(row.id),
      focus,
      sortKey: meetingSortKey(focus),
      line,
      action: tileAction(column, focus),
      meetingCount: meetings.length,
      deal: deal
        ? {
            id: deal.id,
            stage: deal.stage,
            valueCents,
            quotes: deal.quotes.map((quote) => ({ id: quote.id, number: quote.number, title: quote.title })),
          }
        : null,
    };
  });

  const counted = forced ? tiles.filter((tile) => tile.id !== forced.id) : tiles;
  const inMeetings = counted.filter((tile) => tile.column === "MEETING_SET" || tile.column === "MEETING_COMPLETED").length;
  const openValue = counted.filter((tile) => tile.deal && isOpenStage(tile.deal.stage)).reduce((sum, tile) => sum + (tile.deal?.valueCents ?? 0), 0);
  const labelChoices = [NO_LEAD_LABEL, ...BUILT_IN_LEAD_LABELS, ...customLabels.map((row) => row.name)];

  return (
    <div>
      <PageHeader
        eyebrow="Closer's Club"
        title="Pipeline"
        subtitle={`${inMeetings.toLocaleString()} in meetings · ${formatCents(openValue)} in quotes and contracts out`}
        actions={<PipelineMore showArchived={showArchived} archivedCount={archivedCount} />}
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
          <PipelineFilters
            q={q}
            labels={labels}
            labelChoices={labelChoices}
            shown={counted.length}
            scope={scope}
            quiet={quietOnly}
            quietCount={quietInScope.size}
            quietDays={quiet.quietDays}
            decide={decideOnly}
            decideCount={decision.size}
          />
          <PipelineBoard
            tiles={tiles}
            customLabels={customLabels.map((row) => row.name)}
            timeZone={timeZone}
            today={today}
            ai={aiConfigured()}
            openId={opened?.id ?? null}
          />
        </>
      )}
    </div>
  );
}
