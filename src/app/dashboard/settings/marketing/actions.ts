"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/session";
import { keepFields, parseForm, type ActionState } from "@/lib/forms";

const PATH = "/dashboard/settings/marketing";
const FIELDS = ["name", "subject", "body"] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(120),
  subject: z.string().trim().min(1, "Add a subject").max(200),
  // A textarea posts its line breaks as \r\n; stored as \n so the plain
  // text copy of an email does not carry a mix of both.
  body: z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().min(1, "Write the message").max(20_000)),
});

function read(formData: FormData) {
  return parseForm(schema, {
    name: formData.get("name"),
    subject: formData.get("subject"),
    body: formData.get("body"),
  });
}

// Templates are company wording, so, like the marketing files, only
// owners and admins write them. Everybody can send them.
export async function createMarketingTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kept = keepFields(formData, FIELDS);
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only owners and admins can write templates.", kept };
  const parsed = read(formData);
  if (!parsed.ok) return { error: parsed.error, kept };

  await prisma.marketingTemplate.create({ data: { organizationId: session.organizationId, ...parsed.data } });
  revalidatePath(PATH);
  redirect(PATH);
}

export async function updateMarketingTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kept = keepFields(formData, FIELDS);
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only owners and admins can edit templates.", kept };
  const parsed = read(formData);
  if (!parsed.ok) return { error: parsed.error, kept };

  const updated = await prisma.marketingTemplate.updateMany({
    where: { id: String(formData.get("id") ?? ""), organizationId: session.organizationId },
    data: parsed.data,
  });
  if (updated.count === 0) return { error: "That template has been deleted.", kept };
  revalidatePath(PATH);
  redirect(PATH);
}

export async function deleteMarketingTemplate(formData: FormData) {
  const session = await requireAdminSession();
  if (!session.allowed) return;
  // Emails already sent keep their record; their link to the template
  // just goes blank (SetNull).
  await prisma.marketingTemplate.deleteMany({
    where: { id: String(formData.get("id") ?? ""), organizationId: session.organizationId },
  });
  revalidatePath(PATH);
  redirect(PATH);
}
