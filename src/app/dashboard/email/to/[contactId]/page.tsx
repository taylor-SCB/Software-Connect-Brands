import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { formatDate } from "@/lib/format";
import { todayIso } from "@/lib/payments";
import { ContactEmailButton } from "@/components/email-composer";

type Params = Promise<{ contactId: string }>;

// "Email this person" as its own address (Nov 11, 2026): opens the
// one-to-one email window for one contact, the same one the Email button on
// their page opens. A link to here works from anywhere that names a person
// (a pipeline tile's people, a list row) without loading their whole page.
export default async function EmailContactPage({ params }: { params: Params }) {
  const { organizationId } = await requireSession();
  const { contactId } = await params;
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    select: { id: true, name: true, email: true, email2: true, emailOptOutAt: true },
  });
  if (!contact) notFound();
  const timeZone = await getTimeZone();

  return (
    <div className="mx-auto max-w-xl" data-testid="email-to-page">
      <Link href={`/dashboard/contacts/${contact.id}`} className="link text-sm">
        ← {contact.name}
      </Link>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">Email {contact.name}</h1>
      <p className="faint mt-1 text-sm">A one-to-one email from you, logged on their history as a sent email.</p>
      <div className="mt-4">
        <ContactEmailButton
          contact={{
            id: contact.id,
            name: contact.name,
            email: contact.email,
            email2: contact.email2,
            optedOutOn: contact.emailOptOutAt ? formatDate(contact.emailOptOutAt, timeZone) : null,
          }}
          today={todayIso(timeZone)}
          defaultOpen
        />
      </div>
    </div>
  );
}
