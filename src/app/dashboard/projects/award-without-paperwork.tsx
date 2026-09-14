"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/ui";
import { SCHEDULE_PRESET_LABELS, SCHEDULE_PRESETS, type SchedulePreset } from "@/lib/payments";
import { awardWithoutPaperwork } from "./actions";

// For a job won on a handshake. Writes the Sales Order the quote already
// implies, records who agreed to it and when, and starts the job — so
// there is always one signed agreement behind a budget.
export function AwardWithoutPaperwork({
  dealId,
  today,
  disabled,
}: {
  dealId: string;
  // Today in the workspace's own clock, from the server. Reading the
  // browser's UTC clock prefilled tomorrow's date from 7pm Central
  // onward, and accepting it — the natural thing, since it looks like a
  // sensible default — dated the agreement and every payment on it a
  // day late.
  today: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [signedOn, setSignedOn] = useState(today);
  const [note, setNote] = useState("");
  const [preset, setPreset] = useState<SchedulePreset | "">("");

  if (disabled) {
    return <span className="faint text-xs">Write the quote first</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-sm"
        data-testid="award-without-paperwork"
      >
        Award without paperwork
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3 text-left">
      <p className="muted text-xs">
        Records the quote as an agreement the customer said yes to, so the job can be tracked. You can edit
        its payment table afterwards.
      </p>
      <label className="block text-xs">
        <span className="faint block">Who agreed to it</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="input input-sm"
          aria-label="Who agreed to it"
          data-testid="award-signer"
        />
      </label>
      <label className="block text-xs">
        <span className="faint block">When</span>
        <input
          type="date"
          value={signedOn}
          onChange={(event) => setSignedOn(event.target.value)}
          className="input input-sm"
          aria-label="When they agreed"
          data-testid="award-date"
        />
      </label>
      <label className="block text-xs">
        <span className="faint block">Payments</span>
        <select
          value={preset}
          onChange={(event) => setPreset(event.target.value as SchedulePreset | "")}
          className="select input-sm"
          aria-label="Payments"
          data-testid="award-preset"
        >
          <option value="">Your usual</option>
          {SCHEDULE_PRESETS.map((option) => (
            <option key={option} value={option}>{SCHEDULE_PRESET_LABELS[option]}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        <span className="faint block">Note</span>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. agreed on site"
          className="input input-sm"
          aria-label="Note"
          data-testid="award-note"
        />
      </label>
      <FormError message={error} />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(undefined);
              const result = await awardWithoutPaperwork(dealId, {
                signerName: name,
                signedOn,
                note,
                preset: preset || undefined,
              });
              if (result?.error) {
                setError(result.error);
                return;
              }
              setOpen(false);
              if (result?.projectId) router.push(`/dashboard/projects/${result.projectId}`);
              else router.refresh();
            })
          }
          className="btn btn-primary btn-sm"
          data-testid="award-save"
        >
          {pending ? "Awarding…" : "Award the job"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
