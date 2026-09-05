import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, BackLink, PageHeader, EmptyState } from "@/components/ui";
import { IconUsers, IconFileText } from "@/components/icons";
import { NewContractForm } from "./form";

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string; templateId?: string }>;
}) {
  const { organizationId } = await requireSession();
  const { contactId, templateId } = await searchParams;

  const [contacts, templates] = await Promise.all([
    prisma.contact.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: [{ company: "asc" }, { name: "asc" }],
      select: { id: true, name: true, company: true },
    }),
    prisma.contractTemplate.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true, type: true },
    }),
  ]);

  return (
    <div className="max-w-2xl">
      <BackLink href="/dashboard/contracts" label="Contracts" />
      <PageHeader eyebrow="Agreements" title="New contract" />

      <Card lit>
        {contacts.length === 0 ? (
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
        ) : templates.length === 0 ? (
          <EmptyState
            icon={<IconFileText size={20} />}
            title="No templates yet"
            body="Create a template first — that's the wording the contract is generated from."
            action={
              <Link
                href="/dashboard/contracts/templates/new"
                className="btn btn-primary btn-sm"
              >
                New template
              </Link>
            }
          />
        ) : (
          <>
            <CardHeader
              title="Generate contract"
              subtitle="Merge fields fill in with this customer's details, and you can edit the text before sending."
            />
            <NewContractForm
              contacts={contacts}
              templates={templates}
              defaultContactId={
                contacts.some((contact) => contact.id === contactId)
                  ? contactId
                  : undefined
              }
              defaultTemplateId={
                templates.some((template) => template.id === templateId)
                  ? templateId
                  : undefined
              }
            />
          </>
        )}
      </Card>
    </div>
  );
}
