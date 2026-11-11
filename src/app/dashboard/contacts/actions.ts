"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireSession } from "@/lib/session";
import { keepFields, parseForm, type ActionState } from "@/lib/forms";
import { dollarsToCents } from "@/lib/format";
import { ACTIVITY_EVENT_TYPE, ACTIVITY_LABELS, ACTIVITY_TYPES, CHANNEL_LABELS, CONNECT_OUTCOMES, START_STATUSES } from "@/lib/constants";
import { findOrCreateCompany, normalizeState } from "@/lib/companies";
import { ensureIndustryOptions, mergeTags, readIndustryFields } from "@/lib/industries";
import { sameTags, withoutAuto } from "@/lib/enrich";
import { moneyHold, moneyHoldMessage, zonedNoon } from "@/lib/money";
import { getTimeZone } from "@/lib/organization";
import { isoToDate, todayIso } from "@/lib/payments";
import { cleanTime, isRealDay } from "@/lib/calendar";
import {
  planNextStep,
  recordActivityEvent,
  scheduleActivityEvent,
  scheduleFollowUpEvents,
  writeNextStep,
  zonedMoment,
} from "@/lib/calendar-auto";
import { markByHand, markConnected, markContacted, markMeetingSet } from "@/lib/status";
import { ensureOpportunityForDeal, OPEN_OPPORTUNITY } from "@/lib/opportunities";
import { bookMeetingCore, meetingFor, recordMeetingHeld } from "@/lib/meetings";
import { newBatchId, undoLogCore } from "@/lib/undo-log";
import {
  connectOutcomeFor,
  markSchema,
  nextStepSchema,
  outcomeNote,
  outcomeProblem,
  outcomeSchema,
  readNextStep,
  reasonSchema,
} from "@/lib/outcomes";
import { formatDay } from "@/lib/format";
import {
  targetSchema,
  readTarget,
  resolveTargets,
  noteBodySchema,
  noteLabelSchema,
  activityTypeSchema,
  type FollowUpSeed,
  type LogActivityState,
} from "@/lib/logging";

import { hasFile, imageProblem, removeImage, replaceImage } from "@/lib/uploads";
import { readRepField } from "@/lib/reps";

const idSchema = z.string().trim().min(1, "Missing record reference");

const contactSchema = z.object({
  name: z.string().trim().min(1, "Contact name is required"),
  title: z.string().trim().max(120).optional(),
  companyName: z.string().trim().max(120).optional(),
  email: z.union([z.literal(""), z.email("Enter a valid email address")]).optional(),
  phone: z.string().trim().max(40).optional(),
  emailLabel: z.enum(CHANNEL_LABELS).catch("WORK"),
  email2: z.union([z.literal(""), z.email("Enter a valid second email address")]).optional(),
  email2Label: z.enum(CHANNEL_LABELS).catch("PERSONAL"),
  phoneLabel: z.enum(CHANNEL_LABELS).catch("WORK"),
  phone2: z.string().trim().max(40).optional(),
  phone2Label: z.enum(CHANNEL_LABELS).catch("PERSONAL"),
  mobile: z.string().trim().max(40).optional(),
  website: z.union([z.literal(""), z.string().trim().max(200)]).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(60).optional(),
  birthday: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Birthday isn't a valid date")]).optional(),
  // Only a new record's form offers a status, and only the ones before
  // the pipeline; after that it is the status button on the record's page
  // (Sept 30, 2026), which asks for dates when a step is skipped.
  status: z.enum(START_STATUSES).optional(),
});

// Accepts "acme.com" as well as a full URL — people type the bare domain.
function normalizeWebsite(value: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

// A date input gives "1984-03-09"; store it as that calendar day.
function toBirthday(value: string | undefined) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function readContactForm(formData: FormData) {
  return {
    name: formData.get("name"),
    title: formData.get("title") ?? undefined,
    companyName: formData.get("companyName") ?? undefined,
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    emailLabel: formData.get("emailLabel") ?? undefined,
    email2: formData.get("email2") ?? undefined,
    email2Label: formData.get("email2Label") ?? undefined,
    phoneLabel: formData.get("phoneLabel") ?? undefined,
    phone2: formData.get("phone2") ?? undefined,
    phone2Label: formData.get("phone2Label") ?? undefined,
    mobile: formData.get("mobile") ?? undefined,
    website: formData.get("website") ?? undefined,
    city: formData.get("city") ?? undefined,
    state: formData.get("state") ?? undefined,
    birthday: formData.get("birthday") ?? undefined,
    status: formData.get("status") ?? undefined,
  };
}

async function assertContact(contactId: string, organizationId: string) {
  return prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    select: { id: true },
  });
}

