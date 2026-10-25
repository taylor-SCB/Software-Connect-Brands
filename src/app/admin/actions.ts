"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/session";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { keepFields, optionalText, parseForm, type ActionState } from "@/lib/forms";
import { normalizeEmail } from "@/lib/login-user";
import { createInviteLink, INVITE_TTL_DAYS } from "@/lib/password-reset";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/email-marketing";
import { createWorkspace } from "@/lib/workspaces";

const decisionSchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(["ACTIVE", "PAUSED", "REJECTED"]),
});

export async function setOrganizationStatus(formData: FormData) {
  // Every action re-checks operator access on the server. The buttons are
  // only rendered for an operator, but a hidden button is not a permission
  // check — a form post is trivial to replay.
  await requireSuperAdmin();

  const parsed = decisionSchema.safeParse({
    organizationId: formData.get("organizationId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return;

  await prisma.organization.update({
    where: { id: parsed.data.organizationId },
    data: { status: parsed.data.status, reviewedAt: new Date() },
  });

  revalidatePath("/admin");
}

export async function deleteOrganization(formData: FormData) {
  await requireSuperAdmin();

  const organizationId = String(formData.get("organizationId") ?? "");
  const confirmName = String(formData.get("confirmName") ?? "").trim();
  if (!organizationId) return;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (!organization) return;

  // Deleting cascades to every contact, quote and signed contract the
  // business has. Typing the name is the only thing standing between a
  // misplaced click and unrecoverable customer data.
  if (confirmName !== organization.name) return;

  await prisma.organization.delete({ where: { id: organizationId } });
  revalidatePath("/admin");
}

// A declined ratesheet import, dealt with: the reader was fixed for that
// kind of sheet, or there was nothing to fix. Reopening puts it back.
export async function setRatesheetIssueResolved(formData: FormData) {
  await requireSuperAdmin();
  const id = z.string().min(1).safeParse(formData.get("issueId"));
  if (!id.success) return;
  const resolved = formData.get("resolved") === "1";
  await prisma.ratesheetImportIssue.updateMany({
    where: { id: id.data },
    data: { resolvedAt: resolved ? new Date() : null },
  });
  revalidatePath("/admin");
}

// ---------------------------------------------------------------------------
// Create Account (Release 2, Oct 25, 2026): the operator sets a customer up
// themselves. The workspace opens already approved and the owner gets an
// email with a link to set their own password — the operator never knows
// it. Same link as a Company Users invitation: one use, seven days.
// ---------------------------------------------------------------------------

// Line breaks and runs of spaces in a typed name come out: it goes in an
// email subject and on every document the workspace prints.
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

const createSchema = z.object({
  companyName: z.string().transform(oneLine).pipe(z.string().min(2, "Type the company's name").max(120, "That company name is too long")),
  accountType: z.enum(ACCOUNT_TYPES, { message: "Pick the account type" }),
  firstName: z.string().transform(oneLine).pipe(z.string().min(1, "Type the owner's first name").max(60, "That first name is too long")),
  lastName: z.string().transform(oneLine).pipe(z.string().min(1, "Type the owner's last name").max(60, "That last name is too long")),
  email: z.string().trim().max(200, "That email is too long").pipe(z.email("Enter a valid email address")),
  phone: z.string().trim().max(40, "That phone number is too long").optional(),
  // Shown beside a supplier's name in other workspaces' pickers.
  city: z.string().transform(oneLine).pipe(z.string().max(80, "That city is too long")).optional(),
  state: z.string().transform(oneLine).pipe(z.string().max(40, "That state is too long")).optional(),
});

// Sent as the platform, not as the workspace: nobody at the new company
// has set anything up yet, and the person who did is us.
async function sendAccountReady(input: {
  companyName: string;
  ownerName: string;
  email: string;
  token: string;
  operator: { name: string; email: string };
}) {
  const url = await absoluteUrl(`/reset-password/${input.token}`);
  const loginUrl = await absoluteUrl("/login");
  const firstName = input.ownerName.split(" ")[0] || "there";
  return sendEmail({
    to: input.email,
    fromName: "Software Connect Brands",
    replyTo: input.operator.email,
    subject: `Your ${input.companyName} account is ready`,
    text: [
      `Hi ${firstName},`,
      "",
      `${input.operator.name} set up the ${input.companyName} account for you on Software Connect Brands.`,
      "Open this link to set your password and log in:",
      "",
      url,
      "",
      `The link lasts ${INVITE_TTL_DAYS} days and can only be used once. After that, log in any time at ${loginUrl}`,
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(firstName)},</p>`,
      `<p>${escapeHtml(input.operator.name)} set up the ${escapeHtml(input.companyName)} account for you on Software Connect Brands.</p>`,
      `<p><a href="${url}">Set your password</a></p>`,
      `<p>The link lasts ${INVITE_TTL_DAYS} days and can only be used once. After that, log in any time at <a href="${loginUrl}">${escapeHtml(loginUrl)}</a>.</p>`,
    ].join("\n"),
  });
}

export async function createAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kept = keepFields(formData, ["companyName", "accountType", "firstName", "lastName", "email", "phone", "city", "state"]);
  const operator = await requireSuperAdmin();

  const parsed = parseForm(createSchema, {
    companyName: formData.get("companyName") ?? "",
    accountType: formData.get("accountType"),
    firstName: formData.get("firstName") ?? "",
    lastName: formData.get("lastName") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? undefined,
    city: formData.get("city") ?? undefined,
    state: formData.get("state") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error, kept };

  // Said before anything is made: an account nobody can get into is worse
  // than no account.
  if (!isEmailConfigured()) {
    return { error: "Email isn't switched on for this site, so the set-password link can't be sent. Nothing was created.", kept };
  }

  const email = normalizeEmail(parsed.data.email);
  const existing = await prisma.$queryRaw<{ organizationName: string }[]>`
    SELECT o."name" AS "organizationName" FROM "User" u JOIN "Organization" o ON o."id" = u."organizationId"
     WHERE lower(u."email") = lower(${email}) LIMIT 1`;
  if (existing.length > 0) {
    return { error: `That email already has a login, on ${existing[0].organizationName}.`, kept };
  }

  const ownerName = `${parsed.data.firstName} ${parsed.data.lastName}`;
  const created = await createWorkspace({
    companyName: parsed.data.companyName,
    accountType: parsed.data.accountType,
    status: "ACTIVE",
    createdById: operator.userId,
    city: parsed.data.city || null,
    state: parsed.data.state || null,
    owner: {
      name: ownerName,
      email,
      phone: optionalText(parsed.data.phone ?? null),
      // A random password nobody knows. The owner sets their own from the
      // link; until then there is no way in.
      passwordHash: await bcrypt.hash(randomBytes(32).toString("base64url"), 10),
    },
  });
  if (!created.ok) {
    return {
      error:
        created.reason === "email"
          ? "That email already has a login."
          : "Could not create that workspace. Try a slightly different company name.",
      kept,
    };
  }

  const token = await createInviteLink(created.ownerId);
  const sent = await sendAccountReady({
    companyName: parsed.data.companyName,
    ownerName,
    email,
    token,
    operator,
  });

  revalidatePath("/admin");
  if (!sent.ok) {
    console.error("[create account] email failed:", sent.error);
    return { error: `${parsed.data.companyName} was created, but the email didn't go out. Use Resend invite on its row.` };
  }
  return { success: `${parsed.data.companyName} is ready. A set-password link went to ${email}.` };
}

// A fresh link for the owner of an account the operator made, while they
// have never logged in. Every earlier link for them stops working. Not
// offered for a signup: they chose their own password when they applied.
export async function resendOwnerInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const operator = await requireSuperAdmin();
  const organizationId = z.string().min(1).safeParse(formData.get("organizationId"));
  if (!organizationId.success) return { error: "That workspace no longer exists." };

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId.data },
    select: {
      name: true,
      createdById: true,
      users: {
        where: { role: "OWNER", removedAt: null },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, name: true, email: true, lastLoginAt: true },
      },
    },
  });
  if (!organization) return { error: "That workspace no longer exists." };
  const owner = organization.users[0];
  if (!organization.createdById || !owner) return { error: "This workspace's owner set their own password at signup." };
  if (owner.lastLoginAt) return { error: `${owner.name} has already logged in. If they've lost the password, Forgot password on the login page sends a new link.` };
  if (!isEmailConfigured()) return { error: "Email isn't switched on for this site." };

  const token = await createInviteLink(owner.id);
  const sent = await sendAccountReady({
    companyName: organization.name,
    ownerName: owner.name,
    email: owner.email,
    token,
    operator,
  });
  if (!sent.ok) {
    console.error("[resend owner invite] email failed:", sent.error);
    return { error: "The email didn't go out. Try again in a minute." };
  }
  revalidatePath("/admin");
  return { success: `New link sent to ${owner.email}.` };
}

