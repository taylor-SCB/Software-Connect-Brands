"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecordRep } from "@/app/dashboard/assign-actions";

export type RepOption = { id: string; name: string; removed: boolean };

// The options every Rep picker offers: Unassigned first, then current
// teammates, and the saved rep even when they've been removed — labelled,
// and only while they're the one saved (a <select> whose value is missing
// from its options silently shows, and saves, the first one).
function RepOptions({ reps, current }: { reps: RepOption[]; current: string }) {
  return (
    <>
      <option value="">Unassigned</option>
      {reps
        .filter((rep) => !rep.removed || rep.id === current)
        .map((rep) => (
          <option key={rep.id} value={rep.id}>
            {rep.name}
          </option>
        ))}
    </>
  );
}

// On a contact's or company's page: saves as it is changed.
export function RepPicker({ kind, id, ownerId, reps }: { kind: "contact" | "company"; id: string; ownerId: string | null; reps: RepOption[] }) {
  const router = useRouter();
  const [value, setValue] = useState(ownerId ?? "");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col">
      <select
        value={value}
        disabled={pending}
        aria-label="Rep"
        data-testid="rep-picker"
        className="select input-sm w-48 py-1"
        onChange={(event) => {
          const next = event.target.value;
          const previous = value;
          setValue(next);
          setError(undefined);
          start(async () => {
            const result = await setRecordRep(kind, id, next);
            if (result.error) {
              setValue(previous);
              setError(result.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        <RepOptions reps={reps} current={ownerId ?? ""} />
      </select>
      {error && <span className="mt-1 text-xs text-[var(--danger)]">{error}</span>}
    </span>
  );
}

// On the contact and company forms. Posts `ownerId`, and `ownerOriginal`
// (what the form was opened with) so the server writes the rep only when
// it was changed here.
//
// Keyed by the saved rep (audit fix, Nov 10, 2026): the edit forms stay
// open after a save, and React resets the form afterwards. An unkeyed
// select went back to the rep the page opened with while ownerOriginal
// moved on to the new one, so the next save quietly put the old rep back.
// A new key mounts the box on the rep saved now.
export function RepField({ ownerId, reps }: { ownerId: string | null; reps: RepOption[] }) {
  const current = ownerId ?? "";
  return (
    <div>
      <label className="label" htmlFor="ownerId">
        Rep
      </label>
      <input type="hidden" name="ownerOriginal" value={current} />
      <select key={current} id="ownerId" name="ownerId" defaultValue={current} className="select" data-testid="rep-field">
        <RepOptions reps={reps} current={current} />
      </select>
    </div>
  );
}