async function contactData(
  parsed: z.infer<typeof contactSchema>,
  organizationId: string,
  formData: FormData,
  userId: string,
) {
  // The exact company picked, when its name still matches the box; a
  // typed name otherwise finds or makes the company by name.
  const pickedId = formData.get("companyId");
  const picked =
    parsed.companyName && typeof pickedId === "string" && pickedId
      ? await prisma.company.findFirst({
          where: { id: pickedId, organizationId, name: { equals: parsed.companyName.trim().replace(/\s+/g, " "), mode: "insensitive" } },
          select: { id: true },
        })
      : null;
  const companyId = parsed.companyName
    ? (picked ?? (await findOrCreateCompany(parsed.companyName, organizationId, userId))).id
    : null;
  // Industry and Company Type belong to the company; the contact form
  // edits them in place so one business is never tagged three ways.
  const tags = readIndustryFields(formData);
  if (companyId && tags.touched) {
    const canonical = await ensureIndustryOptions(organizationId, tags.industries, tags.typesByIndustry, tags.offList);
    const industries = canonical.industries;
    const companyTypes = mergeTags(canonical.companyTypes, tags.keepTypes);
    // Tags the app guessed stop being "auto" once a person changes them here.
    const current = await prisma.company.findFirst({
      where: { id: companyId, organizationId },
      select: { industries: true, companyTypes: true, autoFilled: true },
    });
    const changed = current && (!sameTags(current.industries, industries) || !sameTags(current.companyTypes, companyTypes));
    const marks = changed ? { autoFilled: withoutAuto(current.autoFilled, ["industries", "companyTypes"]) } : {};
    await prisma.company.updateMany({
      where: { id: companyId, organizationId },
      data: { industries, companyTypes, ...marks },
    });
  }
  return {
    name: parsed.name,
    title: parsed.title || null,
    companyId,
    email: parsed.email ? parsed.email.toLowerCase() : null,
    phone: parsed.phone || null,
    emailLabel: parsed.emailLabel,
    email2: parsed.email2 ? parsed.email2.toLowerCase() : null,
    email2Label: parsed.email2Label,
    phoneLabel: parsed.phoneLabel,
    phone2: parsed.phone2 || null,
    phone2Label: parsed.phone2Label,
    mobile: parsed.mobile || null,
    website: normalizeWebsite(parsed.website || null),
    city: parsed.city || null,
    state: normalizeState(parsed.state || null),
    birthday: toBirthday(parsed.birthday),
    ...(parsed.status ? { status: parsed.status } : {}),
  };
}

export async function createContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = parseForm(contactSchema, readContactForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const imageFile = formData.get("imageFile");
  const problem = imageProblem(imageFile);
  if (problem) return { error: problem };
  // Unassigned unless a rep was picked on the form (Nov 10, 2026).
  const rep = await readRepField(organizationId, formData);
  if ("error" in rep) return { error: rep.error };

  const contact = await prisma.contact.create({
    data: { organizationId, createdById: userId, ...rep, ...(await contactData(parsed.data, organizationId, formData, userId)) },
  });
  if (hasFile(imageFile)) {
    const imageUrl = await replaceImage({ organizationId, kind: "CONTACT_IMAGE", file: imageFile, contactId: contact.id });
    await prisma.contact.update({ where: { id: contact.id }, data: { imageUrl } });
  }

  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  redirect(`/dashboard/contacts/${contact.id}`);
}

