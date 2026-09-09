import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { ContactForm } from "../contact-form";
import { createContact } from "../actions";

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { organizationId } = await requireSession();
  const { companyId } = await searchParams;

  const companies = await prisma.company.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  // "+ Add person" on a company page lands here with the company filled in.
  const preset = companies.find((company) => company.id === companyId);

  return (
    <div className="max-w-3xl">
      <BackLink href="/dashboard/contacts" label="Contacts" />
      <PageHeader eyebrow="New record" title="Add contact" />
      <Card lit>
        <CardHeader
          title="Contact details"
          subtitle="Only the contact name is required — fill in the rest as you learn it."
        />
        <ContactForm
          action={createContact}
          companies={companies}
          defaults={{ companyName: preset?.name ?? "" }}
          submitLabel="Save contact"
        />
      </Card>
    </div>
  );
}
