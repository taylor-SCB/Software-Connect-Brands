"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/session";
import { keepFields, optionalText, parseForm, type ActionState } from "@/lib/forms";
import { normalizeEmail } from "@/lib/login-user";
import { createInviteLink, INVITE_TTL_DAYS } from "@/lib/password-reset";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/email-marketing";

const PATH = "/dashboard/settings/users";

// Roles an owner or admin can hand out. There is one owner per workspace,
// the person who signed up; making a second is not something a form does.
const ASSIGNABLE = ["ADMIN", "MEMBER"] as const;

const addSchema = z.object({
  name: z.string().trim().min(1, "Enter their name").max(120),
  email: z.string().trim().email("Enter a valid email address").max(200),
  title: z.string().trim().max(120).optional(),
  role: z.enum(ASSIGNABLE, { message: "Pick Admin or Member" }),
});

// The invitation. Sent as the workspace, not as us: the new teammate is
// joining their employer's system, which is the white-labeled product.
async function sendInvite(input: {
  organizationName: string;
  inviterName: string;
  inviterEmail: string;
  name: string;
  email: string;
  token: string;
}) {
  const url = await absoluteUrl(`/reset-password/${input.token}`);
  const firstName = input.name.split(" ")[0] || "there";
  const org = escapeHtml(input.organizationName);
  return sendEmail({
    to: input.email,
    fromName: input.organizationName,
    replyTo: input.inviterEmail,
    subject: `${input.inviterName} added you to ${input.organizationName}`,
    text: [
      `Hi ${firstName},`,
      "",
      `${input.inviterName} added you to the ${input.organizationName} account.`,
      "Open this link to set your password and log in:",
      "",
      url,
      "",
      `The link lasts ${INVITE_TTL_DAYS} days and can only be used once.`,
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(firstName)},</p>`,
      `<p>${escapeHtml(input.inviterName)} added you to the ${org} account.</p>`,
      `<p><a href="${url}">Set your password</a></p>`,
      `<p>The link lasts ${INVITE_TTL_DAYS} days and can only be used once.</p>`,
    ].join("\n"),
  });
}

export async function addUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kept = keepFields(formData, ["name", "email", "title", "role"]);
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only owners and admins can add users.", kept };

  const parsed = parseForm(addSchema, {
    name: formData.get("name"),
    email: formData.get("email"),
    title: formData.get("title") ?? undefined,
    role: formData.get("role"),
  });
  if (!parsed.ok) return { error: parsed.error, kept };

  // Said up front, before anybody is created: an account nobody can get
  // into is worse than no account.
  if (!isEmailConfigured()) {
    return { error: "Email isn't switched on for this site, so the invitation can't be sent.", kept };
  }

  const email = normalizeEmail(parsed.data.email);
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, organizationId: true, removedAt: true },
  });

  let userId: string;
  if (existing && existing.organizationId === session.organizationId && existing.removedAt) {
    // Someone who was taken off and is coming back. Same row, so their
    // old notes and activity are theirs again.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name,
        title: optionalText(parsed.data.title ?? null),
        role: parsed.data.role,
        removedAt: null,
      },
    });
    userId = existing.id;
  } else if (existing) {
    // Logins are one address, one account, across every workspace.
    return {
      error:
        existing.organizationId === session.organizationId
          ? "That person is already on the account."
          : "That email address already has a login on another account.",
      kept,
    };
  } else {
    // A random password nobody knows. They set their own from the link;
    // until then there is no way in.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 10);
    const created = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email,
        title: optionalText(parsed.data.title ?? null),
        role: parsed.data.role,
        passwordHash,
        organizationId: session.organizationId,
      },
      select: { id: true },
    });
    userId = created.id;
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
    select: { name: true },
  });
  const token = await createInviteLink(userId);
  const sent = await sendInvite({
    organizationName: organization.name,
    inviterName: session.name,
    inviterEmail: session.email,
    name: parsed.data.name,
    email,
    token,
  });

  revalidatePath(PATH);
  if (!sent.ok) {
    console.error("[add user] invite send failed:", sent.error);
    return { error: `${parsed.data.name} was added, but the invitation email didn't go out. Try Resend invite.` };
  }
  return { success: `Invitation sent to ${email}.` };
}

// Loads the person being acted on, and refuses anything a form should not
// be able to do: acting on someone in another workspace, on yourself, or
// (for an admin) on the owner.
async function target(formData: FormData) {
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only owners and admins can manage users." } as const;
  const userId = String(formData.get("userId") ?? "");
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: session.organizationId },
    select: { id: true, name: true, email: true, role: true, removedAt: true, lastLoginAt: true },
  });
  if (!user) return { error: "That user isn't on this account." } as const;
  if (user.id === session.userId) return { error: "You can't change your own access here." } as const;
  if (user.role === "OWNER") return { error: "The account owner can't be changed or removed." } as const;
  return { session, user } as const;
}

export async function resendInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const found = await target(formData);
  if ("error" in found) return { error: found.error };
  const { session, user } = found;
  if (user.removedAt) return { error: `${user.name} has been removed. Restore them first.` };
  if (!isEmailConfigured()) return { error: "Email isn't switched on for this site." };

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
    select: { name: true },
  });
  const token = await createInviteLink(user.id);
  const sent = await sendInvite({
    organizationName: organization.name,
    inviterName: session.name,
    inviterEmail: session.email,
    name: user.name,
    email: user.email,
    token,
  });
  if (!sent.ok) {
    console.error("[resend invite] send failed:", sent.error);
    return { error: "The invitation didn't go out. Try again in a minute." };
  }
  revalidatePath(PATH);
  return { success: `New invitation sent to ${user.email}.` };
}

export async function changeUserRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const found = await target(formData);
  if ("error" in found) return { error: found.error };
  const role = z.enum(ASSIGNABLE).safeParse(formData.get("role"));
  if (!role.success) return { error: "Pick Admin or Member." };

  await prisma.user.update({ where: { id: found.user.id }, data: { role: role.data } });
  revalidatePath(PATH);
  return { success: `${found.user.name} is now ${role.data === "ADMIN" ? "an Admin" : "a Member"}.` };
}

export async function removeUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const found = await target(formData);
  if ("error" in found) return { error: found.error };

  // Kept, not deleted (see User.removedAt). Any link they have not used
  // yet dies now, so an old invitation cannot bring them back in.
  await prisma.$transaction([
    prisma.user.update({ where: { id: found.user.id }, data: { removedAt: new Date() } }),
    prisma.passwordReset.updateMany({
      where: { userId: found.user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);
  revalidatePath(PATH);
  return { success: `${found.user.name} can no longer log in.` };
}

export async function restoreUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const found = await target(formData);
  if ("error" in found) return { error: found.error };

  await prisma.user.update({ where: { id: found.user.id }, data: { removedAt: null } });
  revalidatePath(PATH);
  return {
    success: found.user.lastLoginAt
      ? `${found.user.name} can log in again with their old password.`
      : `${found.user.name} is back. Send a new invitation so they can set a password.`,
  };
}
