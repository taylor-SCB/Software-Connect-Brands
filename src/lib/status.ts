import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CONTRACT_ARCHIVE_DAYS,
  CONTRACT_LOST_DAYS,
  PASS_THROUGH_CONNECTED,
  PIPELINE_STEPS,
  statusRank,
  type ContactStatusValue,
} from "@/lib/constants";

// The status ladder (Sept 30, 2026). A contact and a company each carry a
// status; every move is written to StatusChange with the day it happened,
// which is what Stats measures conversion and time-between-steps from.
//
// The app moves a status forward on its own for the events it can see —
// the first logged touch (Contacted, shown "Attempted"), a talk, reply or
// held meeting (Connected), the first meeting booked (Meeting Set), a
// meeting held (Meeting Completed), a quote or contract going out, a
// contract signed — and never backwards. A company is as far along as
// the furthest of its people.
// Everything else (Interested, Not Interested, Lost) is set by a person,
// and skipping a pipeline step by hand asks for the day each skipped step
// happened.

// `batchId` ties every StatusChange a save writes to that save, so
// "Undo" (undoLog) can take exactly those back.
export type Who = { organizationId: string; userId?: string | null; batchId?: string | null };

// The statuses a contact's paperwork puts them at.
const DEAL_TO_STATUS: Record<string, ContactStatusValue | undefined> = {
  QUOTE_SENT: "QUOTE_SENT",
  CONTRACT_SENT: "CONTRACT_SENT",
  WON: "WON",
  LOST: "LOST",
};

export function statusForDealStage(stage: string) {
  return DEAL_TO_STATUS[stage];
}

// The steps a forward move writes, in order: Interested, Not Interested
// and Meeting Set from below Connected go through Connected first, the
// same day (Nov 11, 2026), because nobody hears interest or books a
// meeting without talking. Nothing else is passed through.
export function stepsTo(current: string, target: ContactStatusValue): ContactStatusValue[] {
  const below = current === "NOT_ACTIONED" || current === "CONTACTED";
  return below && PASS_THROUGH_CONNECTED.includes(target) ? ["CONNECTED", target] : [target];
}

// One step of a move as written to StatusChange.
type Step = { to: ContactStatusValue; auto: boolean; reason: string | null };
type MoveOptions = { on?: Date; auto?: boolean; dealId?: string | null; reason?: string | null };

// Moves every record in `ids` that `plan` says moves from where it is now,
// set-based (final audit, Nov 11, 2026): one read, then one statement per
// status the records start from, however many people a save is on. Each
// statement moves only rows still at that status when it runs, and writes
// the StatusChange rows for exactly the rows it moved, so two saves at
// once can never move a record backwards or leave a ladder that doesn't
// match its status. Returns the records moved, with their company.
async function moveRecords(
  kind: "contact" | "company",
  who: Who,
  ids: string[],
  plan: (current: string) => Step[] | null,
  options: { on: Date; dealId?: string | null },
): Promise<{ id: string; companyId: string | null }[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows =
    kind === "contact"
      ? await prisma.contact.findMany({ where: { id: { in: unique }, organizationId: who.organizationId }, select: { id: true, status: true } })
      : await prisma.company.findMany({ where: { id: { in: unique }, organizationId: who.organizationId }, select: { id: true, status: true } });
  const groups = new Map<string, string[]>();
  for (const row of rows) groups.set(row.status, [...(groups.get(row.status) ?? []), row.id]);
  const moved: { id: string; companyId: string | null }[] = [];
  // createdAt counts up a millisecond a step, so a record's ladder reads in
  // order (Stats and Undo order by it).
  // Dates go in as UTC text: the columns are timestamps without a zone,
  // holding UTC, whatever zone the database session is in.
  const utc = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const stamp = new Date();
  for (const [from, group] of groups) {
    const steps = plan(from);
    if (!steps?.length) continue;
    const fromList = steps.map((_, index) => (index === 0 ? from : steps[index - 1].to));
    const target = steps[steps.length - 1].to;
    const table = kind === "contact" ? Prisma.raw(`"Contact"`) : Prisma.raw(`"Company"`);
    const owner = kind === "contact" ? Prisma.raw(`"contactId"`) : Prisma.raw(`"companyId"`);
    const companyCol = kind === "contact" ? Prisma.raw(`"companyId"`) : Prisma.raw(`NULL::text`);
    const result = await prisma.$queryRaw<{ id: string; companyId: string | null }[]>`
      WITH moved AS (
        UPDATE ${table} SET status = ${target}::"ContactStatus", "updatedAt" = ${utc(stamp)}
         WHERE "organizationId" = ${who.organizationId} AND id = ANY(${group}::text[]) AND status = ${from}::"ContactStatus"
        RETURNING id, ${companyCol} AS "companyId"
      ),
      written AS (
        INSERT INTO "StatusChange" (id, "organizationId", ${owner}, "dealId", "userId", "fromStatus", "toStatus", "on", auto, "batchId", reason, "createdAt")
        SELECT 'sc' || replace(gen_random_uuid()::text, '-', ''), ${who.organizationId}, m.id, ${options.dealId ?? null}, ${who.userId ?? null},
               s.f, s.t, ${utc(options.on)}, s.a, ${who.batchId ?? null}, s.r, ${utc(stamp)} + (s.n * interval '1 millisecond')
          FROM moved m
          CROSS JOIN unnest(${fromList}::text[], ${steps.map((step) => step.to)}::text[], ${steps.map((step) => step.auto)}::boolean[],
                            ${steps.map((step) => step.reason)}::text[]) WITH ORDINALITY AS s(f, t, a, r, n)
        RETURNING 1
      )
      SELECT id, "companyId" FROM moved`;
    moved.push(...result);
  }
  return moved;
}