export async function updateContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const id = idSchema.safeParse(formData.get("contactId"));
  if (!id.success) return { error: "Missing contact reference" };

  const parsed = parseForm(contactSchema, readContactForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const imageFile = formData.get("imageFile");
  const problem = imageProblem(imageFile);
  if (problem) return { error: problem };

  if (!(await assertContact(id.data, organizationId))) return { error: "Contact not found" };
  const rep = await readRepField(organizationId, formData);
  if ("error" in rep) return { error: rep.error };

  const image: { imageUrl?: string | null } = {};
  if (hasFile(imageFile)) {
    image.imageUrl = await replaceImage({ organizationId, kind: "CONTACT_IMAGE", file: imageFile, contactId: id.data });
  } else if (formData.get("removeImage") === "true") {
    await removeImage({ organizationId, kind: "CONTACT_IMAGE", contactId: id.data });
    image.imageUrl = null;
  }

  // updateMany (not update) so the organizationId scope is part of the
  // WHERE clause — a guessed id from another tenant matches zero rows.
  const result = await prisma.contact.updateMany({
    where: { id: id.data, organizationId },
    data: { ...(await contactData(parsed.data, organizationId, formData, userId)), ...image, ...rep },
  });
  if (result.count === 0) return { error: "Contact not found" };

  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath(`/dashboard/contacts/${id.data}`);
  return { success: "Contact saved" };
}

// The star. Returns the new state so the button can settle on it.
export async function setContactFavorite(
  contactId: string,
  favorite: boolean,
): Promise<{ favorite: boolean } | { error: string }> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contactId);
  if (!id.success) return { error: "Missing contact reference" };
  const result = await prisma.contact.updateMany({
    where: { id: id.data, organizationId },
    data: { favorite: Boolean(favorite) },
  });
  if (result.count === 0) return { error: "Contact not found" };
  revalidatePath("/dashboard/contacts");
  revalidatePath(`/dashboard/contacts/${id.data}`);
  return { favorite: Boolean(favorite) };
}

// Deleting a contact takes their contracts with it, so it is refused once
// money is on them — payments recorded, or a signed Money-in contract
// still owed. Archiving keeps the history and gets them out of the way.
export async function deleteContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("contactId"));
  if (!id.success) return { error: "Missing contact reference" };

  const contact = await prisma.contact.findFirst({
    where: { id: id.data, organizationId },
    select: { name: true },
  });
  if (!contact) return { error: "Contact not found" };

  const hold = await moneyHold(organizationId, { contactId: id.data });
  const refusal = moneyHoldMessage(contact.name, hold, "contact");
  if (refusal) return { error: refusal };

  await prisma.contact.deleteMany({ where: { id: id.data, organizationId } });
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  redirect("/dashboard/contacts");
}

function revalidateTarget(primary: { contactId?: string; companyId?: string }) {
  if (primary.contactId) revalidatePath(`/dashboard/contacts/${primary.contactId}`);
  if (primary.companyId) revalidatePath(`/dashboard/companies/${primary.companyId}`);
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard");
}

// Shared by the contact page and the company page. A contact note can be
// fanned out to extra contacts; every copy shares a batchId.
export async function addNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = parseForm(
    z.object({ target: targetSchema, body: noteBodySchema, label: noteLabelSchema }),
    { target: readTarget(formData), body: formData.get("body"), label: formData.get("label") ?? undefined },
  );
  if (!parsed.ok) return { error: parsed.error };

  const targets = await resolveTargets(parsed.data.target, organizationId);
  if (!targets) return { error: "Record not found" };

  await prisma.note.createMany({
    data: targets.rows.map((row) => ({
      organizationId,
      contactId: row.contactId,
      companyId: row.companyId,
      authorId: userId,
      body: parsed.data.body,
      label: parsed.data.label || null,
      batchId: targets.batchId,
    })),
  });

  revalidateTarget(targets.primary);
  const others = targets.rows.length - 1;
  return { success: others > 0 ? `Note added to ${others + 1} contacts` : "Note added" };
}

// What logActivity hands back: the usual message and follow-up seed, plus
// the save's batchId for "Saved · Undo" (undoLog), the next step's words
// ("Booked Tue Nov 17, 10am · Kristen is on your Pipeline in Meeting Set",
// "Call follow-up on the calendar for Nov 14") and the opportunity a
// booked or held meeting is on.
export type LogResult = LogActivityState & { batchId?: string; notices?: string[]; opportunityId?: string | null };

