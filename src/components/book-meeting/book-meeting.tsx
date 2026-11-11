"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookMeeting } from "@/app/dashboard/contacts/actions";
import { bookingChoices } from "@/components/how-did-it-go/actions";
import { Chip, ChipGrid, Sheet } from "@/components/how-did-it-go/sheet";
import { UndoToast } from "@/components/how-did-it-go/undo-toast";
import { TIME_CHIPS, browserToday, dayChips, longDay, whenWords } from "@/components/how-did-it-go/dates";
import { FormError } from "@/components/ui";
import { pipelineHref } from "@/lib/pipeline-link";
import { IconCalendar } from "@/components/icons";

// The Book meeting sheet (BDR redesign, Nov 11, 2026; the four old ways to
// book stay): day chips, time chips, who else at the company, Where and
// Note behind "+ details", and "Add to the open Ironwood opportunity with
// Chase?" Yes / New one. It writes "Meeting · <name>" on the calendar and
// runs the same steps as every meeting (Meeting Set, the opportunity, the
// booker kept on it), then says so: "Booked Tue, Nov 17, 10:00 AM · Kristen
// is on your Pipeline in Meeting Set →" ("the Pipeline" when the tile is a
// teammate's), the link opening that tile.

export type BookingValue = {
  on: string;
  time: string;
  withContactIds: string[];
  where: string;
  note: string;
  // "auto" (an open one any of them is on), "new", or an opportunity id.
  opportunity: string;
};

export const EMPTY_BOOKING: BookingValue = { on: "", time: "", withContactIds: [], where: "", note: "", opportunity: "auto" };

type Choices = Extract<Awaited<ReturnType<typeof bookingChoices>>, { today: string }>;

