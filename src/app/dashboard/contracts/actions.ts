"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, type ActionState } from "@/lib/forms";
import { publicToken } from "@/lib/tokens";
import { renderMergeFields, type MergeContext } from "@/lib/merge";
import { loadMergeContext } from "@/lib/merge-data";
import { resolveDeal } from "@/lib/deal-picker-server";
import { advanceDealStage } from "@/lib/deals";
import { NEW_TYPE_VALUE, canUserSend } from "@/lib/contracts";

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
  type: z.string().trim().min(1, "Pick a type").max(60, "Keep the type under 60 characters"),
  newType: z.string().trim().max(60, "Keep the type under 60 characters").optional(),
  description: z.string().trim().max(500).optional(),
  body: z.string().trim().min(20, "The template body looks too short").max(60000),
  allUsersCanSend: z.enum(["true", "false"]),
  senderUserIds: z.array(z.string().trim().min(1)).max(500),
});

type TemplateInput = z.infer<typeof templateSchema>;

function readTemplateForm(formData: FormData) {
  return parseForm(templateSchema, {
    name: formData.get("name"),
    type: formData.get("type"),
    newType: formData.get("newType") ?? undefined,
    description: formData.get("description") ?? undefined,
    body: formData.get("body"),
    allUsersCanSend: formData.get("allUsersCanSend") ?? "true",
    senderUserIds: formData.getAll("senderUserIds").filter((v) => typeof v === "string"),
  });
}

// Resolves the Type field to a name that exists in the workspace's pick
// list, adding it when it's new. Returns the sender settings checked
// against real users, or an error message.
async function settleTemplateInput(
  organizationId: string,
  input: TemplateInput,
): Promise<{ ok: true; type: string; allUsersCanSend: boolean; senderUserIds: string[] } | { ok: false; error: string }> {
  let type = input.type;
  if (type === NEW_TYPE_VALUE) {
    if (!input.newType) return { ok: false, error: "Name the new type, e.g. Commission Agreement" };
    type = input.newType;
  }
  // Same name, different capitalisation, is the same type.
  const existing = await prisma.contractTypeOption.findFirst({
    where: { organizationId, name: { equals: type, mode: "insensitive" } },
    select: { name: true },
  });
  if (existing) {
    type = existing.name;
  } else {
    await prisma.contractTypeOption.create({ data: { organizationId, name: type } });
  }

  const allUsersCanSend = input.allUsersCanSend === "true";
  // Only people in this workspace can be named as senders.
  const users = input.senderUserIds.length
    ? await prisma.user.findMany({
        where: { organizationId, id: { in: input.senderUserIds } },
        select: { id: true },
      })
    : [];
  const senderUserIds = users.map((user) => user.id);
  if (!allUsersCanSend && senderUserIds.length === 0) {
    return {
      ok: false,
      error: "Pick at least one person who can send, or switch All company users back on",
    };
  }

  return { ok: true, type, allUsersCanSend, senderUserIds };
}

export async function createTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = readTemplateForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const settled = await settleTemplateInput(organizationId, parsed.data);
  if (!settled.ok) return { error: settled.error };

  const template = await prisma.contractTemplate.create({
    data: {
      organizationId,
      name: parsed.data.name,
      type: settled.type,
      description: parsed.data.description ?? "",
      body: parsed.data.body,
      allUsersCanSend: settled.allUsersCanSend,
      senderUserIds: settled.senderUserIds,
    },
  });

  revalidatePath("/dashboard/contracts/templates");
  redirect(`/dashboard/contracts/templates/${template.id}`);
}

