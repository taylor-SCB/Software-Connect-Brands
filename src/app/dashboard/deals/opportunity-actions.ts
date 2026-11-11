"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { BOARD_DEAL_STAGES, CONTACT_COLUMNS, PIPELINE_COLUMNS, STATUS_REASONS, type PipelineColumn } from "@/lib/constants";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { canonicalLeadLabel, isBuiltInLeadLabel } from "@/lib/lead-labels";
import { CONVERTED_STAGES, opportunityColumn, stampLostReason, syncOpportunity } from "@/lib/opportunities";
import { loadWorkspaceUsers } from "@/lib/workspace-users";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { zonedNoon } from "@/lib/money";
import { cleanTime, isRealDay } from "@/lib/calendar";
import { meetingHeldAnswer, meetingNoShowAnswer, meetingRescheduleAnswer } from "@/lib/meetings";
import { updateDealStage } from "./actions";

// The Pipeline's tiles (Oct 27, 2026): open one, move it, convert it to a
// deal, and save what its panel edits. The rules live in
// src/lib/opportunities.ts; these only check the request and call them.

type Result = { error?: string; success?: string };

const idSchema = z.string().trim().min(1).max(100);

function revalidateBoard() {
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard");
}

export type OpportunityPerson = {
  contactId: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  role: "PRIMARY" | "ASSOCIATED" | "HIDDEN";
  fromMeeting: boolean;
};

export type OpportunityDetail = {
  id: string;
  title: string;
  leadLabel: string | null;
  ownerId: string | null;
  column: string;
  deal: {
    id: string;
    stage: string;
    valueCents: number;
    // The value is read from the quotes once there are any.
    hasQuotes: boolean;
    quotes: { id: string; number: number; title: string; status: string }[];
  } | null;
  people: OpportunityPerson[];
  meetings: { id: string; on: string }[];
  users: { id: string; name: string }[];
  customLabels: string[];
};

export async function loadOpportunity(id: string): Promise<OpportunityDetail | { error: string }> {
  const { organizationId } = await requireSession();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: "That opportunity isn't valid" };
  const [opportunity, users, labels] = await Promise.all([
    prisma.opportunity.findFirst({
      where: { id: parsed.data, organizationId },
      select: {
        id: true,
        title: true,
        leadLabel: true,
        ownerId: true,
        stage: true,
        deal: {
          select: {
            id: true,
            stage: true,
            valueCents: true,
            quotes: { select: { ...QUOTES_FOR_VALUE.select, id: true, number: true, title: true, status: true }, orderBy: { createdAt: "desc" } },
          },
        },
        contacts: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            fromMeeting: true,
            contact: { select: { id: true, name: true, email: true, phone: true, company: { select: { name: true } } } },
          },
        },
        meetings: { orderBy: { on: "asc" }, select: { id: true, on: true } },
      },
    }),
    loadWorkspaceUsers(organizationId),
    prisma.leadLabelOption.findMany({ where: { organizationId, retiredAt: null }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  if (!opportunity) return { error: "That opportunity is no longer on the board" };
  const deal = opportunity.deal;
  return {
    id: opportunity.id,
    title: opportunity.title,
    leadLabel: opportunity.leadLabel,
    ownerId: opportunity.ownerId,
    column: opportunityColumn(opportunity),
    deal: deal
      ? {
          id: deal.id,
          stage: deal.stage,
          valueCents: dealValueCents(deal),
          hasQuotes: deal.quotes.length > 0,
          quotes: deal.quotes.map((quote) => ({ id: quote.id, number: quote.number, title: quote.title, status: quote.status })),
        }
      : null,
    people: opportunity.contacts.map((row) => ({
      contactId: row.contact.id,
      name: row.contact.name,
      company: row.contact.company?.name ?? null,
      email: row.contact.email,
      phone: row.contact.phone,
      role: row.role,
      fromMeeting: row.fromMeeting,
    })),
    meetings: opportunity.meetings.map((meeting) => ({ id: meeting.id, on: meeting.on.toISOString() })),
    users: users.map((user) => ({ id: user.id, name: user.name })),
    customLabels: labels.map((row) => row.name),
  };
}

// A tile dropped on a column, or moved from its menu. Between the two
// meeting columns it just moves. Into a deal column with no deal yet the
// browser asks "convert this to a deal?" instead (convertOpportunity); a
// deal moves between deal columns dated today, and never back into a
// meeting column.
export async function moveOpportunity(id: string, column: string): Promise<Result & { convert?: boolean }> {
  const { organizationId, userId } = await requireSession();
  const parsed = z.object({ id: idSchema, column: z.enum(PIPELINE_COLUMNS) }).safeParse({ id, column });
  if (!parsed.success) return { error: "That move isn't valid" };
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: parsed.data.id, organizationId },
    select: { id: true, stage: true, deal: { select: { id: true, stage: true } } },
  });
  if (!opportunity) return { error: "That opportunity is no longer on the board" };
  const target = parsed.data.column as PipelineColumn;
  if (opportunityColumn(opportunity) === target) return { success: "No change" };
  const toMeeting = (CONTACT_COLUMNS as readonly string[]).includes(target);

  if (opportunity.deal && CONVERTED_STAGES.includes(opportunity.deal.stage)) {
    if (toMeeting) return { error: "A deal can't go back to a meeting column. Move it to Lost, or start a new opportunity." };
    const moved = await updateDealStage(opportunity.deal.id, target);
    return moved.error ? { error: moved.error } : { success: "Moved" };
  }
  if (!toMeeting) {
    // A draft quote's deal (not sent yet) just moves; nothing to convert.
    if (opportunity.deal) {
      const moved = await updateDealStage(opportunity.deal.id, target);
      return moved.error ? { error: moved.error } : { success: "Moved" };
    }
    return { convert: true };
  }
  await prisma.opportunity.updateMany({
    where: { id: opportunity.id, organizationId },
    data: { stage: target as "MEETING_SET" | "MEETING_COMPLETED" },
  });
  await syncOpportunity({ organizationId, userId }, opportunity.id);
  revalidateBoard();
  return { success: "Moved" };
}

