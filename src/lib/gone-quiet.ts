import { Prisma } from "@/generated/prisma/client";
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
//
// `ownerId` keeps one rep's opportunities, in the statement itself (final
// audit, Nov 11, 2026): My day kept the rep's own out of the workspace's
// 300 quietest, so past 300 a rep's loudest quiet account dropped out of
// their greeting. The limit is then the rep's own, oldest first.

export type QuietOpportunity = { id: string; title: string; lastTouchAt: Date; days: number; dealId: string | null };

export async function goneQuietOpportunities(organizationId: string, options: { quietDays?: number; limit?: number; ownerId?: string } = {}) {
  const quietDays =
    options.quietDays ??
    (await prisma.organization.findUnique({ where: { id: organizationId }, select: { quietDays: true } }))?.quietDays ??
    8;
  const rows = await prisma.$queryRaw<{ id: string; title: string; deal_id: string | null; last_touch: Date }[]>`
    WITH open AS (
      SELECT o.id, o.title, o."dealId", o."createdAt", d."stageChangedAt"
        FROM "Opportunity" o
        LEFT JOIN "Deal" d ON d.id = o."dealId"
       WHERE o."organizationId" = ${organizationId}
         ${options.ownerId ? Prisma.sql`AND o."ownerId" = ${options.ownerId}` : Prisma.empty}
         AND o.stage <> 'LOST'
         AND (d.id IS NULL OR d.stage NOT IN ('WON', 'LOST', 'ARCHIVED'))
    ), touch AS (
      SELECT oc."opportunityId" AS id, max(a."occurredAt") AS t
        FROM "OpportunityContact" oc
        JOIN open ON open.id = oc."opportunityId"
        JOIN "Activity" a ON a."contactId" = oc."contactId" AND a.marketing = false AND a."occurredAt" <= now()
       WHERE oc.role <> 'HIDDEN'
       GROUP BY oc."opportunityId"
    ), meet AS (
      SELECT m."opportunityId" AS id, max(m."on") FILTER (WHERE m."on" <= now()) AS t,
             bool_or(m."on" > now()) AS booked
        FROM "OpportunityMeeting" m
        JOIN open ON open.id = m."opportunityId"
       GROUP BY m."opportunityId"
    )
    SELECT open.id, open.title, open."dealId" AS deal_id,
           GREATEST(open."createdAt", open."stageChangedAt", touch.t, meet.t) AS last_touch
      FROM open
      LEFT JOIN touch ON touch.id = open.id
      LEFT JOIN meet ON meet.id = open.id
     WHERE GREATEST(open."createdAt", open."stageChangedAt", touch.t, meet.t) < now() - make_interval(days => ${quietDays}::int)
       AND meet.booked IS NOT TRUE
     ORDER BY last_touch ASC
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