export async function updateTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const id = idSchema.safeParse(formData.get("templateId"));
  if (!id.success) return { error: "Missing template reference" };

  const parsed = readTemplateForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const settled = await settleTemplateInput(organizationId, parsed.data);
  if (!settled.ok) return { error: settled.error };

  const result = await prisma.contractTemplate.updateMany({
    where: { id: id.data, organizationId },
    data: {
      name: parsed.data.name,
      type: settled.type,
      description: parsed.data.description ?? "",
      body: parsed.data.body,
      allUsersCanSend: settled.allUsersCanSend,
      senderUserIds: settled.senderUserIds,
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

/* ------------------------------ Preview ------------------------------ */

// What the chips resolve to for the customer picked in the Customer
// Information column. Same loader the generator uses, so the preview and
// the finished contract can't disagree. Nothing is written.
export async function previewMergeContext(input: {
  contactId?: string | null;
  dealId?: string | null;
  quoteId?: string | null;
}): Promise<MergeContext> {
  const { organizationId } = await requireSession();

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { nextContractNumber: true },
  });

  // A deal only counts for the customer it belongs to; an id from another
  // customer (a stale pick) is ignored rather than trusted.
  const contactId = input.contactId || null;
  const deal =
    input.dealId && contactId
      ? await prisma.deal.findFirst({
          where: { id: input.dealId, organizationId, contactId },
          select: { id: true },
        })
      : null;

  return loadMergeContext({
    organizationId,
    contactId,
    dealId: deal?.id ?? null,
    quoteId: deal ? input.quoteId || null : null,
    contractNumber: `CON-${organization.nextContractNumber}`,
  });
}

/* ----------------------------- Contracts ----------------------------- */

export async function createContract(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(
    z.object({
      contactId: idSchema,
      dealId: z.string().trim().optional(),
      dealTitle: z.string().trim().max(160).optional(),
      quoteId: z.string().trim().optional(),
      templateId: idSchema,
      title: z.string().trim().max(160).optional(),
    }),
    {
      contactId: formData.get("contactId"),
      dealId: formData.get("dealId") ?? undefined,
      dealTitle: formData.get("dealTitle") ?? undefined,
      quoteId: formData.get("quoteId") ?? undefined,
      templateId: formData.get("templateId"),
      title: formData.get("title") ?? undefined,
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const [contact, template, owner] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: parsed.data.contactId, organizationId },
      select: { id: true, companyId: true },
    }),
    prisma.contractTemplate.findFirst({
      where: { id: parsed.data.templateId, organizationId },
    }),
    prisma.user.findFirst({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { name: true },
    }),
  ]);

  if (!contact) return { error: "Pick a customer for this contract" };
  if (!template) return { error: "Pick a template" };

  // A deal is optional on a contract (a standalone service agreement has
  // none), but if one was named it has to be this customer's.
  const wantsDeal = Boolean(parsed.data.dealId || parsed.data.dealTitle);
  const deal = wantsDeal
    ? await resolveDeal({
        dealId: parsed.data.dealId || null,
        dealTitle: parsed.data.dealTitle || null,
        contactId: contact.id,
        organizationId,
      })
    : null;
  if (wantsDeal && !deal) return { error: "That deal doesn't belong to this customer" };

  // Likewise a quote has to sit on that deal.
  const quote =
    deal && parsed.data.quoteId
      ? await prisma.quote.findFirst({
          where: { id: parsed.data.quoteId, organizationId, dealId: deal.id },
          select: { id: true },
        })
      : null;
  if (parsed.data.quoteId && deal && !quote) return { error: "That quote isn't on this deal" };

  const number = await nextContractNumber(organizationId);

  // Merge fields resolve once, here — the stored body is the exact text
  // the customer will read and sign.
  const body = renderMergeFields(
    template.body,
    await loadMergeContext({
      organizationId,
      contactId: contact.id,
      dealId: deal?.id ?? null,
      quoteId: quote?.id ?? null,
      contractNumber: `CON-${number}`,
      signerName: owner?.name ?? null,
    }),
  );

  const contract = await prisma.contract.create({
    data: {
      organizationId,
      contactId: contact.id,
      companyId: contact.companyId,
      senderSignerName: owner?.name ?? null,
      dealId: deal?.id ?? null,
      quoteId: quote?.id ?? null,
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
  const { organizationId, userId } = await requireSession();

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
    select: {
      status: true,
      dealId: true,
      template: { select: { allUsersCanSend: true, senderUserIds: true } },
    },
  });
  if (!contract || contract.status === "SIGNED" || contract.status === "CANCELLED") return;

  // The template's "Who can send" list is enforced here, not just hidden
  // on the page.
  if (parsed.data.status === "SENT" && !canUserSend(contract.template, userId)) return;

  await prisma.contract.updateMany({
    where: { id: parsed.data.contractId, organizationId },
    data: {
      status: parsed.data.status,
      sentAt: parsed.data.status === "SENT" ? new Date() : undefined,
      declinedAt: parsed.data.status === "DECLINED" ? new Date() : undefined,
    },
  });

  // Sending a contract moves its deal along the pipeline.
  if (parsed.data.status === "SENT") {
    await advanceDealStage(contract.dealId, organizationId, "CONTRACT_SENT");
  }

  revalidatePath(`/dashboard/contracts/${parsed.data.contractId}`);
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
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
    select: {
      id: true,
      status: true,
      organizationId: true,
      dealId: true,
      contact: { select: { email: true } },
    },
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

  // A signature is the customer saying yes: the deal is won.
  await advanceDealStage(contract.dealId, contract.organizationId, "WON");

  revalidatePath(`/c/${parsed.data.token}`);
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/deals");
  return { success: "Signed" };
}
