"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconSearch, IconFilter } from "@/components/icons";
import { PAGE_SIZES, PROJECT_STAGES, PROJECT_STAGE_LABELS, type ProjectStageValue } from "@/lib/constants";

type State = {
  q: string;
  stages: ProjectStageValue[];
  serviceType: string;
  finished: boolean;
  per: number;
};

// The bar above the Projects list. Like the Contacts and Companies bars,
// every click is a new address, so the server filters and the view can be
// bookmarked or reached with Back.
export function ProjectFilters({
  q,
  stages,
  serviceType,
  finished,
  per,
  serviceTypes,
  allServiceTypes,
}: State & { serviceTypes: string[]; allServiceTypes: string[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic<State>({ q, stages, serviceType, finished, per });

  const go = (overrides: Partial<State>) =>
    startTransition(() => {
      const next = { ...shown, ...overrides };
      setShown(next);
      const search = new URLSearchParams();
      if (next.q) search.set("q", next.q);
      for (const stage of next.stages) search.append("stage", stage);
      if (next.serviceType) search.set("service", next.serviceType);
      if (next.finished) search.set("finished", "1");
      if (next.per !== 50) search.set("per", String(next.per));
      const query = search.toString();
      router.push(query ? `/dashboard/projects?${query}` : "/dashboard/projects");
    });

  // A picked service type that no job on this page uses would vanish from
  // the list and strand the filter, so keep it on offer.
  const typeChoices = Array.from(
    new Set([...serviceTypes, ...(shown.serviceType ? [shown.serviceType] : [])]),
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem("q") as HTMLInputElement;
          go({ q: input.value.trim() });
        }}
        className="relative"
        role="search"
      >
        <IconSearch
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
        />
        <input
          key={shown.q}
          type="search"
          name="q"
          defaultValue={shown.q}
          placeholder="Search jobs, customers, PRJ-1002…"
          aria-label="Search jobs"
          className="input input-sm w-64 pl-8"
        />
      </form>

      <div className="flex flex-wrap items-center gap-1">
        {PROJECT_STAGES.map((stage) => {
          const on = shown.stages.includes(stage);
          return (
            <button
              key={stage}
              type="button"
              onClick={() =>
                go({
                  stages: on ? shown.stages.filter((s) => s !== stage) : [...shown.stages, stage],
                })
              }
              data-testid={`stage-${stage}`}
              aria-pressed={on}
              className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}
            >
              {PROJECT_STAGE_LABELS[stage]}
            </button>
          );
        })}
      </div>

      {allServiceTypes.length > 0 && (
        <select
          value={shown.serviceType}
          onChange={(event) => go({ serviceType: event.target.value })}
          aria-label="Service type"
          className="select input-sm w-44"
          data-testid="filter-service-type"
        >
          <option value="">Any service type</option>
          {typeChoices.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      )}

      <button
        type="button"
        onClick={() => go({ finished: !shown.finished })}
        aria-pressed={shown.finished}
        data-testid="show-finished"
        className={`btn btn-sm ${shown.finished ? "btn-primary" : "btn-ghost"}`}
      >
        <IconFilter size={13} />
        Show finished
      </button>

      <label className="ml-auto flex items-center gap-1.5 text-xs">
        <span className="faint">Per page</span>
        <select
          value={shown.per}
          onChange={(event) => go({ per: Number(event.target.value) })}
          aria-label="Rows per page"
          className="select input-sm w-[4.75rem] py-1 pr-7"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
