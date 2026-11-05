"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MultiSelect } from "@/components/list-filters";
import { IconSearch } from "@/components/icons";

// The Pipeline's search and Lead Label filter (Oct 27, 2026). The search
// finds a tile by any listed person's name or company, or its own name;
// the labels stack, N/A being the tiles with none. Both live in the
// address bar, so a filtered board can be bookmarked or shared.
export function PipelineFilters({
  q,
  labels,
  labelChoices,
  shown,
}: {
  q: string;
  labels: string[];
  labelChoices: string[];
  shown: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [typed, setTyped] = useState(q);
  // Ticked in this tab, until the page answers with the new filter.
  const [ticked, setTicked] = useState({ base: labels, values: labels });
  const picked = ticked.base === labels ? ticked.values : labels;
  const setPicked = (values: string[]) => setTicked({ base: labels, values });

  function go(next: { q?: string; labels?: string[] }) {
    const query = new URLSearchParams(params.toString());
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

  const filtered = Boolean(q) || labels.length > 0;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="pipeline-filters">
      <label className="relative min-w-[14rem] flex-1 sm:max-w-sm">
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
              go({ q: "", labels: [] });
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
