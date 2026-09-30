"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconX } from "@/components/icons";
import { unlinkContactAccount } from "@/app/dashboard/contacts/account-actions";

// The small × beside an additional account. Only the link goes; the
// company and the person both stay.
export function UnlinkAccountButton({ contactId, companyId, companyName }: { contactId: string; companyId: string; companyName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await unlinkContactAccount(contactId, companyId);
          router.refresh();
        })
      }
      aria-label={`Unlink ${companyName}`}
      title={`Unlink ${companyName}`}
      className="btn btn-ghost btn-sm !px-1.5 opacity-60 hover:opacity-100"
      data-testid="unlink-account"
    >
      <IconX size={11} />
    </button>
  );
}
