"use client";

import { useState, useTransition } from "react";
import { formatCents } from "@/lib/format";
import { describeRates } from "@/lib/crews";
import { FormError } from "@/components/ui";
import { assignCrewToScope } from "../../crews/actions";

type Crew = {
  id: string;
  name: string;
  kind: string;
  serviceTypes: string[];
  hourlyRateCents: number | null;
  dailyRateCents: number | null;
};

// Who is on this scope of work. The crews that do this kind of work come
// first, because on a job with a smart-lock half and an access-control
// half nobody wants to read the whole list twice.
export function ScopeCrewPicker({
  scope,
  crews,
}: {
  scope: {
    id: string;
    name: string;
    serviceType: string | null;
    crewId: string | null;
    crewLabel: string | null;
    // The crew as stored, even if it has since been retired: a crew
    // leaving mid-job must not make this row read "Nobody assigned"
    // while the Budget tab still names them.
    crewName: string | null;
    crewActive: boolean;
  };
  crews: Crew[];
}) {
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const suited = scope.serviceType
    ? crews.filter((crew) => crew.serviceTypes.includes(scope.serviceType!))
    : [];
  const others = crews.filter((crew) => !suited.includes(crew));
  const current = crews.find((crew) => crew.id === scope.crewId) ?? null;
  const retired = scope.crewId && !current ? { id: scope.crewId, name: scope.crewName ?? "That crew" } : null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" data-testid="scope-crew">
      <div className="min-w-0">
        <p className="text-sm font-medium">{scope.name}</p>
        <p className="faint num text-xs">
          {current
            ? describeRates(
                {
                  hourlyRateCents: current.hourlyRateCents ?? 0,
                  dailyRateCents: current.dailyRateCents ?? 0,
                },
                formatCents,
              )
            : retired
              ? `${retired.name} — retired, still on this scope`
              : scope.crewLabel
                ? `${scope.crewLabel} — typed by hand, not a crew on the list`
                : "Nobody assigned"}
        </p>
      </div>
      <div>
        <select
          value={scope.crewId ?? ""}
          disabled={pending}
          onChange={(event) =>
            start(async () => {
              setError(undefined);
              const result = await assignCrewToScope(scope.id, event.target.value);
              if (result?.error) setError(result.error);
            })
          }
          aria-label={`Crew on ${scope.name}`}
          id={`scope-${scope.id}-crew`}
          className="select input-sm w-52"
          data-testid="scope-crew-select"
        >
          <option value="">Nobody yet</option>
          {retired && <option value={retired.id}>{retired.name} (retired)</option>}
          {suited.length > 0 && (
            <optgroup label={`Does ${scope.serviceType}`}>
              {suited.map((crew) => (
                <option key={crew.id} value={crew.id}>
                  {crew.name}
                  {crew.kind === "SUBCONTRACTOR" ? " (sub)" : ""}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label={suited.length > 0 ? "Everyone else" : "Crews"}>
              {others.map((crew) => (
                <option key={crew.id} value={crew.id}>
                  {crew.name}
                  {crew.kind === "SUBCONTRACTOR" ? " (sub)" : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <FormError message={error} />
      </div>
    </li>
  );
}
