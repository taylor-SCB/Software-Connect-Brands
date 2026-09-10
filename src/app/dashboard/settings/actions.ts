"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireSession } from "@/lib/session";
import { parseForm, optionalText, type ActionState } from "@/lib/forms";
import { TIME_ZONES } from "@/lib/format";
import { normalizeWebsite } from "@/lib/companies";
import {
  hasFile,
  imageProblem,
  isFileUrl,
  readUpload,
  removeImage,
  replaceImage,
  MAX_DOCUMENT_BYTES,
} from "@/lib/uploads";
import { isoToDate } from "@/lib/payments";
import { COMPLIANCE_CATEGORIES } from "@/lib/constants";

const idSchema = z.string().trim().min(1, "Missing record reference");

// The brand color and name live in the layout, so every settings save
// revalidates the whole dashboard subtree rather than one page.
function revalidateDashboard() {
  revalidatePath("/dashboard", "layout");
}

/* ----------------------------- Branding ----------------------------- */

const brandingSchema = z.object({
  name: z.string().trim().min(2, "Company name is too short").max(120),
  // The logo is rendered in an <img> on customer-facing documents, so
  // only http(s) is allowed — `javascript:` and huge `data:` URLs are
  // rejected rather than embedded in a quote.
  logoUrl: z
    .union([
      z.literal(""),
      z
        .url("Enter a valid image URL")
        .refine(
          (value) => /^https?:\/\//i.test(value),
          "Logo URL must start with http:// or https://",
        ),
    ])
    .optional(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Enter a color as a 6-digit hex code, e.g. #6366f1"),
  // Constrained to the offered list — an arbitrary string would throw
  // inside Intl on every page that renders a date.
  timeZone: z.enum(TIME_ZONES.map((zone) => zone.value) as [string, ...string[]]),
  removeLogo: z.enum(["true", "false"]).optional(),
});

export async function updateBranding(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminSession();
  if (!session.allowed) {
    return { error: "Only owners and admins can change branding" };
  }

  const logoFile = formData.get("logoFile");
  const problem = imageProblem(logoFile);
  if (problem) return { error: problem };

  // An uploaded logo is the URL field's value; the text box only matters
  // when nothing was uploaded and the current logo isn't an upload.
  const current = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
    select: { logoUrl: true },
  });
  const typedUrl = String(formData.get("logoUrl") ?? "");
  const parsed = parseForm(brandingSchema, {
    name: formData.get("name"),
    logoUrl: isFileUrl(typedUrl) ? "" : typedUrl,
    primaryColor: formData.get("primaryColor"),
    timeZone: formData.get("timeZone"),
    removeLogo: formData.get("removeLogo") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error };

  let logoUrl: string | null;
  if (hasFile(logoFile)) {
    logoUrl = await replaceImage({
      organizationId: session.organizationId,
      kind: "ORG_LOGO",
      file: logoFile,
    });
  } else if (parsed.data.removeLogo === "true") {
    await removeImage({ organizationId: session.organizationId, kind: "ORG_LOGO" });
    logoUrl = null;
  } else if (isFileUrl(current.logoUrl) && !parsed.data.logoUrl) {
    logoUrl = current.logoUrl;
  } else {
    if (isFileUrl(current.logoUrl)) {
      await removeImage({ organizationId: session.organizationId, kind: "ORG_LOGO" });
    }
    logoUrl = optionalText(parsed.data.logoUrl ?? "");
  }

  await prisma.organization.update({
    where: { id: session.organizationId },
    data: {
      name: parsed.data.name,
      logoUrl,
      primaryColor: parsed.data.primaryColor.toLowerCase(),
      timeZone: parsed.data.timeZone,
    },
  });

  revalidateDashboard();
  return { success: "Branding saved" };
}

/* ------------------------- Company Information ------------------------- */

const companyInfoSchema = z.object({
  addressLine1: z.string().trim().max(160).optional(),
  addressLine2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(60).optional(),
  postalCode: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.literal(""), z.email("Enter a valid email address")]).optional(),
  website: z.union([z.literal(""), z.string().trim().max(200)]).optional(),
  description: z.string().trim().max(4000, "Keep the description under 4,000 characters").optional(),
  history: z.string().trim().max(4000, "Keep the history under 4,000 characters").optional(),
});

export async function updateCompanyInfo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminSession();
  if (!session.allowed) {
    return { error: "Only owners and admins can change company information" };
  }

  const logoFile = formData.get("logoFile");
  const problem = imageProblem(logoFile);
  if (problem) return { error: problem };

  const parsed = parseForm(companyInfoSchema, {
    addressLine1: formData.get("addressLine1") ?? undefined,
    addressLine2: formData.get("addressLine2") ?? undefined,
    city: formData.get("city") ?? undefined,
    state: formData.get("state") ?? undefined,
    postalCode: formData.get("postalCode") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    email: formData.get("email") ?? undefined,
    website: formData.get("website") ?? undefined,
    description: formData.get("description") ?? undefined,
    history: formData.get("history") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error };

  // Same logo as Branding: one picture, two places to change it.
  const logo: { logoUrl?: string | null } = {};
  if (hasFile(logoFile)) {
    logo.logoUrl = await replaceImage({
      organizationId: session.organizationId,
      kind: "ORG_LOGO",
      file: logoFile,
    });
  } else if (formData.get("removeLogo") === "true") {
    await removeImage({ organizationId: session.organizationId, kind: "ORG_LOGO" });
    logo.logoUrl = null;
  }

  await prisma.organization.update({
    where: { id: session.organizationId },
    data: {
      addressLine1: parsed.data.addressLine1 || null,
      addressLine2: parsed.data.addressLine2 || null,
      city: parsed.data.city || null,
      state: parsed.data.state || null,
      postalCode: parsed.data.postalCode || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email ? parsed.data.email.toLowerCase() : null,
      website: normalizeWebsite(parsed.data.website || null),
      description: parsed.data.description ?? "",
      history: parsed.data.history ?? "",
      ...logo,
    },
  });

  revalidateDashboard();
  return { success: "Company information saved" };
}

