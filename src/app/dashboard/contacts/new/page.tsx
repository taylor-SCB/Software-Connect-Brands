import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { ContactForm } from "../contact-form";
import { createContact } from "../actions";

export default function NewContactPage() {
  return (
    <div className="max-w-3xl">
      <BackLink href="/dashboard/contacts" label="Contacts" />
      <PageHeader eyebrow="New record" title="Add contact" />
      <Card lit>
        <CardHeader
          title="Contact details"
          subtitle="Only the contact name is required — fill in the rest as you learn it."
        />
        <ContactForm action={createContact} submitLabel="Save contact" />
      </Card>
    </div>
  );
}
