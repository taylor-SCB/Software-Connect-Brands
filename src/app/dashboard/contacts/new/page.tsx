import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getIndustryPickList } from "@/lib/industries";
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

  // "+ Add person" on a company page lands here with the company filled in.
  const [preset, pickList] = await Promise.all([
    companyId
      ? prisma.company.findFirst({
          where: { id: companyId, organizationId },
          select: { id: true, name: true, industries: true, companyTypes: true },
        })
      : null,
    getIndustryPickList(organizationId),
  ]);

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
          pickList={pickList}
          defaults={{ companyName: preset?.name ?? "", company: preset }}
          submitLabel="Save contact"
        />
      </Card>
    </div>
  );
}