// Logs a call, text, email or meeting — and puts it on the calendar. The
// "When" on the form defaults to today; a day in the past is logged on
// that day, so a call remembered on Friday lands on Wednesday where it
// happened. A day still ahead is not history yet: it goes on the
// calendar as something to do, and nothing is written to anyone's
// Activity until it has happened.
//
// "How did it go?" (Nov 11, 2026) — every field optional, so today's form
// works unchanged:
// - `outcome`: one of OUTCOMES_BY_TYPE[type] (NO_ANSWER, VOICEMAIL,
//   GATEKEEPER, BAD_NUMBER, TALKED for a call; SENT, REPLIED for a text or
//   email; HELD, NO_SHOW for a meeting). With an outcome (or a mark) the
//   note may be left empty: the chip's words become it. TALKED, REPLIED and
//   HELD make everyone on it Connected; a meeting HELD moves them and its
//   tile to Meeting Completed (decision 4); NO_SHOW is not a touch.
// - `mark`: INTERESTED or NOT_INTERESTED, set by hand in the same save,
//   with `reason` (PRICE, TIMING, HAS_VENDOR, NO_BUDGET, OTHER) on a Not
//   interested (decision 14).
// - The next step (`next` = follow | book | park | meeting, with nextOn,
//   nextTime, nextType, nextWith, nextWhere, nextNote, opportunity; see
//   nextStepSchema). `book` is "Try to book a meeting", a reminder that
//   moves no status (decision 5); `park` is "Try again in 30 days"
//   (decision 12); `meeting` books it now through the same path as every
//   meeting (Meeting Set, the opportunity, bookedById) and, with no
//   outcome given, logs the touch as TALKED (a call) / REPLIED / HELD.
// - On a company page, the "Front desk" chip (outcome GATEKEEPER) lets a
//   log with nobody ticked through, like the bypass box.
// A touch dated ahead can't carry an outcome or a mark yet.
export async function logActivity(_prev: LogActivityState, formData: FormData): Promise<LogResult> {
  const { organizationId, userId } = await requireSession();

  const parsed = parseForm(
    z.object({
      target: targetSchema,
      type: activityTypeSchema,
      body: z.string().trim().max(5000, "That summary is too long"),
      occurredOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day")]).optional(),
      outcome: z.union([z.literal(""), outcomeSchema]).optional(),
      mark: z.union([z.literal(""), markSchema]).optional(),
      reason: z.union([z.literal(""), reasonSchema]).optional(),
      next: nextStepSchema.optional(),
    }),
    {
      target: readTarget(formData),
      type: formData.get("type"),
      body: formData.get("body") ?? "",
      occurredOn: formData.get("occurredOn") ?? undefined,
      outcome: formData.get("outcome") ?? undefined,
      mark: formData.get("mark") ?? undefined,
      reason: formData.get("reason") ?? undefined,
      next: readNextStep(formData),
    },
  );
  if (!parsed.ok) return { error: parsed.error, kept: keepFields(formData, ["body", "occurredOn", "atTime"]) };
  const type = parsed.data.type;
  const mark = parsed.data.mark || null;
  const reason = mark === "NOT_INTERESTED" ? parsed.data.reason || null : null;
  const next = parsed.data.next;
  // Booking the meeting on the call says how the call went.
  const outcome = parsed.data.outcome || (next?.kind === "meeting" ? connectOutcomeFor(type) : null);
  const problem = outcomeProblem(type, outcome);
  if (problem) return { error: problem, kept: keepFields(formData, ["body", "occurredOn", "atTime"]) };
  const body = parsed.data.body || outcomeNote({ outcome, mark, reason, booked: next?.kind === "meeting" });
  if (!body) return { error: "Add a short summary", kept: keepFields(formData, ["body", "occurredOn", "atTime"]) };

  const targets = await resolveTargets(parsed.data.target, organizationId);
  if (!targets) return { error: "Record not found" };

  // On a company page an activity is with a person at it (Taylor, Oct 4,
  // 2026). Nobody ticked is only allowed with the "I'm choosing not to
  // link a contact" box ticked, or the "Front desk" chip (Nov 11, 2026);
  // it then sits on the company under "<who> Bypassed" in Other Contacts
  // until somebody claims it. The typed fields come back with the refusal
  // so nothing is lost.
  const onCompanyOnly = targets.rows.length === 1 && !targets.rows[0].contactId && Boolean(targets.rows[0].companyId);
  if (onCompanyOnly && formData.get("bypass") !== "1" && outcome !== "GATEKEEPER") {
    return {
      error: "Tick who at this company it was with, or tick “I'm choosing not to link a contact for these activities”.",
      kept: keepFields(formData, ["body", "occurredOn", "atTime"]),
    };
  }

  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  const on = parsed.data.occurredOn || today;
  if (!isRealDay(on)) return { error: "That day isn't a real date" };
  const atTime = cleanTime(formData.get("atTime"));
  if (on > today && (parsed.data.outcome || mark)) {
    return { error: "A touch dated ahead hasn't happened yet, so it can't say how it went", kept: keepFields(formData, ["body", "occurredOn", "atTime"]) };
  }

  // Who it was with, for the calendar's title: the first contact, or
  // the company.
  const contactIds = targets.rows.map((row) => row.contactId).filter((id): id is string => Boolean(id));
  const companyId = targets.rows[0]?.companyId ?? null;
  const named = contactIds.length
    ? await prisma.contact.findFirst({ where: { id: contactIds[0], organizationId }, select: { name: true, companyId: true } })
    : null;
  const company = companyId
    ? await prisma.company.findFirst({ where: { id: companyId, organizationId }, select: { name: true } })
    : null;
  const primaryName = named?.name ?? company?.name ?? "";
  // Every save gets one, so Undo can find exactly what it wrote.
  const batchId = newBatchId();
  const who = { organizationId, userId, batchId };

  if (on > today) {
    const scheduledId = await scheduleActivityEvent({
      organizationId,
      userId,
      type,
      body,
      startOn: on,
      startTime: atTime,
      contactIds,
      companyId: companyId ?? named?.companyId ?? null,
      primaryName,
      batchId,
    });
    // Booking a meeting is what sets it, whenever it is for.
    let opportunityId: string | null = null;
    if (type === "MEETING") {
      opportunityId = await markMeetingSet(who, contactIds, new Date(), {
        on: atTime ? zonedMoment(on, atTime, timeZone) : zonedNoon(on, timeZone),
        eventId: scheduledId,
      });
    }
    revalidateTarget(targets.primary);
    revalidatePath("/dashboard/calendar");
    if (opportunityId) revalidatePath("/dashboard/deals");
    return { success: `Scheduled for ${formatDay(`${on}T12:00:00Z`)} — it's on the calendar`, batchId, opportunityId };
  }

  const plan = planNextStep(next, today);
  if (plan && "error" in plan) return { error: plan.error, kept: keepFields(formData, ["body", "occurredOn", "atTime"]) };

  // The moment it happened: the time typed, or now if it was today, or
  // midday on the day it was. In the workspace's clock, like every
  // other stamp in the app.
  const occurredAt = atTime ? zonedMoment(on, atTime, timeZone) : on === today ? new Date() : zonedNoon(on, timeZone);

  const rows = await prisma.$transaction(
    targets.rows.map((row) =>
      prisma.activity.create({
        data: {
          organizationId,
          contactId: row.contactId,
          companyId: row.companyId,
          userId,
          type,
          outcome,
          body,
          batchId,
          occurredAt,
        },
        select: { id: true },
      }),
    ),
  );

  // A meeting logged on the day one was booked with them is that meeting:
  // its calendar entry is ticked done with this line (as the Done box
  // does) rather than a copy written beside it, so the booked meeting is
  // never left asking "how did it go?" next to a second one.
  const booked =
    type === "MEETING" && outcome !== "NO_SHOW" && contactIds.length
      ? await prisma.calendarEvent.findFirst({
          where: {
            organizationId,
            activityId: null,
            auto: false,
            type: { equals: ACTIVITY_EVENT_TYPE.MEETING, mode: "insensitive" },
            startOn: isoToDate(on)!,
            OR: [{ contactId: { in: contactIds } }, { attendees: { some: { id: { in: contactIds } } } }],
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, doneAt: true },
        })
      : null;
  if (booked) {
    await prisma.calendarEvent.updateMany({
      where: { id: booked.id, organizationId, activityId: null },
      data: { activityId: rows[0].id, doneAt: booked.doneAt ?? occurredAt },
    });
  } else {
    await recordActivityEvent({
      organizationId,
      userId,
      activityId: rows[0].id,
      type,
      body,
      occurredAt,
      withTime: Boolean(atTime) || on === today,
      contactIds,
      companyId: companyId ?? named?.companyId ?? null,
      primaryName,
      batchId,
    });
  }

  // The ladder: a touch that happened makes Not Actioned into Contacted
  // (a no-show is not a touch); a talk, a reply or a held meeting into
  // Connected; a meeting that happened was, at the latest, set that day,
  // and one held completes it.
  const notices: string[] = [];
  let opportunityId: string | null = null;
  if (outcome !== "NO_SHOW") await markContacted(who, { contactIds, companyId }, occurredAt);
  if (outcome && CONNECT_OUTCOMES.includes(outcome) && occurredAt <= new Date()) {
    await markConnected(who, { contactIds, companyId }, occurredAt);
  }
  if (type === "MEETING" && outcome !== "NO_SHOW") {
    opportunityId = await markMeetingSet(who, contactIds, occurredAt, { activityId: rows[0].id, eventId: booked?.id ?? null });
    if (outcome === "HELD") {
      const meetingId = await meetingFor(organizationId, opportunityId, rows[0].id);
      if (meetingId) await recordMeetingHeld(who, meetingId, { early: true });
    }
  }
  if (mark) await markByHand(who, { contactIds, companyId }, mark, occurredAt, reason);

  const excerpt = body.length > 140 ? `${body.slice(0, 140).trimEnd()}…` : body;
  const about = `Follow up on the ${ACTIVITY_LABELS[type].toLowerCase()} logged ${formatDay(`${on}T12:00:00Z`)}: ${excerpt}`;
  if (plan && plan.kind === "meeting") {
    const booked = await bookMeetingCore(who, {
      contactIds: Array.from(new Set([...contactIds, ...plan.withContactIds])),
      companyId: companyId ?? named?.companyId ?? null,
      on: plan.on,
      time: plan.time,
      where: plan.where,
      note: plan.note,
      opportunity: plan.opportunity,
    });
    if ("error" in booked) notices.push(booked.error ?? "The meeting couldn't be booked");
    else {
      notices.push(booked.message);
      opportunityId = booked.opportunityId ?? opportunityId;
    }
  } else if (plan) {
    const step = await writeNextStep({
      organizationId,
      userId,
      batchId,
      plan,
      contactIds,
      companyId: companyId ?? named?.companyId ?? null,
      primaryName,
      about,
    });
    notices.push(step.words);
  }

  revalidateTarget(targets.primary);
  revalidatePath("/dashboard/calendar");
  if (opportunityId) revalidatePath("/dashboard/deals");
  const others = targets.rows.length - 1;

  // Handed back so the form can ask "Want to set a follow-up?" about
  // exactly this touch, with the same people on it — unless the next step
  // was already picked in this save.
  const followUp: FollowUpSeed | undefined = next
    ? undefined
    : { contactIds, companyId: companyId ?? named?.companyId ?? null, primaryName, about };
  return {
    success: [others > 0 ? `Logged on ${others + 1} contacts` : "Activity logged", ...notices].join(" · "),
    followUp,
    batchId,
    notices,
    opportunityId,
  };
}

