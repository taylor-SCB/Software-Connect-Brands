"use client";

import { useState } from "react";
import { ActivityFeed, type ActivityItem } from "@/components/activity-feed";
import { EmptyState } from "@/components/ui";

export type HistoryItem = ActivityItem & {
  // The workspace's day it falls on, and how that day reads ("Today",
  // "Yesterday", "Tue Nov 10").
  day: string;
  dayLabel: string;
  // Which filter chip it answers to; null for lines that are no touch
  // (Opportunity Created, Quote sent …), shown under All only.
  channel: "calls" | "texts" | "emails" | "meetings" | null;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "talks", label: "Talks" },
  { key: "calls", label: "Calls" },
  { key: "texts", label: "Texts" },
  { key: "emails", label: "Emails" },
  { key: "meetings", label: "Meetings" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

// The person's history (BDR redesign): grouped by day, newest first; a
// connect carries its green tag and an attempt reads muted. Chips narrow
// it — All · Talks · Calls · Texts · Emails · Meetings — and carry the
// counts the old Activity overview tiles showed (a zero draws no number).
// A phone shows the five latest until "Show all"; a computer the first 40.
export function ContactHistory({ items }: { items: HistoryItem[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [all, setAll] = useState(false);

  const touches = items.filter((item) => item.channel !== null && !item.marketing);
  const counts: Record<FilterKey, number> = {
    all: touches.length,
    talks: touches.filter((item) => item.connect).length,
    calls: touches.filter((item) => item.channel === "calls").length,
    texts: touches.filter((item) => item.channel === "texts").length,
    emails: touches.filter((item) => item.channel === "emails").length,
    meetings: touches.filter((item) => item.channel === "meetings").length,
  };
  const shown =
    filter === "all"
      ? items
      : filter === "talks"
        ? items.filter((item) => item.connect && !item.marketing)
        : items.filter((item) => item.channel === filter);

  // Days in order, each with its lines; the cut-offs count lines, not days.
  const groups: { day: string; label: string; rows: { item: HistoryItem; index: number }[] }[] = [];
  shown.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last && last.day === item.day) last.rows.push({ item, index });
    else groups.push({ day: item.day, label: item.dayLabel, rows: [{ item, index }] });
  });

  return (
    <div data-testid="history">
      <div className="flex flex-wrap gap-1.5 px-5 pb-1 pt-3" role="group" aria-label="Show">
        {FILTERS.map((option) => {
          const on = filter === option.key;
          const n = counts[option.key];
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setFilter(option.key);
                setAll(false);
              }}
              className={`btn btn-sm pointer-coarse:min-h-11 ${on ? "btn-primary" : "btn-ghost"}`}
              data-testid={`history-filter-${option.key}`}
            >
              {option.label}
              {n > 0 && (
                <span className="num text-[0.7rem] opacity-80" data-testid={`history-count-${option.key}`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        filter === "all" ? (
          <EmptyState title="No activity yet" body="Log a call, text, email or meeting to build the history." />
        ) : (
          <p className="faint px-5 py-6 text-sm" data-testid="history-empty">
            Nothing here yet.
          </p>
        )
      ) : (
        groups.map((group) => {
          const visible = group.rows.filter((row) => all || row.index < 40);
          if (visible.length === 0) return null;
          // On a phone, a day whose every line is past the fifth folds away too.
          const phoneHidden = !all && group.rows[0].index >= 5;
          return (
            <section key={group.day} className={phoneHidden ? "max-lg:hidden" : ""} data-testid="history-day" data-day={group.day}>
              <h3 className="eyebrow border-t border-[var(--hairline-3)] px-5 pb-1 pt-3">{group.label}</h3>
              <PhoneCut rows={visible} all={all} />
            </section>
          );
        })
      )}
      {(shown.length > 5 || shown.length > 40) && !all && (
        <div className={`border-t border-[var(--hairline-3)] px-5 py-2.5 ${shown.length > 40 ? "" : "lg:hidden"}`}>
          <button type="button" className="link text-xs pointer-coarse:min-h-11" onClick={() => setAll(true)} data-testid="history-show-all">
            Show all {shown.length}
          </button>
        </div>
      )}
    </div>
  );
}

// One day's lines; lines past the fifth overall are hidden on a phone.
function PhoneCut({ rows, all }: { rows: { item: HistoryItem; index: number }[]; all: boolean }) {
  const early = rows.filter((row) => all || row.index < 5).map((row) => row.item);
  const late = rows.filter((row) => !all && row.index >= 5).map((row) => row.item);
  return (
    <>
      {early.length > 0 && <ActivityFeed items={early} />}
      {late.length > 0 && (
        <div className="max-lg:hidden">
          <ActivityFeed items={late} />
        </div>
      )}
    </>
  );
}
