import { prisma } from "@/lib/prisma";

// "Nobody has touched this in N days" (Nov 10, 2026). An open opportunity
// (no deal yet, or one not Won, Lost or Archived) whose latest sign of
// life is older than the workspace's quietDays. Signs of life: a logged
// call, text, email or meeting with anyone listed on it (marketing sends
// never count), a meeting date that has passed, its deal changing stage,
// and the opportunity being made. One with a meeting still to come is
// never quiet (audit fix, Nov 10, 2026): a meeting booked for two weeks
// out was "Quiet 9 days" with a follow-up offered. Shared by the Pipeline tiles, the Daily
// Rundown report and the drafted follow-ups, so they always agree.

export type QuietOpportunity = { id: string; title: string; lastTouchAt: Date; days: number; dealId: string | null };

export async function goneQuietOpportunities(organizationId: string, options: { quietDays?: number; limit?: number } = {}) {
  const quietDays =
    options.quietDays ??
    (await prisma.organization.findUnique({ where: { id: organizationId }, select: { quietDays: true } }))?.quietDays ??
    8;
  // One pass over every sign of life, grouped per opportunity (Nov 11,
  // 2026). The query this replaced joined touches and meetings onto a CTE
  // of open opportunities that Postgres guessed held one row, so with an
  // import's worth of Meeting Set tiles it nested-looped every aggregate
  // once per tile: 40,000 tiles cost the Pipeline about 160 ms a load, now
  // about 70. Same rows, same order.
  const rows = await prisma.$queryRaw<{ id: string; title: string; deal_id: string | null; last_touch: Date }[]>`
    SELECT e.id, max(e.title) AS title, max(e.deal_id) AS deal_id, max(e.t) AS last_touch
      FROM (
        -- The open ones themselves: made, or their deal changing stage.
        SELECT o.id, o.title, o."dealId" AS deal_id, GREATEST(o."createdAt", d."stageChangedAt") AS t, true AS is_open, false AS booked
          FROM "Opportunity" o
          LEFT JOIN "Deal" d ON d.id = o."dealId"
         WHERE o."organizationId" = ${organizationId}
           AND o.stage <> 'LOST'
           AND (d.id IS NULL OR d.stage NOT IN ('WON', 'LOST', 'ARCHIVED'))
        UNION ALL
        -- A logged touch with anyone listed on it (never a marketing send).
        SELECT oc."opportunityId", NULL, NULL, a."occurredAt", false, false
          FROM "OpportunityContact" oc
          JOIN "Opportunity" o ON o.id = oc."opportunityId" AND o."organizationId" = ${organizationId}
          JOIN "Activity" a ON a."contactId" = oc."contactId" AND a.marketing = false AND a."occurredAt" <= now()
         WHERE oc.role <> 'HIDDEN'
        UNION ALL
        -- A meeting that has passed, or one still to come (never quiet).
        SELECT m."opportunityId", NULL, NULL, CASE WHEN m."on" <= now() THEN m."on" END, false, m."on" > now()
          FROM "OpportunityMeeting" m
          JOIN "Opportunity" o ON o.id = m."opportunityId" AND o."organizationId" = ${organizationId}
      ) e
     GROUP BY e.id
    HAVING bool_or(e.is_open)
       AND NOT bool_or(e.booked)
       AND max(e.t) < now() - make_interval(days => ${quietDays}::int)
     ORDER BY last_touch ASC, e.id
     LIMIT ${options.limit ?? 500}`;
  const now = Date.now();
  return {
    quietDays,
    opportunities: rows.map(
      (row): QuietOpportunity => ({
        id: row.id,
        title: row.title,
        dealId: row.deal_id,
        lastTouchAt: row.last_touch,
        days: Math.floor((now - row.last_touch.getTime()) / 86_400_000),
      }),
    ),
  };
}
