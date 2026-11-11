"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MultiSelect } from "@/components/list-filters";
import { IconSearch } from "@/components/icons";
import { saveUiPref } from "@/app/dashboard/prefs-actions";

// The Pipeline's bar (Oct 27, 2026; reordered for the BDR redesign, Nov
// 11, 2026): Mine | Everyone first (Members open on Mine, approved
// decision 17, remembered per person), then Search, Gone quiet, Needs a
// decision (Meeting Set tiles whose meeting has passed) and the Lead
// Label filter. The search finds a tile by any listed person's name or
// company, or its own name; the labels stack, N/A being the tiles with
// none. Everything lives in the address bar, so a filtered board can be
// bookmarked or shared.
export function PipelineFilters({
  q,
  labels,
  labelChoices,
  shown,
  scope,
  quiet = false,
  quietCount = 0,
  quietDays = 8,
  decide = false,
  decideCount = 0,
}: {
  q: string;
  labels: string[];
  labelChoices: string[];
  shown: number;
  scope: "mine" | "all";
  // The "Gone quiet" toggle (Nov 10, 2026): open opportunities nobody has
  // touched in the workspace's quietDays.
  quiet?: boolean;
  quietCount?: number;
  quietDays?: number;
  decide?: boolean;
  decideCount?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [typed, setTyped] = useState(q);
  // Ticked in this tab, until the page answers with the new filter.
  const [ticked, setTicked] = useState({ base: labels, values: labels });
  const picked = ticked.base === labels ? ticked.values : labels;
  const setPicked = (values: string[]) => setTicked({ base: labels, values });

  function go(next: { q?: string; labels?: string[]; quiet?: boolean; decide?: boolean; scope?: "mine" | "all" }) {
    const query = new URLSearchParams(params.toString());
    for (const key of ["quiet", "decide"] as const) {
      const value = next[key];
      if (value === undefined) continue;
      if (value) query.set(key, "1");
      else query.delete(key);
    }
    if (next.scope) query.set("scope", next.scope);
    const text = (next.q ?? typed).trim();
    if (text) query.set("q", text);
    else query.delete("q");
    query.delete("label");
    for (const label of next.labels ?? picked) query.append("label", label);
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  // Typing searches after a short pause.
  useEffect(() => {
    if (typed.trim() === q) return;
    const timer = setTimeout(() => go({ q: typed }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go reads the latest params on purpose
  }, [typed]);

  function pickScope(next: "mine" | "all") {
    if (next === scope) return;
    go({ scope: next });
    // Remembered for next time as uiPrefs pipeline.scope; the address bar
    // already says it.
    void saveUiPref("pipeline", "scope", next).catch(() => {});
  }

  const filtered = Boolean(q) || labels.length > 0 || quiet || decide;
  const segment = (on: boolean) =>
    `min-h-9 px-3 text-xs font-medium transition-colors focus-visible:relative focus-visible:z-10 ${
      on ? "bg-[var(--brand)] text-white" : "text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
    }`;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="pipeline-filters">
      <div role="group" aria-label="Whose tiles" className="inline-flex overflow-hidden rounded-lg border border-[var(--border)]" data-testid="pipeline-scope">
        <button type="button" aria-pressed={scope === "mine"} onClick={() => pickScope("mine")} className={segment(scope === "mine")} data-testid="pipeline-scope-mine">
          Mine
        </button>
        <button
          type="button"
          aria-pressed={scope === "all"}
          onClick={() => pickScope("all")}
          className={`${segment(scope === "all")} border-l border-[var(--border)]`}
          data-testid="pipeline-scope-all"
        >
          Everyone
        </button>
      </div>
      <label className="relative min-w-[12rem] flex-1 sm:max-w-sm">
        <IconSearch size={14} className="faint pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Search contacts or companies…"
          aria-label="Search the pipeline"
          className="input input-sm pl-8"
          data-testid="pipeline-search"
        />
      </label>
      <button
        type="button"
        onClick={() => go({ quiet: !quiet })}
        aria-pressed={quiet}
        title={`Open opportunities with no call, text, email or meeting in ${quietDays} days`}
        className={`btn btn-sm ${quiet ? "btn-primary" : "btn-ghost"}`}
        data-testid="pipeline-quiet-toggle"
      >
        Gone quiet{quietCount ? ` (${quietCount})` : ""}
      </button>
      <button
        type="button"
        onClick={() => go({ decide: !decide })}
        aria-pressed={decide}
        title="Meetings that have passed with nobody saying how they went"
        className={`btn btn-sm ${decide ? "btn-primary" : "btn-ghost"}`}
        data-testid="pipeline-decide-toggle"
      >
        Needs a decision{decideCount ? ` (${decideCount})` : ""}
      </button>
      <MultiSelect
        label="Lead Label"
        values={picked}
        choices={labelChoices}
        onToggle={(value) => {
          const next = picked.includes(value) ? picked.filter((label) => label !== value) : [...picked, value];
          setPicked(next);
          go({ labels: next });
        }}
        onClear={() => {
          setPicked([]);
          go({ labels: [] });
        }}
        empty="No labels yet"
      />
      {filtered && (
        <>
          <span className="faint text-xs" data-testid="pipeline-shown">
            {shown === 1 ? "1 match" : `${shown} matches`}
          </span>
          <button
            type="button"
            onClick={() => {
              setTyped("");
              setPicked([]);
              go({ q: "", labels: [], quiet: false, decide: false });
            }}
            className="link text-xs"
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}
