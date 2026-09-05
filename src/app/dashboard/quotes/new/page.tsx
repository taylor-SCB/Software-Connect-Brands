import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, BackLink, PageHeader, EmptyState } from "@/components/ui";
import { IconUsers } from "@/components/icons";
import { NewQuoteForm } from "./form";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string }>;
}) {
  const { organizationId } = await requireSession();
  const { contactId } = await searchParams;

  const contacts = await prisma.contact.findMany({
    where: { organizationId, status: { not: "ARCHIVED" } },
    orderBy: [{ company: "asc" }, { name: "asc" }],
    select: { id: true, name: true, company: true },
  });

  return (
    <div className="max-w-2xl">
      <BackLink href="/dashboard/quotes" label="Quotes" />
      <PageHeader eyebrow="Sales" title="New quote" />

      <Card lit>
        {contacts.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={20} />}
            title="Add a contact first"
            body="A quote is always addressed to someone, so start by adding the customer."
            action={
              <Link href="/dashboard/contacts/new" className="btn btn-primary btn-sm">
                Add contact
              </Link>
            }
          />
        ) : (
          <>
            <CardHeader
              title="Quote setup"
              subtitle="You can change the template and details at any time before sending."
            />
            <NewQuoteForm
              contacts={contacts}
              defaultContactId={
                contacts.some((contact) => contact.id === contactId)
                  ? contactId
                  : undefined
              }
            />
          </>
        )}
      </Card>
    </div>
  );
}