const convertSchema = z.object({
  id: idSchema,
  stage: z.enum(BOARD_DEAL_STAGES),
  // Build Quote opens a new quote on the deal; Manual Input takes a value.
  mode: z.enum(["quote", "manual"]),
  title: z.string().trim().min(1, "Give the deal a name").max(160),
  valueCents: z.number().int().min(0).max(100_000_000_000).default(0),
  on: z.string().trim().optional(),
});

// "Do you want to convert this to a deal?" → Save and Accept. Makes the
// one deal this opportunity gets, at the stage picked, under its Primary
// POC; a draft quote's deal already on it is moved instead of doubled.
export async function convertOpportunity(input: z.input<typeof convertSchema>): Promise<Result & { dealId?: string; quoteUrl?: string }> {
  const { organizationId, userId } = await requireSession();
  const parsed = convertSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That conversion isn't valid" };
  const { id, stage, mode, title, valueCents } = parsed.data;

  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  const day = parsed.data.on || today;
  if (!isRealDay(day)) return { error: "That day isn't a real date" };
  if (day > today) return { error: "That day hasn't happened yet" };
  const at = day === today ? new Date() : zonedNoon(day, timeZone);

  const opportunity = await prisma.opportunity.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      ownerId: true,
      deal: { select: { id: true, stage: true } },
      contacts: { where: { role: { not: "HIDDEN" } }, orderBy: { createdAt: "asc" }, select: { contactId: true, role: true } },
    },
  });
  if (!opportunity) return { error: "That opportunity is no longer on the board" };
  if (opportunity.deal && CONVERTED_STAGES.includes(opportunity.deal.stage)) return { error: "This one is already a deal" };
  const primary = opportunity.contacts.find((row) => row.role === "PRIMARY") ?? opportunity.contacts[0];
  if (!primary) return { error: "Pick a Primary POC on the opportunity first" };

  let dealId: string;
  if (opportunity.deal) {
    dealId = opportunity.deal.id;
    await prisma.$transaction([
      prisma.deal.updateMany({
        where: { id: dealId, organizationId },
        data: { stage, stageChangedAt: at, title, ...(mode === "manual" ? { valueCents } : {}) },
      }),
      prisma.statusChange.create({
        data: { organizationId, dealId, userId, fromStatus: opportunity.deal.stage, toStatus: stage, on: at, auto: false },
      }),
    ]);
  } else {
    const deal = await prisma.deal.create({
      data: {
        organizationId,
        contactId: primary.contactId,
        title,
        stage,
        stageChangedAt: at,
        valueCents: mode === "manual" ? valueCents : 0,
        ownerId: opportunity.ownerId ?? userId,
      },
      select: { id: true },
    });
    dealId = deal.id;
    // Linked only if nobody else converted it in the meantime.
    const claimed = await prisma.opportunity.updateMany({
      where: { id: opportunity.id, organizationId, dealId: null },
      data: { dealId, stage: "MEETING_COMPLETED" },
    });
    if (claimed.count === 0) {
      await prisma.deal.deleteMany({ where: { id: dealId, organizationId } });
      return { error: "Someone else just converted this one. Refresh the board." };
    }
    await prisma.statusChange.create({
      data: { organizationId, dealId, userId, fromStatus: "LEAD", toStatus: stage, on: at, auto: false },
    });
  }
  await prisma.opportunity.updateMany({ where: { id: opportunity.id, organizationId }, data: { stage: "MEETING_COMPLETED" } });
  await syncOpportunity({ organizationId, userId }, opportunity.id);
  revalidateBoard();
  return {
    success: "Converted to a deal",
    dealId,
    ...(mode === "quote" ? { quoteUrl: `/dashboard/quotes/new?contactId=${primary.contactId}&dealId=${dealId}` } : {}),
  };
}

const saveSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1, "Give it a name").max(160),
  leadLabel: z.string().trim().max(60).nullable(),
  ownerId: z.string().trim().max(64),
  // Only taken when the deal has no quotes; null leaves it alone.
  valueCents: z.number().int().min(0).max(100_000_000_000).nullable(),
  people: z
    .array(z.object({ contactId: idSchema, role: z.enum(["PRIMARY", "ASSOCIATED", "HIDDEN"]) }))
    .min(1)
    .max(200),
});

// The panel's Save: name, lead label, rep, value, and who is Primary,
// Associated or Do Not List — anyone new added with their role. A
// meeting's own log is never touched; only this opportunity's list.
export async function saveOpportunity(input: z.input<typeof saveSchema>): Promise<Result> {
  const { organizationId, userId } = await requireSession();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That couldn't be saved" };
  const data = parsed.data;

  const primaries = data.people.filter((person) => person.role === "PRIMARY");
  if (primaries.length !== 1) return { error: primaries.length ? "Only one person can be the Primary POC" : "Pick a Primary POC" };
  const ids = Array.from(new Set(data.people.map((person) => person.contactId)));
  if (ids.length !== data.people.length) return { error: "Someone is listed twice" };

  const opportunity = await prisma.opportunity.findFirst({
    where: { id: data.id, organizationId },
    select: {
      id: true,
      ownerId: true,
      deal: { select: { id: true, _count: { select: { quotes: true } } } },
      contacts: { select: { contactId: true } },
    },
  });
  if (!opportunity) return { error: "That opportunity is no longer on the board" };
  const owned = await prisma.contact.count({ where: { organizationId, id: { in: ids } } });
  if (owned !== ids.length) return { error: "One of those contacts is no longer here" };
  // Everyone already on it stays on it: Do Not List takes them off the tile.
  const onIt = new Set(opportunity.contacts.map((row) => row.contactId));
  if (opportunity.contacts.some((row) => !ids.includes(row.contactId))) return { error: "Refresh the board: someone was added to this one meanwhile" };

  if (data.ownerId && data.ownerId !== opportunity.ownerId) {
    const rep = await prisma.user.findFirst({ where: { id: data.ownerId, organizationId, removedAt: null }, select: { id: true } });
    if (!rep) return { error: "That person isn't on this account" };
  }

  const leadLabel = canonicalLeadLabel(data.leadLabel);
  if (leadLabel && !isBuiltInLeadLabel(leadLabel)) {
    await prisma.leadLabelOption.createMany({ data: [{ organizationId, name: leadLabel }], skipDuplicates: true });
  }

  await prisma.$transaction([
    prisma.opportunity.updateMany({
      where: { id: opportunity.id, organizationId },
      data: { title: data.title, leadLabel, ownerId: data.ownerId || null },
    }),
    ...data.people
      .filter((person) => onIt.has(person.contactId))
      .map((person) =>
        prisma.opportunityContact.updateMany({
          where: { opportunityId: opportunity.id, contactId: person.contactId },
          data: { role: person.role },
        }),
      ),
    prisma.opportunityContact.createMany({
      data: data.people
        .filter((person) => !onIt.has(person.contactId))
        .map((person) => ({ opportunityId: opportunity.id, contactId: person.contactId, role: person.role })),
      skipDuplicates: true,
    }),
    ...(opportunity.deal
      ? [
          prisma.deal.updateMany({
            where: { id: opportunity.deal.id, organizationId },
            data: {
              ownerId: data.ownerId || null,
              ...(data.valueCents !== null && opportunity.deal._count.quotes === 0 ? { valueCents: data.valueCents } : {}),
            },
          }),
        ]
      : []),
  ]);
  await syncOpportunity({ organizationId, userId }, opportunity.id);
  revalidateBoard();
  for (const id of ids) revalidatePath(`/dashboard/contacts/${id}`);
  return { success: "Saved" };
}