// Whether an automatic forward move to `target` takes a record at `current`.
// Lost comes from a deal lost or the contract clock, and only takes
// someone who was in the pipeline and not already won. From Lost the only
// way back is a new meeting or new paperwork: a call, a reply or a talk
// (Contacted, Connected) leaves a Lost record Lost.
function forwardSteps(current: string, target: ContactStatusValue, options: MoveOptions): Step[] | null {
  const auto = options.auto ?? true;
  const reason = options.reason ?? null;
  if (target === "LOST") {
    return statusRank(current) >= statusRank("MEETING_SET") && current !== "WON" ? [{ to: "LOST", auto, reason }] : null;
  }
  if (current === "ARCHIVED" || statusRank(target) <= statusRank(current)) return null;
  if (current === "LOST" && (target === "CONTACTED" || target === "CONNECTED")) return null;
  const path = stepsTo(current, target);
  return path.map((step) => ({ to: step, auto, reason: step === target ? reason : null }));
}

// Moves contacts forward to `target` if they are not already there or
// further, and their companies with them. Returns the ids that moved.
export async function advanceContacts(who: Who, contactIds: string[], target: ContactStatusValue, options: MoveOptions = {}) {
  const on = options.on ?? new Date();
  const moved = await moveRecords("contact", who, contactIds, (current) => forwardSteps(current, target, options), { on, dealId: options.dealId });
  const companies = [...new Set(moved.map((row) => row.companyId).filter((id): id is string => Boolean(id)))];
  if (companies.length) await advanceCompanies(who, companies, target, { on, auto: true });
  return moved.map((row) => row.id);
}

export async function advanceContact(
  who: Who,
  contactId: string,
  target: ContactStatusValue,
  options: MoveOptions = {},
): Promise<boolean> {
  return (await advanceContacts(who, [contactId], target, options)).length > 0;
}

// A company is as far along as the furthest of its people; it is never
// Lost because one of them is, and Archived stays put.
export async function advanceCompanies(who: Who, companyIds: string[], target: ContactStatusValue, options: Omit<MoveOptions, "dealId"> = {}) {
  if (target === "LOST") return [];
  const on = options.on ?? new Date();
  const moved = await moveRecords("company", who, companyIds, (current) => forwardSteps(current, target, options), { on });
  return moved.map((row) => row.id);
}

