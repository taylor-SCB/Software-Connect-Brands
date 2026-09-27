import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { publicToken } from "@/lib/tokens";
import { todayIso } from "@/lib/payments";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/app-url";
import {
  DAILY_EMAIL_LIMIT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  fillEmailFields,
} from "@/lib/email-fields";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A PENDING row older than this is a send that died mid-flight (a
// timeout, a redeploy). It stops holding a slot so the day's allowance
// is not eaten by something that never went out.
const PENDING_HOLD_MS = 15 * 60 * 1000;

function dayIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * How many emails this person has used today, in the workspace's zone.
 * Rows from the last 26 hours are read and bucketed by their local day,
 * which is simpler and safer than working out when midnight was in a
 * zone with a daylight-saving change in it. `db` lets the send count
 * inside its locking transaction.
 */
export async function sentToday(
  userId: string,
  timeZone: string,
  db: Pick<typeof prisma, "emailSend"> = prisma,
) {
  const now = Date.now();
  const rows = await db.emailSend.findMany({
    where: {
      userId,
      createdAt: { gte: new Date(now - 26 * 60 * 60 * 1000) },
      OR: [{ status: "SENT" }, { status: "PENDING", createdAt: { gte: new Date(now - PENDING_HOLD_MS) } }],
    },
    select: { createdAt: true },
  });
  const today = todayIso(timeZone);
  return rows.filter((row) => dayIn(row.createdAt, timeZone) === today).length;
}

/** The business's mailing address as one line, or null when it is incomplete. */
export function mailingAddress(org: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}) {
  if (!org.addressLine1 || !org.city || !org.state) return null;
  const street = [org.addressLine1, org.addressLine2].filter(Boolean).join(", ");
  return `${street}, ${org.city}, ${org.state}${org.postalCode ? ` ${org.postalCode}` : ""}`;
}

const ORG_SELECT = {
  name: true,
  timeZone: true,
  phone: true,
  website: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
} as const;

// What the composer needs to open: the counter, the templates and files
// to offer, and anything that stops a send before it starts.
export async function loadComposerSetup(organizationId: string, userId: string) {
  const [org, templates, files] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: ORG_SELECT }),
    prisma.marketingTemplate.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, subject: true, body: true },
    }),
    prisma.upload.findMany({
      where: { organizationId, kind: "MARKETING" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, fileName: true, sizeBytes: true },
    }),
  ]);
  const used = await sentToday(userId, org.timeZone);

  let blocker: string | null = null;
  if (!isEmailConfigured()) blocker = "Email isn't switched on for this site yet.";
  else if (!mailingAddress(org)) {
    blocker =
      "Add your business address in Settings → Company Information → General first. The law requires it at the foot of every marketing email.";
  }

  return { used, limit: DAILY_EMAIL_LIMIT, templates, files, blocker };
}

export type ComposerSetup = Awaited<ReturnType<typeof loadComposerSetup>>;

export type SendRequest = {
  contactIds: string[];
  subject: string;
  body: string;
  templateId: string | null;
  fileIds: string[];
};

export type SendOutcome =
  | { ok: false; error: string; used: number; limit: number }
  | {
      ok: true;
      sent: number;
      failed: { name: string; error: string }[];
      skipped: { name: string; reason: string }[];
      used: number;
      limit: number;
    };

function renderHtml(body: string, footer: { business: string; address: string; unsubscribeUrl: string }) {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2328;max-width:600px">`,
    paragraphs,
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">`,
    `<p style="margin:0;font-size:12px;color:#6b7280">${escapeHtml(footer.business)} · ${escapeHtml(footer.address)}</p>`,
    `<p style="margin:4px 0 0;font-size:12px;color:#6b7280"><a href="${footer.unsubscribeUrl}" style="color:#6b7280">Unsubscribe</a> from emails from ${escapeHtml(footer.business)}.</p>`,
    `</div>`,
  ].join("\n");
}

// The provider allows a couple of calls a second on the starter plan.
// One email per recipient, spaced out, stays under it; a 429 gets one
// polite retry.
const SEND_SPACING_MS = 550;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send one email to each contact, individually addressed, and log it on
 * their Activity. The whole batch is refused up front if it would go past
 * today's allowance — half a mailing is harder to reason about than none.
 */
