"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireSession } from "@/lib/session";
import { askClaude, aiConfigured } from "@/lib/ai";
import { AI_DAILY_CAPS } from "@/lib/ai-assist";
import {
  ACTIVITY_LABELS,
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  NOTE_LABELS,
  STATUS_REASONS,
} from "@/lib/constants";
import { todayIso } from "@/lib/payments";
import { normalizeState } from "@/lib/states";
import { formatCents } from "@/lib/format";
import { ensureOpportunityForDeal, OPEN_OPPORTUNITY } from "@/lib/opportunities";
import { joinedBatchId, undoLogCore } from "@/lib/undo-log";
import {
  ACTIVITY_AI_MAX_WORDS,
  activityPrompt,
  activitySystemPrompt,
  answerSchema,
  checkAnswer,
  matchCompanies,
  matchPeople,
  openTilesFor,
} from "@/lib/activity-ai";
import { CARD_KINDS, DEAL_CHOICES, type ReadResult, type SaveResult } from "@/lib/activity-ai-shared";
import { readCardSave, signCardSave } from "@/lib/activity-ai-token";
import { bookMeeting, logActivity } from "@/app/dashboard/contacts/actions";
import { convertOpportunity } from "./opportunity-actions";
import { startQuoteForDeal } from "@/app/dashboard/quotes/actions";

// Activity AI on the Pipeline (Release 1, Nov 25, 2026; Taylor approved the
// "Pipeline AI Plan" recommendations the same day). Type or say what
// happened; the AI reads it into cards (readActivityWords); each card is
// saved through the doors every screen already uses (saveActivityCard):
// logActivity for a touch that happened or one scheduled ahead, bookMeeting
// for a meeting ahead, a note like the contact page's, and the Pipeline's
// own convert for a deal. So the status ladder, the calendar, the tiles,
// Stats and Undo behave exactly as for a touch logged by hand. No
// follow-up is ever added (Taylor: "no follow up logic"); a new contact or
// company is offered only after the duplicate check, and gets the person
// logging it as its rep unless they change it (decision 4).

const idSchema = z.string().trim().min(1).max(100);

const NOW = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date());