// The follow-ups ticked in the box that opens after a touch is logged
// (Oct 4, 2026): one open calendar entry per thing ticked, on the day
// picked, with the same people as the touch and under whoever logged it.
// The seed came from logActivity a moment ago, but it has been through
// the browser since, so every id in it is checked against this workspace
// and the name is read back from the record rather than trusted.
// A Meeting ticked is "Try to book a meeting" since Nov 11, 2026
// (decision 5, replacing the Oct 4 rule): a reminder call on that day
// that moves no status; booking is bookMeeting / next=meeting. Passing the
// log's `batchId` puts the follow-ups in that save, so its Undo takes them.
export async function scheduleFollowUps(seed: FollowUpSeed, items: unknown, batchId?: string): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = z
    .object({
      seed: z.object({
        contactIds: z.array(idSchema).max(500),
        companyId: z.string().trim().min(1).nullable(),
        about: z.string().trim().max(5000),
      }),
      items: z
        .array(
          z.object({
            type: activityTypeSchema,
            on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day for each follow-up"),
            time: z.string().optional(),
          }),
        )
        .min(1, "Tick at least one follow-up")
        .max(ACTIVITY_TYPES.length),
      batchId: z.string().trim().min(1).max(200).optional(),
    })
    .safeParse({ seed, items, batchId });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the follow-ups and try again" };

  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  for (const item of parsed.data.items) {
    if (!isRealDay(item.on)) return { error: "That day isn't a real date" };
    if (item.on < today) return { error: `A follow-up has to be today or later (${ACTIVITY_LABELS[item.type]} is dated ${formatDay(`${item.on}T12:00:00Z`)})` };
  }
  // One entry per kind: the chips are a multi-select, not a counter.
  const seen = new Set<string>();
  const picks = parsed.data.items.filter((item) => {
    if (seen.has(item.type)) return false;
    seen.add(item.type);
    return true;
  });

  // Only this workspace's people, in the order they were logged so the
  // first stays the one the entry is with.
  const owned = parsed.data.seed.contactIds.length
    ? await prisma.contact.findMany({
        where: { id: { in: parsed.data.seed.contactIds }, organizationId },
        select: { id: true, name: true, companyId: true },
      })
    : [];
  const byId = new Map(owned.map((row) => [row.id, row]));
  const contactIds = parsed.data.seed.contactIds.filter((id) => byId.has(id));
  const company = parsed.data.seed.companyId
    ? await prisma.company.findFirst({ where: { id: parsed.data.seed.companyId, organizationId }, select: { id: true, name: true } })
    : null;
  if (!contactIds.length && !company) return { error: "Record not found" };
  const first = contactIds.length ? byId.get(contactIds[0]) : undefined;
  const primaryName = first?.name ?? company?.name ?? "";
  // Only a save of this person's in this workspace.
  const save = parsed.data.batchId
    ? await prisma.activity.findFirst({ where: { organizationId, userId, batchId: parsed.data.batchId }, select: { id: true } })
    : null;

  await scheduleFollowUpEvents({
    organizationId,
    userId,
    items: picks.map((item) =>
      item.type === "MEETING"
        ? { type: "PHONE_CALL" as const, startOn: item.on, startTime: cleanTime(item.time), title: `Try to book a meeting · ${primaryName}` }
        : { type: item.type, startOn: item.on, startTime: cleanTime(item.time) },
    ),
    contactIds,
    companyId: company?.id ?? first?.companyId ?? null,
    primaryName,
    about: parsed.data.seed.about,
    batchId: save ? parsed.data.batchId : null,
  });

  for (const id of contactIds) revalidatePath(`/dashboard/contacts/${id}`);
  const companyPath = company?.id ?? first?.companyId;
  if (companyPath) revalidatePath(`/dashboard/companies/${companyPath}`);
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard");

  const soonest = picks.map((item) => item.on).sort()[0];
  const name = (type: string) => (type === "MEETING" ? "“Try to book a meeting”" : `${ACTIVITY_LABELS[type as keyof typeof ACTIVITY_LABELS]} follow-up`);
  return {
    success:
      picks.length === 1
        ? `${name(picks[0].type)} on the calendar for ${formatDay(`${soonest}T12:00:00Z`)}`
        : `${picks.length} follow-ups on the calendar, the first ${formatDay(`${soonest}T12:00:00Z`)}`,
  };
}

