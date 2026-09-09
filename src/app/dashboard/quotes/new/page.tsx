import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, BackLink, PageHeader, EmptyState } from "@/components/ui";
import { IconUsers } from "@/components/icons";
import { NewQuoteForm } from "./form";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string; dealId?: string }>;
}) {
  const { organizationId } = await requireSession();
  const { contactId, dealId } = await searchParams;

  const [contacts, deals] = await Promise.all([
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
  ]);

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
              subtitle="Every quote belongs to a deal — the job you're trying to win. One deal can carry several quotes."
            />
            <NewQuoteForm
              contacts={contacts.map((contact) => ({
                id: contact.id,
                name: contact.name,
                company: contact.company?.name ?? null,
              }))}
              deals={deals}
              defaultContactId={
                contacts.some((contact) => contact.id === contactId) ? contactId : undefined
              }
              defaultDealId={deals.some((deal) => deal.id === dealId) ? dealId : undefined}
            />
          </>
        )}
      </Card>
    </div>
  );
}