// The operator sets a workspace's type straight away — theirs too, to see
// the app the way each type does.
export async function setOrganizationType(formData: FormData) {
  const operator = await requireSuperAdmin();
  const parsed = z
    .object({ organizationId: z.string().min(1), accountType: z.enum(ACCOUNT_TYPES) })
    .safeParse({ organizationId: formData.get("organizationId"), accountType: formData.get("accountType") });
  if (!parsed.success) return;

  // A request waiting from that workspace is answered by this too:
  // approved when it asked for this type, declined when it asked for
  // another — left open, a later Approve would quietly undo this change.
  const decided = { openFor: null, decidedAt: new Date(), decidedById: operator.userId };
  await prisma.$transaction([
    prisma.organization.updateMany({
      where: { id: parsed.data.organizationId },
      data: { accountType: parsed.data.accountType },
    }),
    prisma.accountTypeRequest.updateMany({
      where: { organizationId: parsed.data.organizationId, status: "PENDING", toType: parsed.data.accountType },
      data: { status: "APPROVED", ...decided },
    }),
    prisma.accountTypeRequest.updateMany({
      where: { organizationId: parsed.data.organizationId, status: "PENDING", toType: { not: parsed.data.accountType } },
      data: { status: "DECLINED", ...decided },
    }),
  ]);
  revalidatePath("/admin");
}

// Approve or decline a workspace's request to change its type. The
// request is claimed while still PENDING, so a double click, or a cancel
// from the workspace racing the approval, settles it exactly once.
export async function decideAccountTypeRequest(formData: FormData) {
  const operator = await requireSuperAdmin();
  const parsed = z
    .object({ requestId: z.string().min(1), decision: z.enum(["APPROVED", "DECLINED"]) })
    .safeParse({ requestId: formData.get("requestId"), decision: formData.get("decision") });
  if (!parsed.success) return;

  await prisma.$transaction(async (tx) => {
    const request = await tx.accountTypeRequest.findUnique({
      where: { id: parsed.data.requestId },
      select: { organizationId: true, toType: true },
    });
    if (!request) return;
    const claimed = await tx.accountTypeRequest.updateMany({
      where: { id: parsed.data.requestId, status: "PENDING" },
      data: { status: parsed.data.decision, openFor: null, decidedAt: new Date(), decidedById: operator.userId },
    });
    if (claimed.count !== 1 || parsed.data.decision !== "APPROVED") return;
    await tx.organization.update({
      where: { id: request.organizationId },
      data: { accountType: request.toType },
    });
  });
  revalidatePath("/admin");
}
