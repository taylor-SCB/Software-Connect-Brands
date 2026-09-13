import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getIndustryPickList } from "@/lib/industries";
import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { ContactForm } from "../../contact-form";
import { updateContact, deleteContact } from "../../actions";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const [contact, pickList] = await Promise.all([
    prisma.contact.findFirst({
      where: { id, organizationId },
      include: { company: { select: { id: true, name: true, industries: true, companyTypes: true } } },
    }),
    getIndustryPickList(organizationId),
  ]);
  if (!contact) notFound();

  return (
    <div className="max-w-3xl">
      <BackLink href={`/dashboard/contacts/${contact.id}`} label={contact.name} />
      <PageHeader eyebrow="Edit" title={contact.name} />

      <Card lit>
        <CardHeader title="Contact details" />
        <ContactForm
          action={updateContact}
          pickList={pickList}
          submitLabel="Save changes"
          defaults={{
            imageUrl: contact.imageUrl,
            id: contact.id,
            companyName: contact.company?.name ?? "",
            company: contact.company,
            name: contact.name,
            title: contact.title,
            email: contact.email,
            phone: contact.phone,
            website: contact.website,
            city: contact.city,
            state: contact.state,
            birthday: contact.birthday ? contact.birthday.toISOString().slice(0, 10) : "",
            status: contact.status,
          }}
        />
      </Card>

      <Card className="mt-5 border-[rgb(251_113_133/0.25)]">
        <CardHeader
          title="Danger zone"
          subtitle="Deleting removes this contact and all of its notes, activity, deals, quotes and contracts."
        />
        <form action={deleteContact} className="p-5">
          <input type="hidden" name="contactId" value={contact.id} />
          <button type="submit" className="btn btn-danger btn-sm">
            <IconTrash size={13} />
            Delete contact
          </button>
        </form>
      </Card>
    </div>
  );
}