export async function sendMarketingEmails(
  session: { organizationId: string; userId: string },
  request: SendRequest,
): Promise<SendOutcome> {
  const { organizationId, userId } = session;
  const [org, sender] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: ORG_SELECT }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, title: true, email: true, phone: true },
    }),
  ]);
  const limit = DAILY_EMAIL_LIMIT;
  const refuse = async (error: string): Promise<SendOutcome> => ({
    ok: false,
    error,
    used: await sentToday(userId, org.timeZone),
    limit,
  });

  if (!isEmailConfigured()) return refuse("Email isn't switched on for this site yet.");
  const address = mailingAddress(org);
  if (!address) {
    return refuse("Add your business address in Settings → Company Information → General before sending.");
  }

  const subject = request.subject.trim();
  const body = request.body.replace(/\r\n?/g, "\n").trim();
  if (!subject) return refuse("Add a subject.");
  if (!body) return refuse("Write a message, or pick a template.");
  if (subject.length > 200) return refuse("Keep the subject under 200 characters.");
  if (body.length > 20_000) return refuse("That message is too long to send.");

  const contactIds = [...new Set(request.contactIds)];
  if (contactIds.length === 0) return refuse("Pick at least one contact.");
  if (contactIds.length > limit) return refuse(`You can send to at most ${limit} people a day.`);

  const fileIds = [...new Set(request.fileIds)];
  if (fileIds.length > MAX_ATTACHMENTS) return refuse(`Attach at most ${MAX_ATTACHMENTS} files.`);

  const [contacts, files, template] = await Promise.all([
    prisma.contact.findMany({
      where: { organizationId, id: { in: contactIds } },
      select: { id: true, name: true, email: true, emailOptOutAt: true, company: { select: { name: true } } },
    }),
    fileIds.length
      ? prisma.upload.findMany({
          where: { organizationId, kind: "MARKETING", id: { in: fileIds } },
          select: { id: true, fileName: true, data: true, sizeBytes: true },
        })
      : Promise.resolve([]),
    request.templateId
      ? prisma.marketingTemplate.findFirst({ where: { id: request.templateId, organizationId }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  if (files.length !== fileIds.length) return refuse("One of those files has been deleted. Pick the files again.");
  if (files.reduce((sum, file) => sum + file.sizeBytes, 0) > MAX_ATTACHMENT_BYTES) {
    return refuse("Those files add up to more than 10 MB. Attach fewer.");
  }

  const skipped: { name: string; reason: string }[] = [];
  const eligible = contacts.filter((contact) => {
    const email = contact.email?.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push({ name: contact.name, reason: "no email address" });
      return false;
    }
    if (contact.emailOptOutAt) {
      skipped.push({ name: contact.name, reason: "unsubscribed" });
      return false;
    }
    return true;
  });
  if (eligible.length === 0) {
    return refuse(
      skipped.length === 1
        ? `${skipped[0].name} can't be emailed (${skipped[0].reason}).`
        : "None of those contacts can be emailed: each one has no address or has unsubscribed.",
    );
  }

  // Hold the slots. Locking the sender's row makes two sends from two
  // tabs take turns, so both cannot read "38 used" and each send three.
  const attachmentNames = files.map((file) => file.fileName);
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const used = await sentToday(userId, org.timeZone, tx);
    if (used + eligible.length > limit) return { used, rows: null };
    const rows = await Promise.all(
      eligible.map((contact) =>
        tx.emailSend.create({
          data: {
            organizationId,
            userId,
            contactId: contact.id,
            templateId: template?.id ?? null,
            toEmail: contact.email!.trim(),
            subject,
            attachmentNames,
            unsubscribeToken: publicToken(),
          },
          select: { id: true, unsubscribeToken: true, contactId: true },
        }),
      ),
    );
    return { used, rows };
  });
  if (!reserved.rows) {
    const left = Math.max(0, limit - reserved.used);
    return {
      ok: false,
      error: `That's ${eligible.length} emails and you have ${left} left today. Pick ${left === 0 ? "again tomorrow" : `${left} or fewer`}.`,
      used: reserved.used,
      limit,
    };
  }

  const attachments = files.map((file) => ({ filename: file.fileName, content: Buffer.from(file.data) }));
  const byContact = new Map(eligible.map((contact) => [contact.id, contact]));
  const batchId = eligible.length > 1 ? randomUUID() : null;
  const failed: { name: string; error: string }[] = [];
  let sent = 0;

  for (const [index, row] of reserved.rows.entries()) {
    const contact = byContact.get(row.contactId!)!;
    const values: Record<string, string> = {
      first_name: contact.name.trim().split(/\s+/)[0] ?? "",
      contact_name: contact.name,
      contact_company: contact.company?.name ?? "",
      sender_name: sender.name,
      sender_title: sender.title ?? "",
      sender_email: sender.email,
      sender_phone: sender.phone ?? "",
      business_name: org.name,
      business_phone: org.phone ?? "",
      business_website: org.website ?? "",
    };
    const filledSubject = fillEmailFields(subject, values).replace(/\s+/g, " ").trim();
    const filledBody = fillEmailFields(body, values);
    const unsubscribeUrl = await absoluteUrl(`/u/${row.unsubscribeToken}`);

    const message = {
      to: contact.email!.trim(),
      fromName: org.name,
      replyTo: sender.email,
      subject: filledSubject,
      text: `${filledBody.trim()}\n\n--\n${org.name} · ${address}\nUnsubscribe: ${unsubscribeUrl}`,
      html: renderHtml(filledBody, { business: org.name, address, unsubscribeUrl }),
      attachments,
      // Lets Gmail and Apple Mail show their own Unsubscribe button, which
      // posts straight to us without the person opening the page.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}/one-click>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };

    if (index > 0) await sleep(SEND_SPACING_MS);
    let result = await sendEmail(message);
    if (!result.ok && /\b429\b/.test(result.error)) {
      await sleep(1500);
      result = await sendEmail(message);
    }

    if (result.ok) {
      sent += 1;
      await prisma.$transaction([
        prisma.emailSend.update({ where: { id: row.id }, data: { status: "SENT", providerId: result.id || null } }),
        prisma.activity.create({
          data: {
            organizationId,
            contactId: contact.id,
            userId,
            type: "EMAIL",
            body: `Emailed “${filledSubject}”${attachmentNames.length ? ` with ${attachmentNames.join(", ")}` : ""}`,
            batchId,
          },
        }),
      ]);
    } else {
      console.error("[marketing email] send failed:", result.error);
      failed.push({ name: contact.name, error: "the email service refused it" });
      await prisma.emailSend.update({
        where: { id: row.id },
        data: { status: "FAILED", error: result.error.slice(0, 1000) },
      });
    }
  }

  return { ok: true, sent, failed, skipped, used: await sentToday(userId, org.timeZone), limit };
}