const bookSchema = z.object({
  contactId: idSchema,
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day of the meeting"),
  time: z.string().max(8).optional(),
  withContactIds: z.array(idSchema).max(50).default([]),
  where: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  // "auto" (default): an open opportunity any of them is on; "new"; or an
  // open opportunity's id (from bookingOptions).
  opportunity: z.string().trim().max(100).optional(),
});

// The Book meeting sheet (R4): "Meeting · <name>" on the calendar, Meeting
// Set (through Connected from below it), the opportunity, and the booker
// kept on the meeting — the same path as every meeting. Today or later.
export async function bookMeeting(
  input: z.input<typeof bookSchema>,
): Promise<ActionState & { batchId?: string; opportunityId?: string | null; eventId?: string }> {
  const { organizationId, userId } = await requireSession();
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the meeting and try again" };
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  if (!isRealDay(parsed.data.on)) return { error: "That day isn't a real date" };
  if (parsed.data.on < today) return { error: "Pick today or a day ahead. A meeting that already happened is logged with How did it go?" };
  const contact = await prisma.contact.findFirst({ where: { id: parsed.data.contactId, organizationId }, select: { id: true, companyId: true } });
  if (!contact) return { error: "Contact not found" };
  const batchId = newBatchId();
  const booked = await bookMeetingCore(
    { organizationId, userId, batchId },
    {
      contactIds: Array.from(new Set([contact.id, ...parsed.data.withContactIds])),
      companyId: contact.companyId,
      on: parsed.data.on,
      time: cleanTime(parsed.data.time),
      where: parsed.data.where,
      note: parsed.data.note,
      opportunity: parsed.data.opportunity,
    },
  );
  if ("error" in booked) return { error: booked.error };
  revalidatePath(`/dashboard/contacts/${contact.id}`);
  if (contact.companyId) revalidatePath(`/dashboard/companies/${contact.companyId}`);
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  return { success: booked.message, batchId, opportunityId: booked.opportunityId, eventId: booked.eventId };
}

