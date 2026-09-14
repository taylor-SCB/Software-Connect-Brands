"use client";

import { useState, useTransition } from "react";
import { formatCents, formatDay } from "@/lib/format";
import { describeTime } from "@/lib/crews";
import { Badge, FormError } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { deleteTimeEntry, setTimePaid } from "./actions";

export type TimeEntryView = {
  id: string;
  workerName: string;
  crewName: string | null;
  scopeName: string | null;
  // yyyy-mm-dd
  workedOn: string;
  hours: number;
  days: number;
  amountCents: number;
  countsAsCost: boolean;
  paidOn: string | null;
  note: string;
};

// One logged day. Paid time is Spent on the budget; unpaid time is
// Committed, so the checkbox moves money from one part of the bar to the
// other rather than changing the total.
export function TimeRow({ entry, today }: { entry: TimeEntryView; today: string }) {
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const run = (action: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setError(undefined);
      const result = await action();
      if (result?.error) setError(result.error);
    });

  return (
    <li className="px-5 py-3" data-testid="time-row" data-entry-id={entry.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {entry.workerName}
            {entry.crewName && entry.crewName !== entry.workerName && (
              <span className="faint font-normal"> · {entry.crewName}</span>
            )}
          </p>
          <p className="faint num text-xs">
            {formatDay(`${entry.workedOn}T12:00:00Z`)} · {describeTime(entry)}
            {entry.scopeName && ` · ${entry.scopeName}`}
            {entry.note && ` · ${entry.note}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="num text-sm font-medium" data-testid="time-amount" data-cents={entry.amountCents}>
            {formatCents(entry.amountCents)}
          </span>
          {entry.countsAsCost ? (
            <Badge color={entry.paidOn ? "#34d399" : "#fbbf24"}>{entry.paidOn ? "Paid" : "To pay"}</Badge>
          ) : (
            <Badge color="#94a3b8">Tracked only</Badge>
          )}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {entry.countsAsCost && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setTimePaid(entry.id, entry.paidOn ? null : today))}
            className="btn btn-ghost btn-sm"
            data-testid="time-toggle-paid"
          >
            {entry.paidOn ? "Mark unpaid" : "Mark paid"}
          </button>
        )}
        {entry.paidOn && (
          <span className="faint num text-xs">paid {formatDay(`${entry.paidOn}T12:00:00Z`)}</span>
        )}
        {!entry.countsAsCost && (
          <span className="faint text-xs">
            Their purchase order is the cost on this job, so these hours are not added to it.
          </span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteTimeEntry(entry.id))}
          aria-label={`Remove the time logged for ${entry.workerName} on ${entry.workedOn}`}
          className="btn btn-ghost btn-sm !px-1.5"
          data-testid="time-delete"
        >
          <IconTrash size={13} />
        </button>
      </div>

      <FormError message={error} />
    </li>
  );
}
