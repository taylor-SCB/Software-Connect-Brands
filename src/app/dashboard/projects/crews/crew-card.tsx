"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { formatCents, centsToDollarInput } from "@/lib/format";
import { CREW_KIND_LABELS, describeRates, ratesFor } from "@/lib/crews";
import { Card, CardHeader, Badge, FormError } from "@/components/ui";
import { IconTrash, IconPlus, IconUserPlus } from "@/components/icons";
import type { ActionState } from "@/lib/forms";
import { CrewForm, type CrewValues } from "./crew-form";
import { deleteCrew, deleteWorker, saveWorker, setCrewActive, setWorkerActive } from "./actions";

export type WorkerView = {
  id: string;
  name: string;
  role: string | null;
  hourlyRateCents: number | null;
  dailyRateCents: number | null;
  phone: string | null;
  email: string | null;
  active: boolean;
};

export type CrewView = CrewValues & {
  active: boolean;
  company: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  workers: WorkerView[];
  // How much time they have logged, so retiring reads as a consequence
  // rather than a surprise.
  daysLogged: number;
};

type Choice = { id: string; name: string };

// One crew: what they cost, what they do, who is on it. Subcontractors
// carry the company that bills you, so their money stays in one place.
export function CrewCard({
  crew,
  companies,
  contacts,
  serviceTypes,
}: {
  crew: CrewView;
  companies: Choice[];
  contacts: Choice[];
  serviceTypes: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const run = (action: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setError(undefined);
      const result = await action();
      if (result?.error) setError(result.error);
    });

  const crewRates = { hourlyRateCents: crew.hourlyRateCents, dailyRateCents: crew.dailyRateCents };
  const onCrew = crew.workers.filter((worker) => worker.active);

  // The wrapper carries the test hook so a suite can scope to one crew:
  // the name lives in the card's header, which is a sibling of the body.
  return (
    <div data-testid="crew-card" data-crew-id={crew.id}>
      <Card lit={crew.active}>
        <CardHeader
          title={crew.name}
          subtitle={describeRates(
            { hourlyRateCents: crew.hourlyRateCents ?? 0, dailyRateCents: crew.dailyRateCents ?? 0 },
            formatCents,
          )}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge color={crew.kind === "SUBCONTRACTOR" ? "#a78bfa" : "#34d399"}>
                {CREW_KIND_LABELS[crew.kind as "OWN" | "SUBCONTRACTOR"]}
              </Badge>
              {!crew.active && <Badge color="#94a3b8">Retired</Badge>}
              <button
                type="button"
                onClick={() => setEditing(!editing)}
                className="btn btn-ghost btn-sm"
                data-testid="crew-edit"
              >
                {editing ? "Close" : "Edit"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setCrewActive(crew.id, !crew.active))}
                className="btn btn-ghost btn-sm"
                data-testid="crew-retire"
              >
                {crew.active ? "Retire" : "Bring back"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteCrew(crew.id))}
                aria-label={`Delete ${crew.name}`}
                className="btn btn-ghost btn-sm !px-1.5"
                data-testid="crew-delete"
              >
                <IconTrash size={13} />
              </button>
            </div>
          }
        />

        <div className="space-y-3 p-5">
          {editing ? (
            <CrewForm
              crew={crew}
              companies={companies}
              contacts={contacts}
              serviceTypes={serviceTypes}
              onDone={() => setEditing(false)}
            />
          ) : (
            <>
              {crew.serviceTypes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {crew.serviceTypes.map((name) => (
                    <Badge key={name} color="#818cf8">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {crew.company && (
                  <span className="muted">
                    Bills you as{" "}
                    <Link href={`/dashboard/companies/${crew.company.id}`} className="link">
                      {crew.company.name}
                    </Link>
                  </span>
                )}
                {crew.contact && (
                  <span className="muted">
                    Call{" "}
                    <Link href={`/dashboard/contacts/${crew.contact.id}`} className="link">
                      {crew.contact.name}
                    </Link>
                  </span>
                )}
                {crew.phone && <span className="muted num">{crew.phone}</span>}
                {crew.email && <span className="muted">{crew.email}</span>}
                {crew.daysLogged > 0 && (
                  <span className="muted num" data-testid="crew-days-logged">
                    {crew.daysLogged} {crew.daysLogged === 1 ? "entry" : "entries"} logged
                  </span>
                )}
              </div>

              {crew.notes && <p className="muted text-xs">{crew.notes}</p>}

              <div className="border-t border-[rgb(255_255_255/0.06)] pt-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="eyebrow">
                    {crew.kind === "SUBCONTRACTOR" ? "Their people" : "On this crew"}
                    {onCrew.length > 0 && ` · ${onCrew.length}`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setAddingPerson(!addingPerson)}
                    className="btn btn-ghost btn-sm"
                    data-testid="crew-add-person"
                  >
                    <IconUserPlus size={13} />
                    Add a person
                  </button>
                </div>

                {crew.workers.length === 0 ? (
                  <p className="faint text-xs">
                    Nobody on it yet. A crew works without names on it — time can be logged for the crew as a
                    whole.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {crew.workers.map((worker) => (
                      <WorkerRow key={worker.id} worker={worker} crewRates={crewRates} crewId={crew.id} />
                    ))}
                  </ul>
                )}

                {addingPerson && (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3">
                    <WorkerForm crewId={crew.id} onDone={() => setAddingPerson(false)} />
                  </div>
                )}
              </div>
            </>
          )}

          <FormError message={error} />
        </div>
      </Card>
    </div>
  );
}

// One person, with their own rate when they have one and the crew's when
// they do not — which is what the row says, so nobody has to guess which
// number a logged hour will use.
function WorkerRow({
  worker,
  crewRates,
  crewId,
}: {
  worker: WorkerView;
  crewRates: { hourlyRateCents: number | null; dailyRateCents: number | null };
  crewId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const effective = ratesFor(worker, crewRates);
  const ownRate = worker.hourlyRateCents !== null || worker.dailyRateCents !== null;

  const run = (action: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setError(undefined);
      const result = await action();
      if (result?.error) setError(result.error);
    });

  if (editing) {
    return (
      <li className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3">
        <WorkerForm crewId={crewId} worker={worker} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2" data-testid="worker-row">
      <div className="min-w-0">
        <p className="text-sm">
          {worker.name}
          {worker.role && <span className="faint"> · {worker.role}</span>}
          {!worker.active && <span className="faint"> · off the crew</span>}
        </p>
        <p className="faint num text-xs">
          {describeRates(effective, formatCents)}
          {!ownRate && effective.hourlyRateCents + effective.dailyRateCents > 0 && " (the crew's rate)"}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${worker.name}`}
          className="btn btn-ghost btn-sm"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setWorkerActive(worker.id, !worker.active))}
          className="btn btn-ghost btn-sm"
          data-testid="worker-toggle"
        >
          {worker.active ? "Take off" : "Put back"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteWorker(worker.id))}
          aria-label={`Delete ${worker.name}`}
          className="btn btn-ghost btn-sm !px-1.5"
        >
          <IconTrash size={13} />
        </button>
      </div>
      <FormError message={error} />
    </li>
  );
}

function WorkerForm({ crewId, worker, onDone }: { crewId: string; worker?: WorkerView; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveWorker, {});
  const id = (field: string) => `worker-${worker?.id ?? `new-${crewId}`}-${field}`;

  // Closes on a save that worked, and only then: a form that closed on a
  // timer would swallow the error telling you why nothing was saved.
  // Keyed on the state object rather than its message, so adding two
  // people in a row does not read as one.
  const [handled, setHandled] = useState<ActionState | null>(state);
  if (state !== handled) {
    setHandled(state);
    if (state.success) onDone();
  }

  return (
    <form action={action} className="space-y-2" data-testid="worker-form">
      <input type="hidden" name="crewId" value={crewId} />
      {worker && <input type="hidden" name="workerId" value={worker.id} />}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("name")}>
            Name
          </label>
          <input
            id={id("name")}
            name="name"
            defaultValue={worker?.name}
            required
            maxLength={80}
            className="input input-sm"
            data-testid="worker-name"
          />
        </div>
        <div>
          <label className="label" htmlFor={id("role")}>
            What they do<span className="faint font-normal"> · optional</span>
          </label>
          <input
            id={id("role")}
            name="role"
            defaultValue={worker?.role ?? ""}
            placeholder="Journeyman electrician"
            className="input input-sm"
          />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("hourlyRate")}>
            Their hourly rate<span className="faint font-normal"> · optional</span>
          </label>
          <input
            id={id("hourlyRate")}
            name="hourlyRate"
            inputMode="decimal"
            defaultValue={worker?.hourlyRateCents ? centsToDollarInput(worker.hourlyRateCents) : ""}
            placeholder="the crew's"
            className="input input-sm num"
            data-testid="worker-hourly"
          />
        </div>
        <div>
          <label className="label" htmlFor={id("dailyRate")}>
            Their day rate<span className="faint font-normal"> · optional</span>
          </label>
          <input
            id={id("dailyRate")}
            name="dailyRate"
            inputMode="decimal"
            defaultValue={worker?.dailyRateCents ? centsToDollarInput(worker.dailyRateCents) : ""}
            placeholder="the crew's"
            className="input input-sm num"
          />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("phone")}>
            Phone<span className="faint font-normal"> · optional</span>
          </label>
          <input id={id("phone")} name="phone" defaultValue={worker?.phone ?? ""} className="input input-sm" />
        </div>
        <div>
          <label className="label" htmlFor={id("email")}>
            Email<span className="faint font-normal"> · optional</span>
          </label>
          <input id={id("email")} name="email" defaultValue={worker?.email ?? ""} className="input input-sm" />
        </div>
      </div>
      <FormError message={state.error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="worker-save">
          {pending ? "Saving…" : worker ? "Save" : "Add"}
        </button>
        <button type="button" onClick={onDone} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

// "+ New crew" and the form it opens.
export function NewCrewButton({
  companies,
  contacts,
  serviceTypes,
}: {
  companies: Choice[];
  contacts: Choice[];
  serviceTypes: string[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary btn-sm" data-testid="new-crew">
        <IconPlus size={13} />
        New crew
      </button>
    );
  }

  return (
    <Card lit>
      <CardHeader title="New crew" subtitle="Your own people, or a subcontractor who bills you." />
      <div className="p-5">
        <CrewForm
          companies={companies}
          contacts={contacts}
          serviceTypes={serviceTypes}
          onDone={() => setOpen(false)}
        />
      </div>
    </Card>
  );
}