// What the Book meeting sheet offers: the other people at the person's
// company (for "Who else"), and the company's open opportunities (for "Add
// to the open Ironwood opportunity with Chase?"), each with its Primary.
export async function bookingOptions(contactId: string): Promise<
  | {
      people: { id: string; name: string; title: string | null }[];
      opportunities: { id: string; title: string; primaryName: string | null; ownerName: string | null; includesThem: boolean }[];
    }
  | { error: string }
> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contactId);
  if (!id.success) return { error: "Missing contact reference" };
  const contact = await prisma.contact.findFirst({ where: { id: id.data, organizationId }, select: { id: true, companyId: true } });
  if (!contact) return { error: "Contact not found" };
  const people = contact.companyId
    ? await prisma.contact.findMany({
        where: { organizationId, companyId: contact.companyId, id: { not: contact.id }, status: { not: "ARCHIVED" } },
        orderBy: [{ favorite: "desc" }, { name: "asc" }],
        select: { id: true, name: true, title: true },
        take: 30,
      })
    : [];
  const opportunities = await prisma.opportunity.findMany({
    where: {
      organizationId,
      ...OPEN_OPPORTUNITY,
      contacts: {
        some: contact.companyId
          ? { OR: [{ contactId: contact.id }, { contact: { companyId: contact.companyId } }] }
          : { contactId: contact.id },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: {
      id: true,
      title: true,
      owner: { select: { name: true } },
      contacts: { select: { contactId: true, role: true, contact: { select: { name: true } } } },
    },
  });
  return {
    people,
    opportunities: opportunities.map((row) => ({
      id: row.id,
      title: row.title,
      primaryName: row.contacts.find((person) => person.role === "PRIMARY")?.contact.name ?? null,
      ownerName: row.owner?.name ?? null,
      includesThem: row.contacts.some((person) => person.contactId === contact.id),
    })),
  };
}

// "Saved · Undo" and Delete on your own line (Nov 11, 2026): takes one
// save back in a single transaction — its activity rows, the calendar
// copy, follow-ups and meetings booked in the same save, and the status
// changes it made (statuses go back while still where it left them). See
// undoLogCore in src/lib/undo-log.ts. Only whoever logged it, or an Owner
// or Admin.
export async function undoLog(batchId: string): Promise<ActionState> {
  const session = await requireAdminSession();
  const parsed = z.string().trim().min(1).max(200).safeParse(batchId);
  if (!parsed.success) return { error: "Nothing to undo" };
  const result = await undoLogCore(session.organizationId, parsed.data, { userId: session.userId, canManage: session.allowed });
  if ("error" in result) return { error: result.error };
  for (const id of result.contactIds) revalidatePath(`/dashboard/contacts/${id}`);
  for (const id of result.companyIds) revalidatePath(`/dashboard/companies/${id}`);
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  return { success: "Undone" };
}

export async function createDealForContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = parseForm(
    z.object({
      contactId: idSchema,
      title: z.string().trim().min(1, "Deal title is required").max(160),
    }),
    { contactId: formData.get("contactId"), title: formData.get("title") },
  );
  if (!parsed.ok) return { error: parsed.error };

  if (!(await assertContact(parsed.data.contactId, organizationId))) {
    return { error: "Contact not found" };
  }

  const deal = await prisma.deal.create({
    data: {
      organizationId,
      contactId: parsed.data.contactId,
      title: parsed.data.title,
      valueCents: dollarsToCents(formData.get("value")),
      ownerId: userId,
    },
    select: { id: true },
  });
  await ensureOpportunityForDeal({ organizationId, userId }, deal.id);

  revalidatePath(`/dashboard/contacts/${parsed.data.contactId}`);
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  return { success: "Deal added" };
}
