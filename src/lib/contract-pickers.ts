import { prisma } from "@/lib/prisma";

// Everything the Customer Information column and the template form need
// to offer as choices: customers, their deals and quotes, the people who
// could be named as senders, and the workspace's contract types. One
// helper so the template page, the new-contract page and the new-template
// page can't drift apart.
export async function loadContractPickers(organizationId: string) {
  const [contacts, deals, quotes, users, typeOptions] = await Promise.all([
    prisma.contact.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, company: { select: { name: true } } },
    }),
    prisma.deal.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, contactId: true, stage: true },
    }),
    prisma.quote.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, number: true, title: true, dealId: true, status: true, updatedAt: true },
    }),
    prisma.user.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.contractTypeOption.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { name: true },
    }),
  ]);

  return {
    contacts: contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      company: contact.company?.name ?? null,
    })),
    deals,
    quotes: quotes.map((quote) => ({ ...quote, updatedAt: quote.updatedAt.toISOString() })),
    users,
    typeOptions: typeOptions.map((option) => option.name),
  };
}

export type ContractPickers = Awaited<ReturnType<typeof loadContractPickers>>;
