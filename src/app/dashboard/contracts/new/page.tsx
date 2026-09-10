import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadContractPickers } from "@/lib/contract-pickers";
import { Card, BackLink, PageHeader, EmptyState } from "@/components/ui";
import { IconUsers, IconFileText } from "@/components/icons";
import { NewContractComposer } from "./form";

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string; templateId?: string; dealId?: string }>;
}) {
  const { organizationId } = await requireSession();
  const { contactId, templateId, dealId } = await searchParams;

  const [pickers, templates] = await Promise.all([
    loadContractPickers(organizationId),
    prisma.contractTemplate.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true, type: true, body: true },
    }),
  ]);

  return (
    <div>
      <BackLink href="/dashboard/contracts" label="Contracts" />
      <PageHeader
        eyebrow="Agreements"
        title="New contract"
        subtitle="The agreement on the left, the customer on the right. Generate fills one in with the other."
      />

      {pickers.contacts.length === 0 ? (
        <Card lit>
          <EmptyState
            icon={<IconUsers size={20} />}
            title="Add a contact first"
            body="A contract is always addressed to a customer."
            action={
              <Link href="/dashboard/contacts/new" className="btn btn-primary btn-sm">
                Add contact
              </Link>
            }
          />
        </Card>
      ) : templates.length === 0 ? (
        <Card lit>
          <EmptyState
            icon={<IconFileText size={20} />}
            title="No templates yet"
            body="Create a template first — that's the wording the contract is generated from."
            action={
              <Link href="/dashboard/contracts/templates/new" className="btn btn-primary btn-sm">
                New template
              </Link>
            }
          />
        </Card>
      ) : (
        <NewContractComposer
          templates={templates}
          pickers={pickers}
          defaults={{
            templateId: templates.some((t) => t.id === templateId) ? templateId : undefined,
            contactId: pickers.contacts.some((c) => c.id === contactId) ? contactId : undefined,
            dealId: pickers.deals.some((d) => d.id === dealId) ? dealId : undefined,
          }}
        />
      )}
    </div>
  );
}