export async function advanceCompany(
  who: Who,
  companyId: string,
  target: ContactStatusValue,
  options: Omit<MoveOptions, "dealId"> = {},
): Promise<boolean> {
  return (await advanceCompanies(who, [companyId], target, options)).length > 0;
}

// The first logged touch: Not Actioned becomes Contacted (shown as
// "Attempted"). Called for every contact an activity was logged on, and
// for a company logged directly.
export async function markContacted(who: Who, target: { contactIds: string[]; companyId?: string | null }, on: Date) {
  await advanceContacts(who, target.contactIds, "CONTACTED", { on });
  if (target.companyId) await advanceCompany(who, target.companyId, "CONTACTED", { on });
}

// A connect — a live talk, a reply, a held meeting (Nov 11, 2026): Not
// Actioned or Attempted becomes Connected, forward only, and the company
// follows like it does for every automatic move. A company logged
// directly (nobody linked) connects on its own.
export async function markConnected(who: Who, target: { contactIds: string[]; companyId?: string | null }, on: Date) {
  await advanceContacts(who, target.contactIds, "CONNECTED", { on });
  if (target.companyId) await advanceCompany(who, target.companyId, "CONNECTED", { on });
}

// Interested or Not Interested picked in "How did it go?" (Nov 11, 2026):
// set by a person, in the same save as the touch, with the reason they
// gave (decision 14). Only for someone still before the pipeline (Not
// Actioned, Attempted, Connected, Interested, Not Interested); a person
// at Meeting Set or further is moved from the Pipeline, and Lost or
// Archived from their page. From Not Actioned or Attempted it passes
// through Connected. The company follows forward, as always.
export async function markByHand(
  who: Who,
  target: { contactIds: string[]; companyId?: string | null },
  mark: "INTERESTED" | "NOT_INTERESTED",
  on: Date,
  reason: string | null = null,
) {
  const before = ["NOT_ACTIONED", "CONTACTED", "CONNECTED", "INTERESTED", "NOT_INTERESTED"];
  const plan = (current: string): Step[] | null =>
    before.includes(current) && current !== mark
      ? stepsTo(current, mark).map((step) => ({ to: step, auto: step !== mark, reason: step === mark ? reason : null }))
      : null;
  if (!target.contactIds.length) {
    return target.companyId ? (await moveRecords("company", who, [target.companyId], plan, { on })).map((row) => row.id) : [];
  }
  const moved = await moveRecords("contact", who, target.contactIds, plan, { on });
  const companies = [...new Set(moved.map((row) => row.companyId).filter((id): id is string => Boolean(id)))];
  if (companies.length) await advanceCompanies(who, companies, mark, { on, auto: true, reason });
  return moved.map((row) => row.id);
}

// A meeting booked with someone for the first time: Meeting Set. Only a
// contact, never a company on its own (Taylor, Sept 30, 2026); their
// company follows them. Since Oct 27, 2026 every meeting also lands on an
// opportunity (attachMeeting): `meeting` is the meeting's own day and the
// activity or calendar entry it is, where `on` is when it was set.
// `opportunity` picks which tile a booking joins ("auto": an open one any
// of these people is on; "new": always a new one; or an open one's id).
export async function markMeetingSet(
  who: Who,
  contactIds: string[],
  on: Date,
  meeting: { on?: Date; activityId?: string | null; eventId?: string | null; opportunity?: string | null } = {},
) {
  // Imported when called: opportunities.ts builds on this file.
  const { attachMeeting, meetingRowOf } = await import("@/lib/opportunities");
  // A meeting whose row is on a Won or Lost tile is history there
  // (attachMeeting adds nobody to it and starts no tile): saved again — the
  // calendar form re-saving the booked entry, a tick on it — it is not a new
  // meeting, so nobody moves, and someone Lost stays Lost (fix review, Nov
  // 11, 2026; it used to lift them back to Meeting Set).
  const found = await meetingRowOf(who.organizationId, meeting);
  if (!found.known || found.ownTile) await advanceContacts(who, contactIds, "MEETING_SET", { on });
  return attachMeeting(
    who,
    contactIds,
    {
      on: meeting.on ?? on,
      activityId: meeting.activityId,
      eventId: meeting.eventId,
      opportunity: meeting.opportunity,
    },
    found,
  );
}

