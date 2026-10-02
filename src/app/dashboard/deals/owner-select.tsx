"use client";

import { useState, useTransition } from "react";
import { updateDealOwner } from "./actions";

// The rep on a pipeline tile. Reads as a label ("Rep: Nic Rivera") and
// opens as a picker to hand the deal to somebody else.
export function OwnerSelect({
  dealId,
  ownerId,
  users,
}: {
  dealId: string;
  ownerId: string | null;
  users: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(ownerId ?? "");
  const [failed, setFailed] = useState(false);

  // A removed teammate's name stays on their deals: the list keeps them
  // (labelled) so the saved rep is always among the options.
  return (
    <label
      className={`flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] ${
        failed ? "border-[var(--danger)]" : "border-[var(--border-strong)]"
      }`}
      title={failed ? "Couldn't change the rep — try again" : "The rep on this deal"}
      data-testid="deal-owner"
    >
      <span className="faint shrink-0">Rep:</span>
      <select
        value={value}
        disabled={pending}
        aria-label="Rep on this deal"
        onChange={(event) => {
          const next = event.target.value;
          const previous = value;
          setValue(next);
          setFailed(false);
          startTransition(async () => {
            const result = await updateDealOwner(dealId, next);
            if (result?.error) {
              setValue(previous);
              setFailed(true);
            }
          });
        }}
        className="min-w-0 max-w-[9rem] cursor-pointer truncate bg-transparent font-medium outline-none"
      >
        <option value="">Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
    </label>
  );
}
