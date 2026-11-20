"use client";

import { useEffect, useState, useTransition } from "react";
import { IconSparkles } from "@/components/icons";
import { forecastNotes } from "./forecast-actions";
import type { ForecastNotes } from "@/lib/forecast";

// The sentence under each rep's forecast: the rules one, or the AI's once
// it is written (AI release A). It asks once per set of numbers, on its
// own, as the report write-ups do; Rewrite asks again.

export type ForecastRepRow = {
  id: string;
  name: string;
  // The money columns: this month and next, or the picked dates.
  columns: { label: string; value: string; testId: string }[];
  open: string;
  deals: number;
  long: number;
  sentence: string;
};

export function ForecastReps({
  rows,
  repIds,
  ai,
  stored,
  dates,
}: {
  rows: ForecastRepRow[];
  repIds: string[];
  ai: boolean;
  stored: ForecastNotes | null;
  dates: { from: string; to: string } | null;
}) {
  const [notes, setNotes] = useState<ForecastNotes | null>(stored);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = repIds.join(",");

  function ask(force: boolean) {
    start(async () => {
      start(() => setError(null));
      const result = await forecastNotes(repIds, force, dates);
      start(() => {
        if ("error" in result) setError(result.error);
        else setNotes(result.notes);
      });
    });
  }

  // Asked once per set of reps and numbers the page was drawn with (the
  // page keys this by both, so new numbers mount it afresh).
  useEffect(() => {
    if (ai && !stored && rows.length) ask(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai, key, stored]);

  if (rows.length === 0) return <p className="faint text-sm" data-testid="forecast-empty">No quotes or contracts are out right now, so there&apos;s nothing to forecast.</p>;
  return (
    <div>
      <ul className="divide-y divide-[var(--hairline-3)]" data-testid="forecast-reps">
        {rows.map((row) => {
          const note = notes?.[row.id];
          return (
            <li key={row.id} className="grid min-w-0 gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,10rem)_1fr]" data-testid="forecast-rep" data-rep={row.id}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <p className="faint text-xs">
                  {row.deals} open{row.long ? ` · ${row.long} running long` : ""}
                </p>
              </div>
              <div className="min-w-0">
                <p className="num flex flex-wrap gap-x-4 text-sm">
                  {row.columns.map((column) => (
                    <span key={column.testId}>
                      <span className="faint text-xs">{column.label} </span>
                      <span className="font-semibold" data-testid={column.testId}>
                        {column.value}
                      </span>
                    </span>
                  ))}
                  <span>
                    <span className="faint text-xs">out </span>
                    {row.open}
                  </span>
                </p>
                <p className="muted mt-0.5 text-[0.8rem]" data-testid="forecast-sentence" data-source={note ? "ai" : "rules"}>
                  {note ?? row.sentence}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {ai && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {pending && <span className="faint" data-testid="forecast-writing">Writing the sentences…</span>}
          {!pending && notes && Object.keys(notes).length > 0 && <span className="faint">Sentences written by AI from these numbers only.</span>}
          {!pending && (
            <button type="button" onClick={() => ask(true)} className="link inline-flex items-center gap-1 pointer-coarse:min-h-11" data-testid="forecast-rewrite">
              <IconSparkles size={11} />
              Rewrite
            </button>
          )}
          {error && (
            <span className="text-[var(--warn)]" data-testid="forecast-error">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