// The fields, shared by this sheet and the "Meeting booked" step of How
// did it go?. Reads its choices for `contactId` (who else, open
// opportunities); `who` / `opportunity` off for a reschedule. `offer`: the
// tile the host is on (the Pipeline panel), offered first.
export function BookMeetingFields({
  contactId,
  today,
  value,
  onChange,
  who = true,
  opportunity = true,
  offer = null,
  onChoices,
}: {
  contactId: string | null;
  today: string;
  value: BookingValue;
  onChange: (next: BookingValue) => void;
  who?: boolean;
  opportunity?: boolean;
  offer?: string | null;
  onChoices?: (choices: Choices) => void;
}) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [pickDay, setPickDay] = useState(false);
  const [pickTime, setPickTime] = useState(false);
  const [details, setDetails] = useState(Boolean(value.where || value.note));
  const set = (patch: Partial<BookingValue>) => onChange({ ...value, ...patch });

  useEffect(() => {
    if (!contactId || (!who && !opportunity)) return;
    let live = true;
    bookingChoices(contactId, offer).then((answer) => {
      if (!live || "error" in answer) return;
      setChoices(answer);
      onChoices?.(answer);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per person
  }, [contactId, who, opportunity, offer]);

  // The host's tile, else the open opportunity they're already on (else
  // the newest at their company), is the one offered first.
  const opportunities = choices?.opportunities ?? [];
  const offered =
    (offer ? opportunities.find((row) => row.id === offer) : undefined) ??
    opportunities.find((row) => row.includesThem) ??
    opportunities[0] ??
    null;
  useEffect(() => {
    if (offered && value.opportunity === "auto") onChange({ ...value, opportunity: offered.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once the choices land
  }, [offered?.id]);

  const days = dayChips(today);
  const chipDay = days.some((day) => day.on === value.on);
  const chipTime = TIME_CHIPS.some((time) => time.value === value.time);

  return (
    <div className="space-y-4" data-testid="book-meeting-fields">
      <fieldset className="space-y-2" data-testid="book-days" data-days={days.map((day) => day.on).join(",")}>
        <legend className="mb-2 text-sm font-medium">Which day?</legend>
        <ChipGrid label="Day">
          {days.map((day) => (
            <Chip key={day.key} on={value.on === day.on && !pickDay} sub={day.sub} onClick={() => { setPickDay(false); set({ on: day.on }); }} testId={`book-day-${day.key}`}>
              {day.label}
            </Chip>
          ))}
          <Chip on={pickDay || (Boolean(value.on) && !chipDay)} onClick={() => setPickDay(true)} testId="book-day-pick" sub={value.on && !chipDay ? longDay(value.on) : undefined}>
            Pick
          </Chip>
        </ChipGrid>
        {(pickDay || (value.on && !chipDay)) && (
          <input
            type="date"
            min={today}
            value={value.on}
            onChange={(event) => set({ on: event.target.value })}
            aria-label="Meeting day"
            className="input input-sm max-w-[12rem]"
            data-testid="book-day-input"
          />
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">
          What time? <span className="faint font-normal">optional</span>
        </legend>
        <div role="group" aria-label="Time" className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          {TIME_CHIPS.map((time) => (
            <Chip
              key={time.value}
              on={value.time === time.value && !pickTime}
              onClick={() => {
                setPickTime(false);
                set({ time: value.time === time.value ? "" : time.value });
              }}
              testId={`book-time-${time.value}`}
            >
              {time.label}
            </Chip>
          ))}
          <Chip on={pickTime || (Boolean(value.time) && !chipTime)} onClick={() => setPickTime(true)} testId="book-time-pick">
            Pick
          </Chip>
        </div>
        {(pickTime || (value.time && !chipTime)) && (
          <input type="time" value={value.time} onChange={(event) => set({ time: event.target.value })} aria-label="Meeting time" className="input input-sm max-w-[10rem]" data-testid="book-time-input" />
        )}
      </fieldset>

      {who && choices && choices.people.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">
            Who else is coming? <span className="faint font-normal">optional</span>
          </legend>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Who else">
            {choices.people.map((person) => {
              const on = value.withContactIds.includes(person.id);
              return (
                <Chip
                  key={person.id}
                  role="checkbox"
                  on={on}
                  sub={person.title ?? undefined}
                  onClick={() =>
                    set({ withContactIds: on ? value.withContactIds.filter((id) => id !== person.id) : [...value.withContactIds, person.id] })
                  }
                  testId="book-who"
                >
                  {person.name}
                </Chip>
              );
            })}
          </div>
        </fieldset>
      )}

      {opportunity && offered && (
        <fieldset className="space-y-2" data-testid="book-opportunity" data-offered={offered.id}>
          <legend className="mb-2 text-sm font-medium">
            Add to the open {offered.title} opportunity{offered.primaryName ? ` with ${offered.primaryName}` : ""}?
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Which opportunity">
            {opportunities.map((row) => (
              <Chip
                key={row.id}
                role="radio"
                on={value.opportunity === row.id}
                onClick={() => set({ opportunity: row.id })}
                sub={row.id === offered.id ? undefined : [row.primaryName && `with ${row.primaryName}`, row.ownerName].filter(Boolean).join(" · ") || undefined}
                testId={row.id === offered.id ? "book-opp-yes" : "book-opp-other"}
              >
                {row.id === offered.id ? "Yes" : row.title}
              </Chip>
            ))}
            <Chip role="radio" on={value.opportunity === "new"} onClick={() => set({ opportunity: "new" })} testId="book-opp-new">
              New one
            </Chip>
          </div>
        </fieldset>
      )}

      {details ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block min-w-0 text-xs">
            <span className="faint mb-1 block">Where</span>
            <input value={value.where} maxLength={200} onChange={(event) => set({ where: event.target.value })} placeholder="Their office" className="input input-sm" data-testid="book-where" />
          </label>
          <label className="block min-w-0 text-xs sm:col-span-2">
            <span className="faint mb-1 block">Note</span>
            <textarea value={value.note} maxLength={2000} rows={2} onChange={(event) => set({ note: event.target.value })} className="textarea" data-testid="book-note" />
          </label>
        </div>
      ) : (
        <button type="button" onClick={() => setDetails(true)} className="btn btn-ghost btn-sm min-h-11 sm:min-h-0" data-testid="book-details-toggle">
          + details
        </button>
      )}
    </div>
  );
}

// The Book meeting sheet on its own: for the contact header, a company's
// Who to call rows, Up next rows and the Pipeline panel. Saves through
// bookMeeting (its own save, with "Saved · Undo").
export type BookMeetingSheetProps = {
  open: boolean;
  onClose: () => void;
  contactId: string;
  // Shown in the title while the sheet reads the rest.
  name?: string;
  today?: string;
  // The tile it was opened from (the Pipeline panel), offered and picked
  // first; else the open one they're on.
  opportunityId?: string | null;
  onBooked?: (result: { batchId: string; opportunityId: string | null; eventId: string | null; message: string }) => void;
  // Anything written: the booking, and its Undo from the toast.
  onChanged?: () => void;
  // The host draws "Saved · Undo" itself (one toast slot on its screen).
  onToast?: (toast: { batchId: string; words: string; href: string | null; hrefLabel?: string; opportunityId: string | null }) => void;
};

type BookToast = { batchId: string; words: string; href: string; hrefLabel: string; at: number; opportunityId: string | null };

export function BookMeetingSheet(props: BookMeetingSheetProps) {
  const [saved, setSaved] = useState<BookToast | null>(null);
  const dismiss = useCallback(() => setSaved(null), []);
  const { onToast, onChanged } = props;
  const show = useCallback(
    (toast: BookToast) => {
      onChanged?.();
      if (onToast) onToast(toast);
      else setSaved(toast);
    },
    [onToast, onChanged],
  );
  return (
    <>
      {/* Drawn only while open, so every opening starts fresh. */}
      {props.open && <BookSheetBody {...props} onSaved={show} />}
      <UndoToast saved={saved} onDone={dismiss} onUndone={onChanged} />
    </>
  );
}

function BookSheetBody({
  onClose,
  contactId,
  name,
  today,
  opportunityId = null,
  onBooked,
  onSaved,
}: BookMeetingSheetProps & { onSaved: (toast: BookToast) => void }) {
  const router = useRouter();
  const [value, setValue] = useState<BookingValue>(opportunityId ? { ...EMPTY_BOOKING, opportunity: opportunityId } : EMPTY_BOOKING);
  const [fallbackToday] = useState(browserToday);
  const [day, setDay] = useState(today ?? "");
  const [who, setWho] = useState(name ?? "");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const book = () =>
    start(async () => {
      setError(undefined);
      const result = await bookMeeting({
        contactId,
        on: value.on,
        time: value.time || undefined,
        withContactIds: value.withContactIds,
        where: value.where || undefined,
        note: value.note || undefined,
        opportunity: value.opportunity,
      });
      if (result.error || !result.batchId) {
        setError(result.error ?? "That couldn't be booked");
        return;
      }
      const first = (who || name || "They").split(/\s+/)[0];
      // "the Pipeline" when the tile is a teammate's (Mine won't show it).
      const message = `Booked ${whenWords(value.on, value.time || null)} · ${first} is on ${result.yours === false ? "the" : "your"} Pipeline in Meeting Set`;
      const tile = result.opportunityId ?? null;
      onSaved({ batchId: result.batchId, words: message, href: pipelineHref(tile), hrefLabel: "Pipeline →", at: Date.now(), opportunityId: tile });
      onBooked?.({ batchId: result.batchId, opportunityId: result.opportunityId ?? null, eventId: result.eventId ?? null, message });
      router.refresh();
      onClose();
    });

  const first = (who || "them").split(/\s+/)[0];
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Book a meeting with ${first}`}
      testId="book-meeting"
      footer={
        <div className="space-y-2">
          <FormError message={error} />
          <button
            type="button"
            onClick={book}
            disabled={pending || !value.on}
            className="btn btn-primary min-h-12 w-full sm:min-h-11"
            data-testid="book-submit"
          >
            <IconCalendar size={14} />
            {pending ? "Booking…" : value.on ? `Book it · ${longDay(value.on)}` : "Pick a day"}
          </button>
        </div>
      }
    >
      <BookMeetingFields
        contactId={contactId}
        today={day || fallbackToday}
        value={value}
        onChange={setValue}
        offer={opportunityId}
        onChoices={(choices) => {
          setDay(choices.today);
          setWho(choices.name);
        }}
      />
    </Sheet>
  );
}

export type BookTarget = { contactId: string; name?: string; today?: string; opportunityId?: string | null };

// For other screens: const book = useBookMeeting(); book.open({ contactId,
// name, opportunityId? }); and render {book.element} once.
export function useBookMeeting(defaults?: Pick<BookMeetingSheetProps, "onBooked" | "onChanged" | "onToast">) {
  const [target, setTarget] = useState<BookTarget | null>(null);
  const [open, setOpen] = useState(false);
  const openSheet = useCallback((next: BookTarget) => {
    setTarget(next);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const element = target ? (
    <BookMeetingSheet
      open={open}
      onClose={close}
      contactId={target.contactId}
      name={target.name}
      today={target.today}
      opportunityId={target.opportunityId ?? null}
      onBooked={defaults?.onBooked}
      onChanged={defaults?.onChanged}
      onToast={defaults?.onToast}
    />
  ) : null;
  return { open: openSheet, close, element, isOpen: open };
}
