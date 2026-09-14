"use client";

import { useActionState, useMemo, useState } from "react";
import { formatCents } from "@/lib/format";
import { ratesFor, timeEntryAmountCents, describeRates } from "@/lib/crews";
import { FormError, FormSuccess } from "@/components/ui";
import type { ActionState } from "@/lib/forms";
import { IconClock } from "@/components/icons";
import { logTime } from "./actions";

export type CrewChoice = {
  id: string;
  name: string;
  kind: string;
  hourlyRateCents: number | null;
  dailyRateCents: number | null;
  serviceTypes: string[];
  workers: { id: string; name: string; hourlyRateCents: number | null; dailyRateCents: number | null }[];
};

// Log a day's work. Hours, days, or both — a crew on site three days with
// four hours of overtime is one entry. The cost is worked out as you type
// so the number is never a surprise after the fact.
export function LogHoursForm({
  projectId,
  scopes,
  crews,
  today,
}: {
  projectId: string;
  scopes: { id: string; name: string; crewId: string | null }[];
  crews: CrewChoice[];
  today: string;
}) {
  const [state, action, pending] = useActionState(logTime, {});
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");
  const [workerId, setWorkerId] = useState("");
  const [hours, setHours] = useState("");
  const [days, setDays] = useState("");
  // The scope follows the crew: if this crew is on the roofing scope,
  // that is almost certainly what today's work was against. Still a
  // picker, so a day spent elsewhere is one change away.
  const scopeForCrew = (id: string) => scopes.find((scope) => scope.crewId === id)?.id ?? scopes[0]?.id ?? "";
  const [scopeId, setScopeId] = useState(() => scopeForCrew(crews[0]?.id ?? ""));

  // After a day is logged the amount has to go off the screen with it.
  // Hours and days are React state, so the form's own reset does not
  // touch them: the figure stayed in the box with the cost preview under
  // it while the note and the date cleared, which read as "nothing
  // saved" and invited a second press — a second charge on the job.
  const [handled, setHandled] = useState<ActionState | null>(state);
  if (state !== handled) {
    setHandled(state);
    if (state.success) {
      setHours("");
      setDays("");
    }
  }

  const crew = crews.find((entry) => entry.id === crewId) ?? null;
  const worker = crew?.workers.find((entry) => entry.id === workerId) ?? null;
  const subcontractor = crew?.kind === "SUBCONTRACTOR";

  const rates = useMemo(() => ratesFor(worker, crew), [worker, crew]);
  // What the entry will cost, or which rate is missing. Showing "$0.00"
  // for time against a crew with no matching rate reads as free work.
  const preview = useMemo(() => {
    const h = Number.parseFloat(hours) || 0;
    const d = Number.parseFloat(days) || 0;
    if (h <= 0 && d <= 0) return null;
    const who = worker?.name ?? crew?.name ?? "They";
    if (h > 0 && rates.hourlyRateCents === 0) return { missing: `${who} has no hourly rate on file.` };
    if (d > 0 && rates.dailyRateCents === 0) return { missing: `${who} has no day rate on file.` };
    return { cents: timeEntryAmountCents({ hours: h, days: d, ...rates }) };
  }, [hours, days, rates, worker, crew]);

  if (crews.length === 0) {
    return (
      <p className="muted text-sm" data-testid="no-crews">
        Build a crew first and its rates come with it — then logging a day here is two taps.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3" data-testid="log-time-form">
      <input type="hidden" name="projectId" value={projectId} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="log-crewId">
            Who worked
          </label>
          <select
            id="log-crewId"
            name="crewId"
            value={crewId}
            onChange={(event) => {
              setCrewId(event.target.value);
              setWorkerId("");
              setScopeId(scopeForCrew(event.target.value));
            }}
            className="select"
          >
            {crews.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
                {entry.kind === "SUBCONTRACTOR" ? " (sub)" : ""}
              </option>
            ))}
          </select>
          <p className="faint num mt-1 text-xs">{describeRates(rates, formatCents)}</p>
        </div>

        <div>
          <label className="label" htmlFor="log-workerId">
            Just one person?<span className="faint font-normal"> · optional</span>
          </label>
          <select
            id="log-workerId"
            name="workerId"
            value={workerId}
            onChange={(event) => setWorkerId(event.target.value)}
            className="select"
            disabled={!crew || crew.workers.length === 0}
          >
            <option value="">The whole crew</option>
            {crew?.workers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="log-workedOn">
            Day worked
          </label>
          <input
            id="log-workedOn"
            name="workedOn"
            type="date"
            defaultValue={today}
            className="input"
            data-testid="log-worked-on"
          />
        </div>

        <div>
          <label className="label" htmlFor="log-scopeId">
            On which scope
          </label>
          <select
            id="log-scopeId"
            name="scopeId"
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
            className="select"
            data-testid="log-scope"
          >
            {scopes.map((scope) => (
              <option key={scope.id} value={scope.id}>
                {scope.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="log-hours">
            Hours<span className="faint font-normal"> · optional</span>
          </label>
          <input
            id="log-hours"
            name="hours"
            inputMode="decimal"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            placeholder="7.5"
            className="input num"
            data-testid="log-hours"
          />
        </div>
        <div>
          <label className="label" htmlFor="log-days">
            Days<span className="faint font-normal"> · optional</span>
          </label>
          <input
            id="log-days"
            name="days"
            inputMode="decimal"
            value={days}
            onChange={(event) => setDays(event.target.value)}
            placeholder="1"
            className="input num"
            data-testid="log-days"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="log-note">
            What they did<span className="faint font-normal"> · optional</span>
          </label>
          <input
            id="log-note"
            name="note"
            placeholder="Rough-in on floors 2 and 3"
            className="input"
            data-testid="log-note"
          />
        </div>
      </div>

      {preview?.missing && (
        <p className="muted text-sm" data-testid="log-preview">
          {preview.missing} Add one on the crew, or log this in the other unit.
        </p>
      )}
      {preview?.cents !== undefined && (
        <p className="muted num text-sm" data-testid="log-preview">
          That is <span className="font-medium">{formatCents(preview.cents)}</span>
          {subcontractor ? " of their time, tracked only unless you tick the box below." : " on this job."}
        </p>
      )}

      {subcontractor && (
        <label className="flex items-start gap-2 text-xs" data-testid="log-counts-as-cost">
          <input type="checkbox" name="countsAsCost" className="mt-0.5" />
          <span className="muted">
            Count this as a cost on the budget. Only tick this if you are paying {crew?.name} by the hour with no
            purchase order — otherwise their order already covers it and this would charge the job twice.
          </span>
        </label>
      )}

      <FormError message={state.error} />
      <FormSuccess message={state.success} />

      <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="log-time-save">
        <IconClock size={13} />
        {pending ? "Logging…" : "Log the time"}
      </button>
    </form>
  );
}
