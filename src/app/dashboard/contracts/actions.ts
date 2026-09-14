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
import { getTimeZone } from "@/lib/organization";
import { NEW_TYPE_VALUE, canUserSend } from "@/lib/contracts";
import { moneyHold, moneyHoldMessage, zonedNoon } from "@/lib/money";
import { awardFromContract, reverseAward } from "@/lib/projects";

const idSchema = z.string().trim().min(1, "Missing record reference");

// Every screen that shows a contract's status or adds its money up.
function revalidateContract(contract: { id: string; dealId: string | null; publicToken?: string }) {
  revalidatePath(`/dashboard/contracts/${contract.id}`);
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/deals/tracker");
  revalidatePath("/dashboard/contracts/tracker");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/projects");
  if (contract.dealId) revalidatePath(`/dashboard/deals/${contract.dealId}`);
  if (contract.publicToken) revalidatePath(`/c/${contract.publicToken}`);
}

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
      // "in" (they pay us) or "out" (we pay them); absent from an older
      // form means Money in unless the template is a Purchase Order.
      direction: z.enum(["in", "out"]).optional(),
      paymentTerms: z.string().trim().max(120).optional(),
    }),
    {
      contactId: formData.get("contactId"),
      dealId: formData.get("dealId") ?? undefined,
      dealTitle: formData.get("dealTitle") ?? undefined,
      quoteId: formData.get("quoteId") ?? undefined,
      templateId: formData.get("templateId"),
      title: formData.get("title") ?? undefined,
      direction: formData.get("direction") ?? undefined,
      paymentTerms: formData.get("paymentTerms") ?? undefined,
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

  // Terms default from the Preset Payment Table (Settings → General); the
  // form can pick different ones.
  const paymentTerms =
    parsed.data.paymentTerms ||
    (
      await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { defaultPaymentTerms: true },
      })
    ).defaultPaymentTerms ||
    null;
  const payable = parsed.data.direction
    ? parsed.data.direction === "out"
    : template.type === "Purchase Order";

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
      paymentTerms,
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
      payable,
      paymentTerms,
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

// Deleting is refused once money is on the contract — payments recorded,
// or a signed Money-in contract with a row still open. Cancel it instead.
export async function deleteContract(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("contractId"));
  if (!id.success) return { error: "Missing contract reference" };

  const contract = await prisma.contract.findFirst({
    where: { id: id.data, organizationId },
    select: { number: true, title: true },
  });
  if (!contract) return { error: "Contract not found" };

  const hold = await moneyHold(organizationId, { id: id.data });
  const refusal = moneyHoldMessage(`CON-${contract.number} ${contract.title}`, hold, null);
  if (refusal) return { error: refusal };

  await prisma.$transaction(async (tx) => {
    // Take its award back out of the budget before the rows go.
    await reverseAward(tx, organizationId, id.data);
    await tx.contract.deleteMany({ where: { id: id.data, organizationId } });
  });
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/deals/tracker");
  revalidatePath("/dashboard/contracts/tracker");
  revalidatePath("/dashboard/projects");
  redirect("/dashboard/contracts");
}

/* ---------------------------- Mark signed ---------------------------- */

const markSignedSchema = z.object({
  contractId: idSchema,
  signerName: z.string().trim().min(2, "Who signed it?").max(120),
  signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was signed"),
  note: z.string().trim().max(500).optional(),
});

// The manual override: the customer signed a paper copy, or said yes in
// person, and the user records it here. Same effect as the signing link —
// a Money-in signature wins the deal — plus a note of how it happened.
export async function markContractSigned(
  contractId: string,
  input: { signerName: string; signedOn: string; note?: string },
): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const parsed = markSignedSchema.safeParse({ contractId, ...input });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };

  const contract = await prisma.contract.findFirst({
    where: { id: parsed.data.contractId, organizationId },
    select: { id: true, status: true, payable: true, dealId: true, publicToken: true, contact: { select: { email: true } } },
  });
  if (!contract) return { error: "Contract not found" };
  if (contract.status === "SIGNED") return { error: "This contract is already signed" };
  if (contract.status !== "SENT") return { error: "Send the contract first, then mark it signed" };

  const timeZone = await getTimeZone();
  const result = await prisma.contract.updateMany({
    where: { id: contract.id, organizationId, status: "SENT" },
    data: {
      status: "SIGNED",
      signedAt: zonedNoon(parsed.data.signedOn, timeZone),
      signerName: parsed.data.signerName,
      signerEmail: contract.contact.email,
      signedOffline: true,
      signedNote: parsed.data.note || null,
    },
  });
  if (result.count === 0) return { error: "This contract changed under you. Reload and try again." };

  // A supplier signing a purchase order never wins a deal; a customer
  // signing anything else does.
  if (!contract.payable) {
    await advanceDealStage(contract.dealId, organizationId, "WON");
    // A signed agreement is a job won: it becomes a project with the
    // budget this contract just set.
    await awardFromContract(organizationId, contract.id);
  }

  revalidateContract(contract);
  return { success: "Marked signed" };
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
      payable: true,
      organizationId: true,
      dealId: true,
      publicToken: true,
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

  // A customer's signature is them saying yes: the deal is won. A supplier
  // signing a purchase order (Money out) is not — the deal stays where it is.
  if (!contract.payable) {
    await advanceDealStage(contract.dealId, contract.organizationId, "WON");
    await awardFromContract(contract.organizationId, contract.id);
  }

  revalidateContract(contract);
  return { success: "Signed" };
}
