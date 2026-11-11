"use client";

import { ContactEmailButton, type OneToOneContact } from "@/components/email-composer";
import { useContactPage } from "./contact-shell";

// The header's Email (approved decision 16, Nov 11, 2026): a one-to-one
// email to this person, logged on their history as a sent email (a touch,
// not marketing), with "Use a marketing template instead" one tap away
// inside the window. An unsubscribed person's window says so and won't
// send; no address reads "No email on file · Add one". What the send says
// lands in the page's toast too — with no Undo: an email can't be unsent.
export function ContactEmail({ contact }: { contact: OneToOneContact }) {
  const page = useContactPage();
  return (
    <ContactEmailButton
      className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
      contact={contact}
      today={page.today}
      onSent={({ message }) => page.showToast({ message })}
    />
  );
}
