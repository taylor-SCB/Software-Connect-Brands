"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookingOptions, bookMeeting } from "../actions";
import { FormError } from "@/components/ui";
import { useContactPage } from "./contact-shell";
import { Chip, Sheet } from "./sheet";
import { dayChips, TIME_CHIPS } from "./day-chips";

type Options = Exclude<Awaited<ReturnType<typeof bookingOptions>>, { error: string }>;

// The Book meeting sheet (BDR redesign, R4): day chips, time chips, who
// else from their company, and Where / Note behind "+ details". If their
// company already has an open opportunity it asks "Add to the open …
// opportunity with …?" (Yes / New one). Saves with bookMeeting: "Meeting ·
// <name>" on the calendar, Meeting Set, the Pipeline tile and the booker
// kept on the meeting. The old ways to book (a Meeting logged ahead, +
// Event) stay.
export function BookMeetingSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const page = useContactPage();
  const chips = dayChips(page.today);
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [on, setOn] = useState(chips[0].on);
  const [picking, setPicking] = useState(false);
  const [time, setTime] = useState<string>("10:00");
  const [timePicking, setTimePicking] = useState(false);
  const [withIds, setWithIds] = useState<string[]>([]);
  const [opportunity, setOpportunity] = useState<string>("auto");
  const [details, setDetails] = useState(false);
  const [where, setWhere] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    bookingOptions(page.contactId).then((result) => {
      if (!live) return;
      if ("error" in result) setLoadError(result.error);
      else {
        setOptions(result);
        // An open opportunity they are already on is where it goes; one only
        // their company is on is asked about.
        const theirs = result.opportunities.find((row) => row.includesThem);
        setOpportunity(theirs ? theirs.id : result.opportunities[0] ? result.opportunities[0].id : "new");
      }
    });
    return () => {
      live = false;
    };
  }, [page.contactId]);

  const offered = options?.opportunities.find((row) => row.id === opportunity) ?? options?.opportunities[0] ?? null;

  function save() {
    setError(undefined);
    start(async () => {
      const result = await bookMeeting({
        contactId: page.contactId,
        on,
        time: time || undefined,
        withContactIds: withIds,
        where: where.trim() || undefined,
        note: note.trim() || undefined,
        opportunity: opportunity || "auto",
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      page.showToast({
        message: result.success ?? "Booked",
        batchId: result.batchId,
        href: "/dashboard/deals",
        hrefLabel: "Pipeline",
      });
      router.refresh();
    });
  }

  return (
    <Sheet title={`Book a meeting with ${page.firstName}`} subtitle="It goes on the calendar and the Pipeline." onClose={onClose} testId="book-sheet">
      <div className="space-y-4 p-5">
        <fieldset>
          <legend className="label">Day</legend>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Chip
                key={chip.on}
                on={!picking && on === chip.on}
                onClick={() => {
                  setPicking(false);
                  setOn(chip.on);
                }}
                testId={`book-day-${chip.on}`}
              >
                {chip.label}
              </Chip>
            ))}
            <Chip on={picking || !chips.some((chip) => chip.on === on)} onClick={() => setPicking(true)} testId="book-day-pick">
              Pick
            </Chip>
          </div>
          {(picking || !chips.some((chip) => chip.on === on)) && (
            <input
              type="date"
              value={on}
              min={page.today}
              onChange={(event) => setOn(event.target.value || page.today)}
              className="input input-sm mt-2 w-44"
              aria-label="Meeting day"
              data-testid="book-day-input"
            />
          )}
        </fieldset>

        <fieldset>
          <legend className="label">Time</legend>
          <div className="flex flex-wrap gap-1.5">
            {TIME_CHIPS.map((chip) => (
              <Chip
                key={chip.value}
                on={!timePicking && time === chip.value}
                onClick={() => {
                  setTimePicking(false);
                  setTime(chip.value);
                }}
                testId={`book-time-${chip.value}`}
              >
                {chip.label}
              </Chip>
            ))}
            <Chip on={timePicking} onClick={() => setTimePicking(true)} testId="book-time-pick">
              Pick
            </Chip>
          </div>
          {timePicking && (
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="input input-sm mt-2 w-36"
              aria-label="Meeting time"
              data-testid="book-time-input"
            />
          )}
        </fieldset>

        {loadError && <FormError message={loadError} />}

        {options && options.people.length > 0 && (
          <fieldset>
            <legend className="label">Who else is coming?</legend>
            <div className="flex flex-wrap gap-1.5">
              {options.people.slice(0, 12).map((person) => {
                const picked = withIds.includes(person.id);
                return (
                  <Chip
                    key={person.id}
                    on={picked}
                    onClick={() => setWithIds(picked ? withIds.filter((id) => id !== person.id) : [...withIds, person.id])}
                    testId="book-with"
                  >
                    {person.name}
                  </Chip>
                );
              })}
            </div>
          </fieldset>
        )}

        {options && options.opportunities.length > 0 && offered && (
          <fieldset data-testid="book-opportunity">
            <legend className="text-sm">
              Add to the open <strong>{offered.title}</strong> opportunity
              {offered.primaryName ? ` with ${offered.primaryName}` : ""}?
            </legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip on={opportunity !== "new"} onClick={() => setOpportunity(offered.id)} testId="book-opportunity-yes">
                Yes
              </Chip>
              <Chip on={opportunity === "new"} onClick={() => setOpportunity("new")} testId="book-opportunity-new">
                New one
              </Chip>
            </div>
          </fieldset>
        )}

        {details ? (
          <div className="space-y-2">
            <label className="block text-xs">
              <span className="faint mb-1 block">Where</span>
              <input value={where} onChange={(event) => setWhere(event.target.value)} maxLength={200} className="input input-sm" data-testid="book-where" />
            </label>
            <label className="block text-xs">
              <span className="faint mb-1 block">Note</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={2000} className="textarea" data-testid="book-note" />
            </label>
          </div>
        ) : (
          <button type="button" className="link text-xs" onClick={() => setDetails(true)} data-testid="book-details">
            + details
          </button>
        )}

        <FormError message={error} />
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--hairline-3)] bg-[var(--overlay)] px-5 py-3">
        <button type="button" onClick={onClose} className="btn btn-ghost pointer-coarse:min-h-11">
          Cancel
        </button>
        <button type="button" onClick={save} disabled={pending || !on} className="btn btn-primary pointer-coarse:min-h-11" data-testid="book-save">
          {pending ? "Booking…" : "Book it"}
        </button>
      </div>
    </Sheet>
  );
}
