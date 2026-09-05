"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, type ActionState } from "@/lib/forms";
import { publicToken } from "@/lib/tokens";
import { buildMergeContext, renderMergeFields } from "@/lib/merge";
import { CONTRACT_TYPES } from "@/lib/constants";

const idSchema = z.string().trim().min(1, "Missing record reference");

async function nextContractNumber(organizationId: string) {
  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data: { nextContractNumber: { increment: 1 } },
    select: { nextContractNumber: true },
  });
  return organization.nextContractNumber - 1;
}

/* ----------------------------- Templates ----------------------------- */

const templateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required").max(160),
  type: z.enum(CONTRACT_TYPES),
  description: z.string().trim().max(500).optional(),
  body: z.string().trim().min(20, "The template body looks too short").max(60000),
});

export async function createTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(templateSchema, {
    name: formData.get("name"),
    type: formData.get("type"),
    description: formData.get("description") ?? undefined,
    body: formData.get("body"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const template = await prisma.contractTemplate.create({
    data: {
      organizationId,
      name: parsed.data.name,
      type: parsed.data.type,
      description: parsed.data.description ?? "",
      body: parsed.data.body,
    },
  });

  revalidatePath("/dashboard/contracts/templates");
  redirect(`/dashboard/contracts/templates/${template.id}`);
}

export async function updateTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const id = idSchema.safeParse(formData.get("templateId"));
  if (!id.success) return { error: "Missing template reference" };

  const parsed = parseForm(templateSchema, {
    name: formData.get("name"),
    type: formData.get("type"),
    description: formData.get("description") ?? undefined,
    body: formData.get("body"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const result = await prisma.contractTemplate.updateMany({
    where: { id: id.data, organizationId },
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      description: parsed.data.description ?? "",
      body: parsed.data.body,
    },
  });
  if (result.count === 0) return { error: "Template not found" };

  revalidatePath("/dashboard/contracts/templates");
  revalidatePath(`/dashboard/contracts/templates/${id.data}`);
  return { success: "Template saved" };
}

export async function deleteTemplate(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("templateId"));
  if (!id.success) return;

  await prisma.contractTemplate.deleteMany({ where: { id: id.data, organizationId } });
  revalidatePath("/dashboard/contracts/templates");
  redirect("/dashboard/contracts/templates");
}

/* ----------------------------- Contracts ----------------------------- */

export async function createContract(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(
    z.object({
      contactId: idSchema,
      templateId: idSchema,
      title: z.string().trim().max(160).optional(),
    }),
    {
      contactId: formData.get("contactId"),
      templateId: formData.get("templateId"),
      title: formData.get("title") ?? undefined,
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const [organization, contact, template] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    }),
    prisma.contact.findFirst({
      where: { id: parsed.data.contactId, organizationId },
    }),
    prisma.contractTemplate.findFirst({
      where: { id: parsed.data.templateId, organizationId },
    }),
  ]);

  if (!contact) return { error: "Pick a contact for this contract" };
  if (!template) return { error: "Pick a template" };

  const number = await nextContractNumber(organizationId);

  // Merge fields resolve once, here — the stored body is the exact text
  // the customer will read and sign.
  const body = renderMergeFields(
    template.body,
    buildMergeContext({
      organizationName: organization.name,
      contactName: contact.name,
      contactCompany: contact.company,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      contractNumber: `CON-${number}`,
    }),
  );

  const contract = await prisma.contract.create({
    data: {
      organizationId,
      contactId: contact.id,
      templateId: template.id,
      number,
      title: parsed.data.title?.trim() || template.name,
      type: template.type,
      body,
      publicToken: publicToken(),
    },
  });

  revalidatePath("/dashboard/contracts");
  redirect(`/dashboard/contracts/${contract.id}`);
}

export async function updateContractBody(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(
    z.object({
      contractId: idSchema,
      title: z.string().trim().min(1, "Title is required").max(160),
      body: z.string().trim().min(20, "The contract body looks too short").max(60000),
    }),
    {
      contractId: formData.get("contractId"),
      title: formData.get("title"),
      body: formData.get("body"),
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  // Editing after signature would change what was agreed to, so signed
  // contracts are frozen.
  const contract = await prisma.contract.findFirst({
    where: { id: parsed.data.contractId, organizationId },
    select: { status: true },
  });
  if (!contract) return { error: "Contract not found" };
  if (contract.status === "SIGNED") {
    return { error: "This contract is signed and can no longer be edited" };
  }

  await prisma.contract.updateMany({
    where: { id: parsed.data.contractId, organizationId },
    data: { title: parsed.data.title, body: parsed.data.body },
  });

  revalidatePath(`/dashboard/contracts/${parsed.data.contractId}`);
  revalidatePath("/dashboard/contracts");
  return { success: "Contract saved" };
}

export async function setContractStatus(formData: FormData) {
  const { organizationId } = await requireSession();

  const parsed = z
    .object({
      contractId: idSchema,
      status: z.enum(["DRAFT", "SENT", "DECLINED"]),
    })
    .safeParse({
      contractId: formData.get("contractId"),
      status: formData.get("status"),
    });
  if (!parsed.success) return;

  // SIGNED is only ever set by the customer signing; it can't be
  // toggled from the dashboard.
  const contract = await prisma.contract.findFirst({
    where: { id: parsed.data.contractId, organizationId },
    select: { status: true },
  });
  if (!contract || contract.status === "SIGNED") return;

  await prisma.contract.updateMany({
    where: { id: parsed.data.contractId, organizationId },
    data: {
      status: parsed.data.status,
      sentAt: parsed.data.status === "SENT" ? new Date() : undefined,
      declinedAt: parsed.data.status === "DECLINED" ? new Date() : undefined,
    },
  });

  revalidatePath(`/dashboard/contracts/${parsed.data.contractId}`);
  revalidatePath("/dashboard/contracts");
}

export async function deleteContract(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("contractId"));
  if (!id.success) return;

  await prisma.contract.deleteMany({ where: { id: id.data, organizationId } });
  revalidatePath("/dashboard/contracts");
  redirect("/dashboard/contracts");
}

/* --------------------- Customer-facing signature --------------------- */

export async function signContract(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(
    z.object({
      token: z.string().trim().min(10),
      signerName: z.string().trim().min(2, "Type your full name to sign").max(120),
      agree: z.literal("on", { message: "Tick the box to accept the terms" }),
    }),
    {
      token: formData.get("token"),
      signerName: formData.get("signerName"),
      agree: formData.get("agree"),
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const contract = await prisma.contract.findUnique({
    where: { publicToken: parsed.data.token },
    select: { id: true, status: true, contact: { select: { email: true } } },
  });

  // Only a contract that was actually sent can be signed, and only once.
  if (!contract || contract.status === "DRAFT") return { error: "This contract isn't available" };
  if (contract.status === "SIGNED") return { error: "This contract has already been signed" };

  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      status: "SIGNED",
      signedAt: new Date(),
      signerName: parsed.data.signerName,
      signerEmail: contract.contact.email,
    },
  });

  revalidatePath(`/c/${parsed.data.token}`);
  revalidatePath("/dashboard/contracts");
  return { success: "Signed" };
}
