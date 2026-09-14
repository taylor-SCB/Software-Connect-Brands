"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { FormError } from "@/components/ui";
import { saveEvent } from "./actions";

export type EventFormValues = {
  id: string;
  title: string;
  type: string;
  startOn: string;
  endOn: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  notes: string;
  projectId: string | null;
  scopeId: string | null;
  companyId: string | null;
  contactId: string | null;
  crewId: string | null;
  attendeeIds: string[];
  // What the job and the crew are called, so the form can offer them as
  // options even when they are no longer on the pickers' lists — a
  // finished job, a retired crew. Without these the <select> fell back
  // to its first option and quietly unlinked them on any save.
  projectLabel?: string | null;
  projectNumber?: number | null;
  scopeName?: string | null;
  crewName?: string | null;
};

export type EventChoices = {
  eventTypes: string[];
  crews: { id: string; name: string; kind: string }[];
  // Open jobs, with their scopes, so an install can be pinned to the
  // roofing half rather than the whole thing.
  projects: { id: string; label: string; scopes: { id: string; name: string; isDefault: boolean }[] }[];
  contacts: { id: string; name: string }[];
  companies: { id: string; name: string }[];
};

// One form for every kind of day. What it is tied to is all optional: a
// site walk happens before there is a job, and a coffee with a contact
// belongs to nothing at all.
export function EventForm({
  event,
  choices,
  defaults,
  onDone,
}: {
  event?: EventFormValues;
  choices: EventChoices;
  // What the screen it opened from already knows — the day clicked, the
  // job being looked at — so those fields come pre-filled.
  defaults?: { startOn?: string; projectId?: string; contactId?: string; companyId?: string; type?: string };
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(saveEvent, {});
  const [type, setType] = useState(event?.type ?? defaults?.type ?? choices.eventTypes[0] ?? "");
  const [addingType, setAddingType] = useState(false);
  const [projectId, setProjectId] = useState(event?.projectId ?? defaults?.projectId ?? "");
  const [multiDay, setMultiDay] = useState(Boolean(event?.endOn));
  const [timed, setTimed] = useState(Boolean(event?.startTime || event?.endTime));
  const [attendees, setAttendees] = useState<string[]>(event?.attendeeIds ?? []);
  // Unique per rendered form, not per event: the calendar can have the
  // toolbar's new-event form and a day panel's open at once, and two
  // controls sharing an id sent a click on one label to the other form.
  const formId = useId();
  const id = (field: string) => `event-${event?.id ?? formId}-${field}`;

  // What was typed, handed back when the server refused the save. React
  // empties a form whose action is a server function, so without this a
  // wrong finish time threw away the whole event.
  const kept = state.kept ?? {};
  const was = (field: string, fallback: string) => kept[field] ?? fallback;

  const project = choices.projects.find((entry) => entry.id === projectId) ?? null;
  const scopes = project?.scopes.filter((scope) => !scope.isDefault) ?? [];

  // A job that is finished, or a crew that has been retired, is not on
  // the pickers any more. Saving the form must not be what unlinks it,
  // so each is added back as an option and labelled for what it is.
  const missingProject =
    event?.projectId && !choices.projects.some((entry) => entry.id === event.projectId)
      ? {
          id: event.projectId,
          label: event.projectNumber
            ? `PRJ-${event.projectNumber} · ${event.projectLabel ?? "this job"} (finished)`
            : `${event.projectLabel ?? "This job"} (finished)`,
        }
      : null;
  const missingCrew =
    event?.crewId && !choices.crews.some((entry) => entry.id === event.crewId)
      ? { id: event.crewId, label: `${event.crewName ?? "That crew"} (retired)` }
      : null;
  // Its scope is not on any list when its job is not, so it rides along
  // on a hidden field instead of being blanked.
  const keepScope = missingProject !== null && projectId === event?.projectId;

  useEffect(() => {
    if (state.success && onDone) onDone();
  }, [state.success, onDone]);

  const toggleAttendee = (contactId: string) =>
    setAttendees((current) =>
      current.includes(contactId) ? current.filter((value) => value !== contactId) : [...current, contactId],
    );

  return (
    <form action={action} className="space-y-3" data-testid="event-form">
      {event && <input type="hidden" name="eventId" value={event.id} />}
      {attendees.map((contactId) => (
        <input key={contactId} type="hidden" name="attendees" value={contactId} />
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("title")}>
            What is it
          </label>
          <input
            id={id("title")}
            name="title"
            defaultValue={was("title", event?.title ?? "")}
            required
            maxLength={160}
            placeholder="Site walk with the property manager"
            className="input"
            data-testid="event-title"
          />
        </div>
        <div>
          <label className="label" htmlFor={id("type")}>
            What kind of day
          </label>
          {addingType ? (
            <input
              id={id("type")}
              name="type"
              defaultValue=""
              required
              maxLength={60}
              autoFocus
              placeholder="Warranty visit"
              className="input"
              data-testid="event-type-new"
            />
          ) : (
            <select
              id={id("type")}
              name="type"
              value={type}
              onChange={(fired) => {
                if (fired.target.value === "__new__") {
                  setAddingType(true);
                  return;
                }
                setType(fired.target.value);
              }}
              className="select"
              data-testid="event-type"
            >
              {choices.eventTypes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value="__new__">+ Add new event type</option>
            </select>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor={id("startOn")}>
            {multiDay ? "First day" : "Day"}
          </label>
          <input
            id={id("startOn")}
            name="startOn"
            type="date"
            required
            defaultValue={was("startOn", event?.startOn ?? defaults?.startOn ?? "")}
            className="input"
            data-testid="event-start-on"
          />
        </div>
        {multiDay ? (
          <div>
            <label className="label" htmlFor={id("endOn")}>
              Last day
            </label>
            <input
              id={id("endOn")}
              name="endOn"
              type="date"
              defaultValue={was("endOn", event?.endOn ?? "")}
              className="input"
              data-testid="event-end-on"
            />
          </div>
        ) : (
          <input type="hidden" name="endOn" value="" />
        )}
        {timed && (
          <>
            <div>
              <label className="label" htmlFor={id("startTime")}>
                Starts<span className="faint font-normal"> · optional</span>
              </label>
              <input
                id={id("startTime")}
                name="startTime"
                type="time"
                defaultValue={was("startTime", event?.startTime ?? "")}
                className="input"
                data-testid="event-start-time"
              />
            </div>
            <div>
              <label className="label" htmlFor={id("endTime")}>
                Finishes<span className="faint font-normal"> · optional</span>
              </label>
              <input
                id={id("endTime")}
                name="endTime"
                type="time"
                defaultValue={was("endTime", event?.endTime ?? "")}
                className="input"
                data-testid="event-end-time"
              />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={multiDay}
            onChange={(fired) => setMultiDay(fired.target.checked)}
            data-testid="event-multi-day"
          />
          <span className="muted">Runs more than one day</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={timed}
            onChange={(fired) => setTimed(fired.target.checked)}
            data-testid="event-timed"
          />
          <span className="muted">Put a time on it</span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="label" htmlFor={id("crewId")}>
            Who is going<span className="faint font-normal"> · optional</span>
          </label>
          <select
            id={id("crewId")}
            name="crewId"
            defaultValue={event?.crewId ?? ""}
            className="select"
            data-testid="event-crew"
          >
            <option value="">Nobody assigned</option>
            {missingCrew && <option value={missingCrew.id}>{missingCrew.label}</option>}
            {choices.crews.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.name}
                {crew.kind === "SUBCONTRACTOR" ? " (sub)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={id("projectId")}>
            On which job<span className="faint font-normal"> · optional</span>
          </label>
          <select
            id={id("projectId")}
            name="projectId"
            value={projectId}
            onChange={(fired) => setProjectId(fired.target.value)}
            className="select"
            data-testid="event-project"
          >
            <option value="">Not tied to a job</option>
            {missingProject && <option value={missingProject.id}>{missingProject.label}</option>}
            {choices.projects.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        {scopes.length > 0 ? (
          <div>
            <label className="label" htmlFor={id("scopeId")}>
              Which part of it<span className="faint font-normal"> · optional</span>
            </label>
            <select
              id={id("scopeId")}
              name="scopeId"
              defaultValue={event?.scopeId ?? ""}
              className="select"
              data-testid="event-scope"
            >
              <option value="">The whole job</option>
              {scopes.map((scope) => (
                <option key={scope.id} value={scope.id}>
                  {scope.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="scopeId" value={keepScope ? (event?.scopeId ?? "") : ""} />
        )}
        <div className={scopes.length > 0 ? "sm:col-span-2 lg:col-span-3" : ""}>
          <label className="label" htmlFor={id("location")}>
            Where<span className="faint font-normal"> · optional</span>
          </label>
          <input
            id={id("location")}
            name="location"
            defaultValue={was("location", event?.location ?? "")}
            maxLength={200}
            placeholder={project ? "The job's site address, unless you say otherwise" : "1400 Harbor Blvd, Tampa"}
            className="input"
            data-testid="event-location"
          />
        </div>
      </div>

      {choices.contacts.length > 0 && (
        <div>
          <p className="label">
            Who else is expected<span className="faint font-normal"> · optional</span>
          </p>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto" data-testid="event-attendees">
            {choices.contacts.map((contact) => {
              const on = attendees.includes(contact.id);
              return (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => toggleAttendee(contact.id)}
                  aria-pressed={on}
                  className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}
                >
                  {contact.name}
                </button>
              );
            })}
          </div>
          <p className="faint mt-1 text-xs">
            The property manager, the homeowner, the owner&apos;s superintendent — whoever is meant to be there.
          </p>
        </div>
      )}

      <div>
        <label className="label" htmlFor={id("notes")}>
          Notes<span className="faint font-normal"> · optional</span>
        </label>
        <textarea
          id={id("notes")}
          name="notes"
          rows={2}
          defaultValue={was("notes", event?.notes ?? "")}
          placeholder="Gate code 4412. Park on the north side."
          className="textarea"
          data-testid="event-notes"
        />
      </div>

      {/* Kept on the form so the screen it opened from stays the answer
          for who the day is with, even when the picker is not shown. */}
      <input type="hidden" name="contactId" value={event?.contactId ?? defaults?.contactId ?? ""} />
      <input type="hidden" name="companyId" value={event?.companyId ?? defaults?.companyId ?? ""} />

      <FormError message={state.error} />

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="event-save">
          {pending ? "Saving…" : event ? "Save changes" : "Put it on the calendar"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="btn btn-ghost btn-sm">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