// The lead label picked straight from a tile's chip.
export async function setOpportunityLabel(id: string, label: string | null): Promise<Result> {
  const { organizationId } = await requireSession();
  const parsed = z.object({ id: idSchema, label: z.string().trim().max(60).nullable() }).safeParse({ id, label });
  if (!parsed.success) return { error: "That label isn't valid" };
  const leadLabel = canonicalLeadLabel(parsed.data.label);
  if (leadLabel && !isBuiltInLeadLabel(leadLabel)) {
    await prisma.leadLabelOption.createMany({ data: [{ organizationId, name: leadLabel }], skipDuplicates: true });
  }
  const saved = await prisma.opportunity.updateMany({ where: { id: parsed.data.id, organizationId }, data: { leadLabel } });
  if (saved.count === 0) return { error: "That opportunity is no longer on the board" };
  revalidatePath("/dashboard/deals");
  return { success: "Label saved" };
}

/* -------------------------------- Meetings -------------------------------- */

// Held / No-show / Reschedule on a meeting (BDR redesign, Nov 11, 2026),
// for the Pipeline's "Happened — how did it go?" tiles, the panel's
// meetings and Up next. The rules are in src/lib/meetings.ts. Each hands
// back a batchId for "Saved · Undo" (undoLog in contacts/actions.ts).

function revalidateMeeting(contactIds: string[] = []) {
  revalidateBoard();
  revalidatePath("/dashboard/calendar");
  for (const id of contactIds) revalidatePath(`/dashboard/contacts/${id}`);
}

// Held: HELD on the meeting's own history line (a MEETING line is written
// only when it has none, so nothing is counted twice), everyone in it
// Connected, and the tile and its people at Meeting Completed (decision
// 4). A meeting whose day is still ahead comes back as { confirmEarly:
// "yyyy-mm-dd" } ("This meeting is Tue Nov 17. Did it happen early?") and
// is held only when called again with { early: true }.
export async function markMeetingHeld(
  meetingId: string,
  options: { early?: boolean; note?: string } = {},
): Promise<Result & { batchId?: string; confirmEarly?: string; opportunityId?: string }> {
  const { organizationId, userId } = await requireSession();
  const parsed = z
    .object({ meetingId: idSchema, early: z.boolean().optional(), note: z.string().trim().max(5000).optional() })
    .safeParse({ meetingId, ...options });
  if (!parsed.success) return { error: "That meeting isn't valid" };
  const { contactIds, ...answer } = await meetingHeldAnswer({ organizationId, userId }, parsed.data.meetingId, {
    early: parsed.data.early,
    note: parsed.data.note,
  });
  if (answer.success) revalidateMeeting(contactIds);
  return answer;
}

// No-show: they stay Meeting Set; the meeting and its line read NO_SHOW,
// which is neither a touch nor a connect. Offer reschedule next.
export async function markMeetingNoShow(meetingId: string): Promise<Result & { batchId?: string }> {
  const { organizationId, userId } = await requireSession();
  const parsed = idSchema.safeParse(meetingId);
  if (!parsed.success) return { error: "That meeting isn't valid" };
  const answer = await meetingNoShowAnswer({ organizationId, userId }, parsed.data);
  if (answer.success) revalidateMeeting();
  return answer;
}

// Reschedule to a day (today or later) and an optional "HH:MM". A meeting
// still to come moves; one whose day has gone by is marked a no-show and a
// new meeting is booked on the same tile (meetingId is the new one, and
// batchId takes both back).
export async function rescheduleMeeting(
  meetingId: string,
  input: { on: string; time?: string | null },
): Promise<Result & { meetingId?: string; batchId?: string }> {
  const { organizationId, userId } = await requireSession();
  const parsed = z
    .object({ meetingId: idSchema, on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the new day"), time: z.string().max(8).nullish() })
    .safeParse({ meetingId, ...input });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick the new day" };
  if (!isRealDay(parsed.data.on)) return { error: "That day isn't a real date" };
  const answer = await meetingRescheduleAnswer({ organizationId, userId }, parsed.data.meetingId, {
    on: parsed.data.on,
    time: cleanTime(parsed.data.time),
  });
  if (answer.success) revalidateMeeting();
  return answer;
}

// The one-tap reason a deal was lost (decision 14: Price · Timing · Has a
// vendor · No budget · Other), asked right after a tile is moved or
// converted to Lost: written on that move's StatusChange rows — the
// deal's and its people's latest Lost.
export async function saveLostReason(opportunityId: string, reason: string): Promise<Result> {
  const { organizationId } = await requireSession();
  const parsed = z.object({ id: idSchema, reason: z.enum(STATUS_REASONS) }).safeParse({ id: opportunityId, reason });
  if (!parsed.success) return { error: "Pick one of the reasons" };
  const answer = await stampLostReason(organizationId, parsed.data.id, parsed.data.reason);
  if (answer.success) revalidateBoard();
  return answer;
}
