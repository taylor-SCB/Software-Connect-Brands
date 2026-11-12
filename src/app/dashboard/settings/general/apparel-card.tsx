"use client";

import { useActionState, useState } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import type { ActionState } from "@/lib/forms";
import { updateApparel } from "./actions";

// Settings → General: "We do apparel / custom print" (the apparel pack,
// Nov 12, 2026). Posts the state wanted, never "flip it", so a double click
// or a second tab can't turn it back.
export function ApparelCard({ on, canEdit }: { on: boolean; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateApparel, {});
  const [wanted, setWanted] = useState(on);
  const [seen, setSeen] = useState(on);
  if (on !== seen) {
    setSeen(on);
    setWanted(on);
  }
  return (
    <form action={action} className="space-y-2 px-5 pb-5" data-testid="apparel-form">
      <input type="hidden" name="apparelOn" value={wanted ? "true" : "false"} />
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm">
          {wanted ? "On: artwork, proofs and the approval link are in use." : "Off."}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={wanted}
          aria-label="We do apparel / custom print"
          className="switch"
          disabled={!canEdit}
          onClick={() => setWanted((value) => !value)}
          data-testid="apparel-switch"
        />
      </div>
      <p className="faint text-xs">
        Adds Artwork to company pages, proofs to quote lines, and a link for your customer to approve them. It also
        adds a Print location list you can edit on Labels &amp; Units. Turning it off hides those and deletes nothing.
      </p>
      {canEdit ? (
        <button type="submit" disabled={pending || wanted === on} className="btn btn-primary btn-sm" data-testid="apparel-save">
          {pending ? "Saving…" : "Save"}
        </button>
      ) : (
        <p className="faint text-xs">Only owners and admins can change this.</p>
      )}
      <FormError message={state.error} />
      <FormSuccess message={state.success} />
    </form>
  );
}