export async function readActivityWords(input: { words: string }): Promise<ReadResult | { error: string }> {
  const { organizationId, userId } = await requireSession();
  if (!aiConfigured()) return { error: "AI isn't switched on for this site yet." };
  const parsed = z
    .string()
    .trim()
    .min(3, "Say or type what happened first")
    .max(ACTIVITY_AI_MAX_WORDS, "That's too long to read at once. Split it in two.")
    .safeParse(input?.words);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Say or type what happened first" };
  const words = parsed.data;

  const [organization, users] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, timeZone: true } }),
    prisma.user.findMany({ where: { organizationId, removedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const timeZone = organization?.timeZone ?? "America/Chicago";
  const today = todayIso(timeZone);
  const now = NOW(timeZone);

  const answer = await askClaude({
    organizationId,
    userId,
    kind: "ACTIVITY_AI",
    perDay: AI_DAILY_CAPS.ACTIVITY_AI,
    system: activitySystemPrompt(organization?.name ?? "a small service business", users.map((user) => user.name)),
    prompt: activityPrompt({ words, today, now }),
    schema: answerSchema,
    maxTokens: 4000,
  });
  if ("error" in answer) return answer;

  const checked = checkAnswer(answer.data, words, today);
  if (checked.cards.length === 0) {
    return { error: "I couldn't tell who that was with. Name the person or the business and try again." };
  }
  const companies = await matchCompanies(organizationId, checked.companies);
  const companyIds = new Map(
    companies.map((row) => [
      row.key,
      [...new Set([...(row.pick?.kind === "found" ? [row.pick.id] : []), ...row.candidates.filter((each) => each.strong).map((each) => each.id)])],
    ]),
  );
  const people = await matchPeople(organizationId, checked.people, companyIds);
  const contactIds = [...new Set(people.flatMap((row) => row.candidates.map((each) => each.id)))];
  const tiles = await openTilesFor(organizationId, contactIds);

  // The deal's name: the business, else the person.
  const companyName = (key: string | null) => {
    if (!key) return null;
    const row = companies.find((each) => each.key === key);
    if (!row) return null;
    const found = row.pick?.kind === "found" ? row.candidates.find((each) => each.id === (row.pick as { id: string }).id) : null;
    return found?.name ?? row.said.name;
  };
  const cards = checked.cards.map((card) => {
    if (card.deal === "NONE") return card;
    const first = people.find((row) => row.key === card.personKeys[0]);
    const found = first?.pick?.kind === "found" ? first.candidates.find((each) => each.id === (first.pick as { id: string }).id) : null;
    const title = found?.companyName ?? companyName(first?.said.companyKey ?? null) ?? found?.name ?? first?.said.name ?? "New deal";
    return { ...card, dealTitle: title.slice(0, 160) };
  });

  return { cards, people, companies, tiles, today, now, meId: userId, users, dropped: checked.dropped };
}

// ---- Save ---------------------------------------------------------------

const saidPersonSchema = z.object({
  name: z.string().trim().min(1, "A person needs a name").max(160),
  title: z.string().trim().max(120).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
  companyKey: z.string().trim().max(20).nullish(),
});
const saidCompanySchema = z.object({
  name: z.string().trim().min(1, "A company needs a name").max(160),
  phone: z.string().trim().max(40).nullish(),
  website: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(120).nullish(),
  state: z.string().trim().max(60).nullish(),
});
const pickSchema = z.union([
  z.object({ kind: z.literal("found"), id: idSchema }),
  // `confirmed`: the person saw the "Is this the same person?" box and said
  // no, make a new one. Without it the server checks again before making it.
  z.object({ kind: z.literal("new"), confirmed: z.boolean().optional() }),
]);
const saveSchema = z.object({
  card: z.object({
    kind: z.enum(CARD_KINDS),
    type: z.enum(ACTIVITY_TYPES).nullable(),
    outcome: z.enum(ACTIVITY_OUTCOMES).nullable(),
    day: z.string().trim().max(10).nullable(),
    time: z.string().trim().max(8).nullable(),
    notes: z.string().trim().max(5000, "Keep the notes under 5,000 characters"),
    noteLabel: z.enum(NOTE_LABELS).nullable(),
    personKeys: z.array(z.string().trim().max(20)).max(8),
    companyKey: z.string().trim().max(20).nullable(),
    interest: z.enum(["INTERESTED", "NOT_INTERESTED"]).nullable(),
    reason: z.enum(STATUS_REASONS).nullable(),
    deal: z.enum(DEAL_CHOICES),
    valueCents: z.number().int().min(0).max(100_000_000_000).nullable(),
    dealTitle: z.string().trim().max(160),
    where: z.string().trim().max(200).nullable(),
  }),
  people: z.array(z.object({ key: z.string().trim().max(20), said: saidPersonSchema, pick: pickSchema })).max(8),
  companies: z.array(z.object({ key: z.string().trim().max(20), said: saidCompanySchema, pick: pickSchema })).max(8),
  // The rep on anything new: a teammate's id, or "" for Unassigned.
  rep: z.string().trim().max(100),
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function saveActivityCard(input: z.input<typeof saveSchema>): Promise<SaveResult> {
  const { organizationId, userId } = await requireSession();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That card couldn't be read. Try again." };
  const { card, rep } = parsed.data;
  const peopleByKey = new Map(parsed.data.people.map((row) => [row.key, row]));
  const companiesByKey = new Map(parsed.data.companies.map((row) => [row.key, row]));

  const personRows = card.personKeys.map((key) => peopleByKey.get(key));
  if (personRows.some((row) => !row)) return { ok: false, error: "A person on that card is missing. Read it again." };
  const people = personRows as NonNullable<(typeof personRows)[number]>[];
  const companyKeys = new Set<string>();
  if (card.companyKey && people.length === 0) companyKeys.add(card.companyKey);
  for (const person of people) if (person.pick.kind === "new" && person.said.companyKey) companyKeys.add(person.said.companyKey);
  const companyRows = [...companyKeys].map((key) => companiesByKey.get(key)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (people.length === 0 && companyRows.length === 0) return { ok: false, error: "Who was it with? Add a person or a business." };

  const timeZone = (await prisma.organization.findUnique({ where: { id: organizationId }, select: { timeZone: true } }))?.timeZone ?? "America/Chicago";
  const today = todayIso(timeZone);

  // What each kind needs (the browser shows the same, but a card can come
  // from anywhere).
  const type = card.kind === "NOTE" ? null : (card.type ?? (card.kind === "BOOK" ? "MEETING" : null));
  if (card.kind !== "NOTE" && !type) return { ok: false, error: "Pick what kind of touch it was" };
  const day = card.day && DAY.test(card.day) ? card.day : null;
  if (card.kind === "BOOK" && type !== "MEETING") return { ok: false, error: "Only a meeting can be booked" };
  if ((card.kind === "BOOK" || card.kind === "SCHEDULE") && people.length === 0) return { ok: false, error: "Who is it with? A booking needs a person." };
  if (card.kind === "BOOK" && (!day || day < today)) return { ok: false, error: "Pick today or a day ahead for the meeting" };
  if (card.kind === "SCHEDULE" && (!day || day <= today)) return { ok: false, error: "Pick a day ahead for it" };
  if (card.kind === "LOG" && day && day > today) return { ok: false, error: "That day is still ahead. Schedule it instead of logging it." };
  if (card.kind === "NOTE" && !card.notes) return { ok: false, error: "Write the note first" };
  const wantsDeal = card.kind === "LOG" && card.deal !== "NONE";
  if (wantsDeal && people.length === 0) return { ok: false, error: "A deal needs a person on it" };
  if (wantsDeal && card.deal === "PRICED" && !card.valueCents) return { ok: false, error: "Enter the price you gave them" };

  // The rep on anything new is a teammate who can still log in, or nobody.
  if (rep && !(await prisma.user.findFirst({ where: { id: rep, organizationId, removedAt: null }, select: { id: true } }))) {
    return { ok: false, error: "That rep isn't on your team any more. Pick another." };
  }

  // Found ones are checked; new ones are checked for look-alikes again,
  // unless the person already answered the box for them.
  const foundCompanyIds = companyRows.flatMap((row) => (row.pick.kind === "found" ? [row.pick.id] : []));
  const foundContactIds = people.flatMap((row) => (row.pick.kind === "found" ? [row.pick.id] : []));
  const [ownCompanies, ownContacts] = await Promise.all([
    prisma.company.findMany({ where: { organizationId, id: { in: foundCompanyIds } }, select: { id: true } }),
    prisma.contact.findMany({ where: { organizationId, id: { in: foundContactIds } }, select: { id: true, companyId: true } }),
  ]);
  if (ownCompanies.length !== new Set(foundCompanyIds).size || ownContacts.length !== new Set(foundContactIds).size) {
    return { ok: false, error: "Someone on that card is no longer here. Read it again." };
  }
  const newCompanies = companyRows.filter((row) => row.pick.kind === "new");
  const newPeople = people.filter((row) => row.pick.kind === "new");
  const uncheckedCompanies = newCompanies.filter((row) => !(row.pick.kind === "new" && row.pick.confirmed));
  const uncheckedPeople = newPeople.filter((row) => !(row.pick.kind === "new" && row.pick.confirmed));
  if (uncheckedCompanies.length || uncheckedPeople.length) {
    const companyMatches = await matchCompanies(
      organizationId,
      uncheckedCompanies.map((row) => ({ key: row.key, name: row.said.name, phone: row.said.phone ?? null, website: row.said.website ?? null, city: row.said.city ?? null, state: row.said.state ?? null })),
    );
    // A new person's business: the one picked on the card when it is found.
    const companyIds = new Map<string, string[]>();
    for (const row of parsed.data.companies) if (row.pick.kind === "found") companyIds.set(row.key, [row.pick.id]);
    const peopleMatches = await matchPeople(
      organizationId,
      uncheckedPeople.map((row) => ({ key: row.key, name: row.said.name, title: row.said.title ?? null, email: row.said.email ?? null, phone: row.said.phone ?? null, companyKey: row.said.companyKey ?? null })),
      companyIds,
    );
    const companyHits = Object.fromEntries(companyMatches.filter((row) => row.candidates.length).map((row) => [row.key, row.candidates]));
    const peopleHits = Object.fromEntries(peopleMatches.filter((row) => row.candidates.length).map((row) => [row.key, row.candidates]));
    if (Object.keys(companyHits).length || Object.keys(peopleHits).length) {
      return { ok: false, error: "Some of these may already be here. Check them, then Save.", people: peopleHits, companies: companyHits };
    }
  }

  // Make what's new: businesses first, then people (at the business picked
  // or just made for them).
  const created = { contactIds: [] as string[], companyIds: [] as string[] };
  const createdKeys: { key: string; kind: "person" | "company"; id: string }[] = [];
  const takeBack = async () => {
    if (created.contactIds.length) await prisma.contact.deleteMany({ where: { organizationId, id: { in: created.contactIds } } });
    if (created.companyIds.length) await prisma.company.deleteMany({ where: { organizationId, id: { in: created.companyIds } } });
  };
  const companyIdOf = new Map<string, string>();
  for (const row of parsed.data.companies) if (row.pick.kind === "found" && foundCompanyIds.includes(row.pick.id)) companyIdOf.set(row.key, row.pick.id);
  for (const row of newCompanies) {
    const company = await prisma.company.create({
      data: {
        organizationId,
        name: row.said.name.replace(/\s+/g, " "),
        phone: row.said.phone || null,
        website: row.said.website || null,
        city: row.said.city || null,
        state: normalizeState(row.said.state),
        createdById: userId,
        ownerId: rep || null,
      },
      select: { id: true },
    });
    created.companyIds.push(company.id);
    createdKeys.push({ key: row.key, kind: "company", id: company.id });
    companyIdOf.set(row.key, company.id);
  }
  const contactIdOf = new Map<string, string>();
  for (const row of people) if (row.pick.kind === "found") contactIdOf.set(row.key, row.pick.id);
  for (const row of newPeople) {
    const companyId = row.said.companyKey ? (companyIdOf.get(row.said.companyKey) ?? null) : null;
    const contact = await prisma.contact.create({
      data: {
        organizationId,
        name: row.said.name.replace(/\s+/g, " "),
        title: row.said.title || null,
        email: row.said.email ? row.said.email.toLowerCase() : null,
        phone: row.said.phone || null,
        companyId,
        createdById: userId,
        ownerId: rep || null,
      },
      select: { id: true },
    });
    created.contactIds.push(contact.id);
    createdKeys.push({ key: row.key, kind: "person", id: contact.id });
    contactIdOf.set(row.key, contact.id);
  }
  const contactIds = people.map((row) => contactIdOf.get(row.key)!).filter(Boolean);
  const companyId = people.length === 0 && card.companyKey ? (companyIdOf.get(card.companyKey) ?? null) : null;

  const sign = (batchId: string | null, noteIds: string[] = []) =>
    signCardSave({ v: 1, organizationId, userId, batchId, noteIds, contactIds: created.contactIds, companyIds: created.companyIds, at: Date.now() });
  const revalidate = () => {
    for (const id of contactIds) revalidatePath(`/dashboard/contacts/${id}`);
    if (companyId) revalidatePath(`/dashboard/companies/${companyId}`);
    for (const id of created.companyIds) revalidatePath(`/dashboard/companies/${id}`);
    revalidatePath("/dashboard/contacts");
    revalidatePath("/dashboard/companies");
    revalidatePath("/dashboard/deals");
    revalidatePath("/dashboard");
  };
  const newWords = createdKeys.length ? ` · ${createdKeys.length} new ${createdKeys.length === 1 ? "record" : "records"}` : "";

  // A note: on each person, or on the business.
  if (card.kind === "NOTE") {
    const batchId = contactIds.length > 1 ? randomUUID() : null;
    const notes = await prisma.note.createManyAndReturn({
      data: (contactIds.length ? contactIds.map((id) => ({ contactId: id, companyId: null })) : [{ contactId: null, companyId }]).map((target) => ({
        organizationId,
        ...target,
        authorId: userId,
        body: card.notes,
        label: card.noteLabel,
        batchId,
      })),
      select: { id: true },
    });
    revalidate();
    return { ok: true, words: `Note added${newWords}`, undo: sign(null, notes.map((row) => row.id)), created: createdKeys };
  }

  // A meeting ahead: booked like every meeting.
  if (card.kind === "BOOK") {
    const booked = await bookMeeting({
      contactId: contactIds[0],
      on: day!,
      time: card.time ?? undefined,
      withContactIds: contactIds.slice(1),
      where: card.where ?? undefined,
      note: card.notes || undefined,
      opportunity: "auto",
    });
    if (booked.error || !booked.batchId) {
      await takeBack();
      return { ok: false, error: booked.error ?? "The meeting couldn't be booked" };
    }
    revalidate();
    return { ok: true, words: `${booked.success ?? "Booked"}${newWords}`, undo: sign(booked.batchId), created: createdKeys, opportunityId: booked.opportunityId ?? null };
  }

  // A touch that happened, or one on a day ahead: the log form's own save.
  const form = new FormData();
  if (contactIds.length) {
    form.set("contactId", contactIds[0]);
    for (const id of contactIds.slice(1)) form.append("extraContactIds", id);
  } else if (companyId) {
    form.set("companyId", companyId);
    // With the business and nobody named: it waits on the company's page
    // under "<who> Bypassed" to be claimed, as the company page's box does.
    form.set("bypass", "1");
  }
  form.set("type", type!);
  form.set("body", card.notes || (card.kind === "SCHEDULE" ? ACTIVITY_LABELS[type!] : ""));
  form.set("occurredOn", day ?? today);
  if (card.time) form.set("atTime", card.time);
  if (card.kind === "LOG") {
    if (card.outcome) form.set("outcome", card.outcome);
    if (card.interest && contactIds.length) form.set("mark", card.interest);
    if (card.interest === "NOT_INTERESTED" && card.reason) form.set("reason", card.reason);
  }
  if (!form.get("body") && !card.outcome && !card.interest) form.set("body", ACTIVITY_LABELS[type!]);
  const logged = await logActivity({}, form);
  if (logged.error || !logged.batchId) {
    await takeBack();
    return { ok: false, error: logged.error ?? "That couldn't be logged" };
  }
  const batchId = logged.batchId;

  // Make it a deal (decisions 6 and 12): the Pipeline's own convert, joined
  // to this save so its Undo takes the deal back too. Off a meeting it is
  // that meeting's tile; off a call, text or email it is Add deal's path
  // (the tile waits at Meeting Completed until the quote is sent).
  let quoteUrl: string | undefined;
  let opportunityId: string | null = logged.opportunityId ?? null;
  const notices: string[] = [];
  if (wantsDeal && contactIds.length) {
    const title = card.dealTitle || "New deal";
    let dealId: string | null = null;
    // Off a call, text or email, a tile with its meeting still to come is
    // left alone: converting it would mark that meeting held.
    const waiting = opportunityId
      ? null
      : await prisma.opportunityContact.findFirst({
          where: { contactId: contactIds[0], role: { not: "HIDDEN" }, opportunity: { organizationId, stage: "MEETING_SET", dealId: null } },
          select: { opportunity: { select: { title: true } } },
        });
    // Nor is a second deal made for someone whose open tile has one.
    const hasDeal = opportunityId
      ? await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId, deal: { stage: { notIn: ["LEAD"] } } }, select: { title: true } })
      : await prisma.opportunityContact
          .findFirst({
            where: { contactId: contactIds[0], role: { not: "HIDDEN" }, opportunity: { organizationId, ...OPEN_OPPORTUNITY, dealId: { not: null } } },
            select: { opportunity: { select: { title: true } } },
          })
          .then((row) => row?.opportunity ?? null);
    if (hasDeal) {
      notices.push(`${hasDeal.title} is already a deal`);
    } else if (waiting) {
      notices.push(`The deal wasn't made: ${waiting.opportunity.title} has a meeting still to come. Make it a deal from the tile after the meeting.`);
    } else if (!opportunityId) {
      const deal = await prisma.deal.create({
        data: { organizationId, contactId: contactIds[0], title, valueCents: 0, ownerId: userId },
        select: { id: true },
      });
      dealId = deal.id;
      opportunityId = await ensureOpportunityForDeal({ organizationId, userId, batchId: joinedBatchId(batchId) }, deal.id);
    }
    if (hasDeal || waiting) {
      // Nothing more: the touch is saved, the tile stays as it is.
    } else if (!opportunityId) notices.push("The deal couldn't be put on the Pipeline");
    else if (card.deal === "PRICED") {
      const converted = await convertOpportunity({ id: opportunityId, mode: "manual", stage: "QUOTE_SENT", title, valueCents: card.valueCents ?? 0, batchId });
      if (converted.error) notices.push(converted.error);
      else notices.push(`Deal at Quote Sent for ${formatCents(card.valueCents ?? 0)}`);
    } else {
      if (!dealId) {
        const converted = await convertOpportunity({ id: opportunityId, mode: "quote", stage: "QUOTE_SENT", title, valueCents: 0, batchId });
        if (converted.error) notices.push(converted.error);
        dealId = converted.dealId ?? null;
      }
      if (dealId) {
        const started = await startQuoteForDeal({ dealId, contactId: contactIds[0] });
        if ("error" in started) notices.push(started.error);
        else quoteUrl = `/dashboard/quotes/${started.quoteId}?draft=words&from=${encodeURIComponent(batchId)}`;
      }
    }
  }
  revalidate();
  const words = [logged.success ?? "Logged", ...notices].join(" · ") + newWords;
  return {
    ok: true,
    words: quoteUrl ? `${words} · opening the quote` : words,
    // Build Quote has gone on to make a quote: the toast isn't offered, the
    // quote page's Delete is the way back.
    undo: quoteUrl ? null : sign(batchId),
    created: createdKeys,
    quoteUrl,
    opportunityId,
  };
}

// ---- Undo ---------------------------------------------------------------

// "Saved · Undo" on a card's save: the save's own batch (the touch, its
// calendar entry, statuses, a booking, a deal it made), its notes, then the
// contacts and companies it made, each only while nothing else is on it.
export async function undoActivityCard(token: string): Promise<{ success?: string; error?: string }> {
  const session = await requireAdminSession();
  const record = readCardSave(token);
  if (!record || record.organizationId !== session.organizationId) return { error: "That can't be undone any more" };
  if (record.userId !== session.userId && !session.allowed) return { error: "Only whoever saved it, or an Owner or Admin, can undo it" };
  const { organizationId } = session;

  let undid = false;
  const touched = { contactIds: [] as string[], companyIds: [] as string[] };
  if (record.batchId) {
    const result = await undoLogCore(organizationId, record.batchId, { userId: session.userId, canManage: session.allowed });
    if ("error" in result) {
      if (!record.contactIds.length && !record.companyIds.length && !record.noteIds.length) return { error: result.error };
    } else {
      undid = true;
      touched.contactIds.push(...result.contactIds);
      touched.companyIds.push(...result.companyIds);
    }
  }
  if (record.noteIds.length) {
    const removed = await prisma.note.deleteMany({ where: { organizationId, id: { in: record.noteIds } } });
    if (removed.count) undid = true;
  }

  const kept: string[] = [];
  for (const id of record.contactIds) {
    const row = await prisma.contact.findFirst({
      where: { id, organizationId },
      select: {
        name: true,
        _count: {
          select: {
            activities: true,
            notes: true,
            deals: true,
            quotes: true,
            contracts: true,
            opportunities: true,
            opportunityLogs: true,
            events: true,
            attending: true,
            emailSends: true,
            accounts: true,
            uploads: true,
            artworks: true,
            projects: true,
            crews: true,
            properties: true,
            photoGrants: true,
            statusChanges: true,
          },
        },
      },
    });
    if (!row) continue;
    if (Object.values(row._count).some((count) => count > 0)) {
      kept.push(row.name);
      continue;
    }
    await prisma.contact.deleteMany({ where: { id, organizationId } });
    undid = true;
  }
  for (const id of record.companyIds) {
    const row = await prisma.company.findFirst({
      where: { id, organizationId },
      select: {
        name: true,
        distributor: { select: { id: true } },
        _count: {
          select: {
            contacts: true,
            linkedContacts: true,
            statusChanges: true,
            notes: true,
            activities: true,
            uploads: true,
            artworks: true,
            contracts: true,
            projects: true,
            crews: true,
            events: true,
            properties: true,
            supplierQuoteLines: true,
            photoLinks: true,
          },
        },
      },
    });
    if (!row) continue;
    if (row.distributor || Object.values(row._count).some((count) => count > 0)) {
      kept.push(row.name);
      continue;
    }
    await prisma.company.deleteMany({ where: { id, organizationId } });
    undid = true;
  }

  for (const id of touched.contactIds) revalidatePath(`/dashboard/contacts/${id}`);
  for (const id of touched.companyIds) revalidatePath(`/dashboard/companies/${id}`);
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  if (!undid && !kept.length) return { error: "That has already been undone" };
  return { success: kept.length ? `Undone. Kept ${kept.join(", ")}: something else is on ${kept.length === 1 ? "it" : "them"} now.` : "Undone" };
}