export type SkippedDates = Partial<Record<(typeof PIPELINE_STEPS)[number], string>>;

// The pipeline steps between where a record is and where it is going that
// it has never been through: each needs a date when set by hand.
export function skippedSteps(current: string, target: string): (typeof PIPELINE_STEPS)[number][] {
  const from = PIPELINE_STEPS.indexOf(current as (typeof PIPELINE_STEPS)[number]);
  const to = PIPELINE_STEPS.indexOf(target as (typeof PIPELINE_STEPS)[number]);
  if (to <= 0) return [];
  // From before the pipeline, everything up to the target counts as
  // skipped, Meeting Set included.
  const start = from === -1 ? 0 : from + 1;
  return PIPELINE_STEPS.slice(start, to) as (typeof PIPELINE_STEPS)[number][];
}

// Deals whose contract has gone unanswered: Archived at 90 days, Lost at
// 180, both counted from the day the contract went out. Run whenever the
// Pipeline, Contacts or Stats is opened — the app's own clock, no outside
// scheduler — and cheap when there is nothing to do.
export async function sweepStaleContracts(organizationId: string) {
  const now = Date.now();
  const archiveBefore = new Date(now - CONTRACT_ARCHIVE_DAYS * 86_400_000);
  const loseBefore = new Date(now - CONTRACT_LOST_DAYS * 86_400_000);

  // Archiving keeps stageChangedAt as the day the contract went out, so
  // the 180 days run from there.
  const toArchive = await prisma.deal.findMany({
    where: { organizationId, stage: "CONTRACT_SENT", stageChangedAt: { lt: archiveBefore } },
    select: { id: true, stageChangedAt: true },
    take: 500,
  });
  for (const deal of toArchive) {
    await prisma.$transaction([
      prisma.deal.updateMany({ where: { id: deal.id, organizationId, stage: "CONTRACT_SENT" }, data: { stage: "ARCHIVED" } }),
      prisma.statusChange.create({
        data: {
          organizationId,
          dealId: deal.id,
          fromStatus: "CONTRACT_SENT",
          toStatus: "ARCHIVED",
          on: new Date(deal.stageChangedAt.getTime() + CONTRACT_ARCHIVE_DAYS * 86_400_000),
          auto: true,
        },
      }),
    ]);
  }

  const toLose = await prisma.deal.findMany({
    where: { organizationId, stage: "ARCHIVED", stageChangedAt: { lt: loseBefore } },
    select: { id: true, contactId: true, stageChangedAt: true },
    take: 500,
  });
  for (const deal of toLose) {
    const on = new Date(deal.stageChangedAt.getTime() + CONTRACT_LOST_DAYS * 86_400_000);
    await prisma.$transaction([
      prisma.deal.updateMany({ where: { id: deal.id, organizationId, stage: "ARCHIVED" }, data: { stage: "LOST", stageChangedAt: on } }),
      prisma.statusChange.create({
        data: { organizationId, dealId: deal.id, fromStatus: "ARCHIVED", toStatus: "LOST", on, auto: true },
      }),
    ]);
    await advanceContact({ organizationId }, deal.contactId, "LOST", { on, dealId: deal.id });
  }
  if (toLose.length) {
    const { syncOpportunityForDeal } = await import("@/lib/opportunities");
    for (const deal of toLose) await syncOpportunityForDeal({ organizationId }, deal.id);
  }
}

// Not in a "use server" file on purpose: it takes an organizationId and
// must never be callable from a browser.
// The day a contact's (or company's) meeting was set, for prefilling the
// dates of the steps skipped after it.
export async function meetingSetDay(organizationId: string, scope: { contactId?: string; companyId?: string }) {
  const row = await prisma.statusChange.findFirst({
    where: { organizationId, ...scope, toStatus: "MEETING_SET" },
    orderBy: { on: "desc" },
    select: { on: true },
  });
  return row?.on ?? null;
}