/* ------------------------------ My Account ------------------------------ */

const accountSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  title: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  receiveInAppMessages: z.enum(["true", "false"]),
});

export async function updateAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  const avatarFile = formData.get("avatarFile");
  const problem = imageProblem(avatarFile);
  if (problem) return { error: problem };

  const parsed = parseForm(accountSchema, {
    name: formData.get("name"),
    email: formData.get("email"),
    title: formData.get("title") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    receiveInAppMessages: formData.get("receiveInAppMessages") ?? "false",
  });
  if (!parsed.ok) return { error: parsed.error };

  // The email is the login, so a clash is a real error, not a constraint
  // failure to translate later.
  const clash = await prisma.user.findFirst({
    where: { email: parsed.data.email, id: { not: session.userId } },
    select: { id: true },
  });
  if (clash) return { error: "Another account already uses that email" };

  const avatar: { avatarUrl?: string | null } = {};
  if (hasFile(avatarFile)) {
    avatar.avatarUrl = await replaceImage({
      organizationId: session.organizationId,
      kind: "USER_AVATAR",
      file: avatarFile,
      userId: session.userId,
    });
  } else if (formData.get("removeAvatar") === "true") {
    await removeImage({
      organizationId: session.organizationId,
      kind: "USER_AVATAR",
      userId: session.userId,
    });
    avatar.avatarUrl = null;
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      title: parsed.data.title || null,
      phone: parsed.data.phone || null,
      receiveInAppMessages: parsed.data.receiveInAppMessages === "true",
      ...avatar,
    },
  });

  revalidateDashboard();
  return { success: "Account saved" };
}

export async function changePassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  const parsed = parseForm(
    z
      .object({
        currentPassword: z.string().min(1, "Enter your current password"),
        newPassword: z.string().min(8, "New password must be at least 8 characters").max(200),
        confirmPassword: z.string(),
      })
      .refine((value) => value.newPassword === value.confirmPassword, {
        message: "The two new passwords don't match",
        path: ["confirmPassword"],
      }),
    {
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { passwordHash: true },
  });
  const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) return { error: "That current password isn't right" };

  await prisma.user.update({
    where: { id: session.userId },
    data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) },
  });

  return { success: "Password changed" };
}

/* -------------------- Compliance and marketing files -------------------- */

const documentSchema = z.object({
  kind: z.enum(["COMPLIANCE", "MARKETING"]),
  name: z.string().trim().min(1, "Give the file a name").max(160),
  category: z.string().trim().max(60).optional(),
  expiresOn: z.string().trim().optional(),
});

export async function uploadDocument(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only owners and admins can upload company files" };

  const file = formData.get("file");
  if (!hasFile(file)) return { error: "Choose a file to upload" };
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: "That file is over 4 MB. Export a smaller version and try again." };
  }

  const parsed = parseForm(documentSchema, {
    kind: formData.get("kind"),
    name: formData.get("name") || file.name.replace(/\.[^.]+$/, ""),
    category: formData.get("category") ?? undefined,
    expiresOn: formData.get("expiresOn") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error };

  const expiresOn = parsed.data.expiresOn ? isoToDate(parsed.data.expiresOn) : null;
  if (parsed.data.expiresOn && !expiresOn) return { error: "That expiry date isn't valid" };

  const category =
    parsed.data.kind === "COMPLIANCE"
      ? (COMPLIANCE_CATEGORIES as readonly string[]).includes(parsed.data.category ?? "")
        ? parsed.data.category
        : "Other"
      : parsed.data.category || null;

  await prisma.upload.create({
    data: {
      organizationId: session.organizationId,
      kind: parsed.data.kind,
      category,
      name: parsed.data.name,
      expiresOn,
      ...(await readUpload(file)),
    },
  });

  const page = parsed.data.kind === "COMPLIANCE" ? "compliance" : "marketing";
  revalidatePath(`/dashboard/settings/${page}`);
  return { success: `${parsed.data.name} uploaded` };
}

export async function deleteDocument(formData: FormData) {
  const session = await requireAdminSession();
  if (!session.allowed) return;
  const id = idSchema.safeParse(formData.get("uploadId"));
  if (!id.success) return;

  // Only the document kinds — an image is removed from its own form.
  await prisma.upload.deleteMany({
    where: {
      id: id.data,
      organizationId: session.organizationId,
      kind: { in: ["COMPLIANCE", "MARKETING"] },
    },
  });
  revalidatePath("/dashboard/settings/compliance");
  revalidatePath("/dashboard/settings/marketing");
}
