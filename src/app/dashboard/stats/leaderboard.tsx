"use client";

import { useRef, useState, useTransition } from "react";
import { FloatingMenu } from "@/components/floating-menu";
import { formatCents, pct } from "@/lib/format";
import {
  DEFAULT_LEADERBOARD_COLUMNS,
  LEADERBOARD_COLUMNS,
  type LeaderboardColumnKey,
  type LeaderboardFormat,
  type LeaderboardRow,
} from "@/lib/stats-columns";
import { saveLeaderboardColumns } from "./actions";

function show(value: number | null, format: LeaderboardFormat) {
  if (value === null) return "—";
  if (format === "money") return formatCents(value);
  if (format === "rate") return pct(value);
  return value.toLocaleString("en-US");
}

// The leaderboard (Nov 11, 2026): one row per rep with the BDR's numbers
// first, the rest under Columns. On a phone each rep is a card.
export function Leaderboard({
  rows,
  team,
  initialColumns,
}: {
  rows: LeaderboardRow[];
  team: LeaderboardRow;
  initialColumns: LeaderboardColumnKey[];
}) {
  const [columns, setColumns] = useState<LeaderboardColumnKey[]>(initialColumns);
  const [open, setOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const shown = LEADERBOARD_COLUMNS.filter((column) => columns.includes(column.key));

  function choose(next: LeaderboardColumnKey[]) {
    const ordered = LEADERBOARD_COLUMNS.map((column) => column.key).filter((key) => next.includes(key));
    if (!ordered.length) return;
    setColumns(ordered);
    setError(null);
    startSaving(async () => {
      const result = await saveLeaderboardColumns(ordered);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        {saving && <span className="faint text-xs">Saving…</span>}
        <button
          ref={button}
          type="button"
          className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen((value) => !value)}
          data-testid="stats-columns"
        >
          Columns ({shown.length})
        </button>
        <FloatingMenu anchor={button} open={open} onClose={() => setOpen(false)} width={260} testId="stats-columns-menu" label="Leaderboard columns">
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {LEADERBOARD_COLUMNS.map((column) => {
              const on = columns.includes(column.key);
              return (
                <label
                  key={column.key}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-[var(--hover)] sm:min-h-9"
                  title={"hint" in column ? column.hint : undefined}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={on && columns.length === 1}
                    onChange={() => choose(on ? columns.filter((key) => key !== column.key) : [...columns, column.key])}
                    data-testid={`stats-column-${column.key}`}
                  />
                  {column.label}
                </label>
              );
            })}
            <button
              type="button"
              className="btn btn-ghost btn-sm mt-1 w-full pointer-coarse:min-h-11"
              onClick={() => choose(DEFAULT_LEADERBOARD_COLUMNS)}
              data-testid="stats-columns-reset"
            >
              Back to the usual columns
            </button>
          </div>
        </FloatingMenu>
      </div>

      {/* Wide screens: the table. */}
      <div className="hidden overflow-x-auto md:block" data-testid="stats-leaderboard-scroll">
        <table className="table text-xs [&_td]:px-3 [&_th]:px-3" data-testid="stats-leaderboard">
          <thead>
            <tr>
              <th>Rep</th>
              {shown.map((column) => (
                <th key={column.key} className="text-right" title={"hint" in column ? column.hint : undefined} data-column={column.key}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-testid="stats-rep-row" data-rep={row.id}>
                <td className="whitespace-nowrap font-medium" data-testid="stats-rep-name">
                  {row.name}
                </td>
                {shown.map((column) => (
                  <td key={column.key} className="num text-right" data-column={column.key}>
                    {show(row.values[column.key], column.format)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold" data-testid="stats-team-row">
              <td>Team</td>
              {shown.map((column) => (
                <td key={column.key} className="num text-right" data-column={column.key}>
                  {show(team.values[column.key], column.format)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Phones: one card per rep, two numbers a line. */}
      <ul className="grid grid-cols-1 gap-2 md:hidden" data-testid="stats-rep-cards">
        {[...rows, team].map((row) => (
          <li key={row.id} className="min-w-0 rounded-lg border border-[var(--border)] p-3" data-testid="stats-rep-card" data-rep={row.id}>
            <p className="truncate text-sm font-semibold">{row === team ? "Team" : row.name}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {shown.map((column) => (
                <div key={column.key} className="flex min-w-0 items-baseline justify-between gap-2" data-column={column.key}>
                  <dt className="faint truncate">{column.label}</dt>
                  <dd className="num font-medium">{show(row.values[column.key], column.format)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
