"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, type ActionState } from "@/lib/forms";
import { dollarsToCents } from "@/lib/format";
import { CHANNEL_LABELS, START_STATUSES } from "@/lib/constants";
import { findOrCreateCompany, normalizeState } from "@/lib/companies";
import { ensureIndustryOptions, mergeTags, readIndustryFields } from "@/lib/industries";
import { sameTags, withoutAuto } from "@/lib/enrich";
import { moneyHold, moneyHoldMessage, zonedNoon } from "@/lib/money";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { cleanTime, isRealDay } from "@/lib/calendar";
import { recordActivityEvent, scheduleActivityEvent, zonedMoment } from "@/lib/calendar-auto";
import { markContacted, markMeetingSet } from "@/lib/status";
import { formatDay } from "@/lib/format";
import {
  targetSchema,
  readTarget,
  resolveTargets,
  noteBodySchema,
  noteLabelSchema,
  activityTypeSchema,
  activityBodySchema,
} from "@/lib/logging";

import { hasFile, imageProblem, removeImage, replaceImage } from "@/lib/uploads";

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
    ? (picked ?? (await findOrCreateCompany(parsed.companyName, organizationId))).id
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
    website: normalizeWebsite(parsed.website || null),
    city: parsed.city || null,
    state: normalizeState(parsed.state || null),
    birthday: toBirthday(parsed.birthday),
    ...(parsed.status ? { status: parsed.status } : {}),
  };
}

export async function createContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(contactSchema, readContactForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const imageFile = formData.get("imageFile");
  const problem = imageProblem(imageFile);
  if (problem) return { error: problem };

  const contact = await prisma.contact.create({
    data: { organizationId, ...(await contactData(parsed.data, organizationId, formData)) },
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
  const { organizationId } = await requireSession();

  const id = idSchema.safeParse(formData.get("contactId"));
  if (!id.success) return { error: "Missing contact reference" };

  const parsed = parseForm(contactSchema, readContactForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const imageFile = formData.get("imageFile");
  const problem = imageProblem(imageFile);
  if (problem) return { error: problem };

  if (!(await assertContact(id.data, organizationId))) return { error: "Contact not found" };

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
    data: { ...(await contactData(parsed.data, organizationId, formData)), ...image },
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

// Logs a call, text, email or meeting — and puts it on the calendar. The
// "When" on the form defaults to today; a day in the past is logged on
// that day, so a call remembered on Friday lands on Wednesday where it
// happened. A day still ahead is not history yet: it goes on the
// calendar as something to do, and nothing is written to anyone's
// Activity until it has happened.
export async function logActivity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = parseForm(
    z.object({
      target: targetSchema,
      type: activityTypeSchema,
      body: activityBodySchema,
      occurredOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day")]).optional(),
    }),
    {
      target: readTarget(formData),
      type: formData.get("type"),
      body: formData.get("body"),
      occurredOn: formData.get("occurredOn") ?? undefined,
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const targets = await resolveTargets(parsed.data.target, organizationId);
  if (!targets) return { error: "Record not found" };

  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  const on = parsed.data.occurredOn || today;
  if (!isRealDay(on)) return { error: "That day isn't a real date" };
  const atTime = cleanTime(formData.get("atTime"));

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

  if (on > today) {
    await scheduleActivityEvent({
      organizationId,
      userId,
      type: parsed.data.type,
      body: parsed.data.body,
      startOn: on,
      startTime: atTime,
      contactIds,
      companyId: companyId ?? named?.companyId ?? null,
      primaryName,
    });
    // Booking a meeting is what sets it, whenever it is for.
    if (parsed.data.type === "MEETING") await markMeetingSet({ organizationId, userId }, contactIds, new Date());
    revalidateTarget(targets.primary);
    revalidatePath("/dashboard/calendar");
    return { success: `Scheduled for ${formatDay(`${on}T12:00:00Z`)} — it's on the calendar` };
  }

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
          type: parsed.data.type,
          body: parsed.data.body,
          batchId: targets.batchId,
          occurredAt,
        },
        select: { id: true },
      }),
    ),
  );

  await recordActivityEvent({
    organizationId,
    userId,
    activityId: rows[0].id,
    type: parsed.data.type,
    body: parsed.data.body,
    occurredAt,
    withTime: Boolean(atTime) || on === today,
    contactIds,
    companyId: companyId ?? named?.companyId ?? null,
    primaryName,
  });

  // The ladder: a touch that happened makes Not Actioned into Contacted;
  // a meeting that happened was, at the latest, set that day.
  await markContacted({ organizationId, userId }, { contactIds, companyId }, occurredAt);
  if (parsed.data.type === "MEETING") await markMeetingSet({ organizationId, userId }, contactIds, occurredAt);

  revalidateTarget(targets.primary);
  revalidatePath("/dashboard/calendar");
  const others = targets.rows.length - 1;
  return { success: others > 0 ? `Logged on ${others + 1} contacts` : "Activity logged" };
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

  await prisma.deal.create({
    data: {
      organizationId,
      contactId: parsed.data.contactId,
      title: parsed.data.title,
      valueCents: dollarsToCents(formData.get("value")),
      ownerId: userId,
    },
  });

  revalidatePath(`/dashboard/contacts/${parsed.data.contactId}`);
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  return { success: "Deal added" };
}
