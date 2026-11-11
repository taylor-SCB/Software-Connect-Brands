"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// The pickers above a report: period, rep and "Break down by". Each change
// rewrites the address bar, so a report can be bookmarked or sent to a
// teammate as a link; the page re-reads it on the server.

export function ReportControls({
  base,
  period,
  periods,
  rep,
  reps,
  by,
  breakdowns,
}: {
  // The current address bar without the three pickers' own values.
  base: Record<string, string>;
  period: string | null;
  periods: { value: string; label: string }[];
  rep: string;
  reps: { value: string; label: string }[];
  by: string | null;
  breakdowns: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function go(changes: Record<string, string>) {
    const search = new URLSearchParams({ ...base, ...(period ? { period } : {}), ...(rep ? { rep } : {}), ...(by ? { by } : {}), ...changes });
    for (const [key, value] of [...search.entries()]) if (!value) search.delete(key);
    start(() => router.push(`/dashboard?${search.toString()}`, { scroll: false }));
  }

  return (
    <div className={`flex flex-wrap items-end gap-2 ${pending ? "opacity-60" : ""}`} data-testid="report-controls" aria-busy={pending}>
      {period !== null && (
        <label className="min-w-[9.5rem]">
          <span className="label">Period</span>
          <select className="select input-sm" value={period} onChange={(event) => go({ period: event.target.value })} data-testid="report-period">
            {periods.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="min-w-[9.5rem]">
        <span className="label">Rep</span>
        <select className="select input-sm" value={rep} onChange={(event) => go({ rep: event.target.value })} data-testid="report-rep">
          {reps.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {by !== null && breakdowns.length > 0 && (
        <label className="min-w-[9.5rem]">
          <span className="label">Break down by</span>
          <select className="select input-sm" value={by} onChange={(event) => go({ by: event.target.value })} data-testid="report-by">
            {breakdowns.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
