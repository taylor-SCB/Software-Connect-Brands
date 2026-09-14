"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/ui";
import { IconSignature } from "@/components/icons";
import { markContractSigned } from "@/app/dashboard/contracts/actions";

// "Mark signed" on a sent contract: the customer signed a paper copy or
// said yes some other way, so the user records the signature by hand.
// Opens a small form in place — who signed, when, and a note in their
// own words.
export function MarkSignedButton({
  contractId,
  signerName,
  today,
  compact = false,
}: {
  contractId: string;
  // Prefilled with the contact's name.
  signerName: string;
  // yyyy-mm-dd in the workspace's zone.
  today: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(signerName);
  const [signedOn, setSignedOn] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const result = await markContractSigned(contractId, { signerName: name, signedOn, note });
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`btn btn-ghost btn-sm ${compact ? "" : "w-full"}`} data-testid="mark-signed">
        <IconSignature size={13} />
        Mark signed
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3 text-left" data-testid="mark-signed-form">
      <p className="text-xs font-medium">Record a signature you got another way</p>
      <label className="block text-xs">
        <span className="faint block">Who signed</span>
        <input className="input input-sm" value={name} onChange={(event) => setName(event.target.value)} aria-label="Who signed" data-testid="mark-signed-name" />
      </label>
      <label className="block text-xs">
        <span className="faint block">Signed on</span>
        <input type="date" className="input input-sm" value={signedOn} onChange={(event) => setSignedOn(event.target.value)} aria-label="Signed on" data-testid="mark-signed-date" />
      </label>
      <label className="block text-xs">
        <span className="faint block">Note <span className="faint">· optional</span></span>
        <input className="input input-sm" value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. signed paper copy on site" aria-label="Note" data-testid="mark-signed-note" />
      </label>
      <FormError message={error} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={submit} disabled={pending} className="btn btn-primary btn-sm" data-testid="mark-signed-save">
          {pending ? "Saving…" : "Mark signed"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
