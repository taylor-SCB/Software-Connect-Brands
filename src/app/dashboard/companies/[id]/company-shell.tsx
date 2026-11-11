"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconX } from "@/components/icons";
import { FormError } from "@/components/ui";
import { bookMeeting, bookingOptions, undoLog } from "@/app/dashboard/contacts/actions";

// The company page's moving parts (BDR redesign, Nov 11, 2026) share one
// small state: which person's Book meeting sheet is open, whether Log a
// touch and the header's ⋯ More are open, which Who to call row has its
// log open, and the "Saved · Undo" line after a save. The header's main
// button, the meter's next step, the Who to call rows and the phone's
// sticky bar all reach the same sheet and the same toggles through it.

export type BookPerson = { id: string; name: string; title: string | null };

type Saved = { message: string; batchId?: string | null; href?: { label: string; to: string } | null };

type Shell = {
  book: (contactId?: string | null) => void;
  logOpen: boolean;
  setLogOpen: (open: boolean) => void;
  openLog: () => void;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  openMore: () => void;
  rowLog: string | null;
  setRowLog: (id: string | null) => void;
  saved: (saved: Saved) => void;
};

const ShellContext = createContext<Shell | null>(null);

export function useCompanyShell() {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useCompanyShell outside CompanyShell");
  return shell;
}

// Scrolls a section into view the frame after it opens.
function reveal(id: string) {
  requestAnimationFrame(() => {
    const element = document.getElementById(id);
    if (!element) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  });
}

export function CompanyShell({
  people,
  today,
  children,
}: {
  people: BookPerson[];
  // yyyy-mm-dd on the workspace's clock.
  today: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [booking, setBooking] = useState<{ contactId: string | null; key: number } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [rowLog, setRowLog] = useState<string | null>(null);
  const [toast, setToast] = useState<(Saved & { key: number }) | null>(null);

  const book = useCallback((contactId?: string | null) => setBooking({ contactId: contactId ?? null, key: Date.now() }), []);
  const openLog = useCallback(() => {
    setLogOpen(true);
    reveal("log");
  }, []);
  const openMore = useCallback(() => {
    setMoreOpen(true);
    reveal("company-header");
  }, []);
  const saved = useCallback(
    (next: Saved) => {
      setToast({ ...next, key: Date.now() });
      router.refresh();
    },
    [router],
  );

  const value = useMemo(
    () => ({ book, logOpen, setLogOpen, openLog, moreOpen, setMoreOpen, openMore, rowLog, setRowLog, saved }),
    [book, logOpen, openLog, moreOpen, openMore, rowLog, saved],
  );

  return (
    <ShellContext.Provider value={value}>
      {children}
      {booking && (
        <BookMeetingSheet
          key={booking.key}
          people={people}
          today={today}
          initial={booking.contactId}
          onClose={() => setBooking(null)}
          onBooked={(message, batchId) => {
            setBooking(null);
            saved({ message, batchId, href: { label: "Pipeline", to: "/dashboard/deals" } });
          }}
        />
      )}
      {toast && <SavedToast key={toast.key} saved={toast} onDone={() => setToast(null)} />}
    </ShellContext.Provider>
  );
}

// "Saved · Undo" for ten seconds after a save from this page. Undo takes
// the whole save back (undoLog).
function SavedToast({ saved, onDone }: { saved: Saved; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  useEffect(() => {
    const timer = setTimeout(onDone, error ? 15_000 : 10_000);
    return () => clearTimeout(timer);
  }, [onDone, error]);
  return createPortal(
    <div
      role="status"
      className="popover card fixed inset-x-4 bottom-20 z-[60] mx-auto flex max-w-lg flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-4 py-3 text-sm lg:bottom-6"
      data-testid="company-saved"
    >
      <span className="min-w-0 flex-1">{saved.message}</span>
      {saved.href && (
        <Link href={saved.href.to} className="link shrink-0 text-sm">
          {saved.href.label} →
        </Link>
      )}
      {saved.batchId && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await undoLog(saved.batchId!);
              if (result.error) {
                setError(result.error);
                return;
              }
              router.refresh();
              onDone();
            })
          }
          className="btn btn-ghost btn-sm shrink-0 pointer-coarse:min-h-11"
          data-testid="company-saved-undo"
        >
          {pending ? "Undoing…" : "Undo"}
        </button>
      )}
      <button type="button" onClick={onDone} aria-label="Close" className="btn btn-ghost btn-sm shrink-0 pointer-coarse:min-h-11">
        <IconX size={12} />
      </button>
      {error && (
        <p className="w-full text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>,
    document.body,
  );
}

/* ------------------------------ Book meeting ------------------------------ */

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function dow(iso: string) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}
const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
function weekdayOf(iso: string) {
  return weekdayFmt.format(new Date(`${iso}T12:00:00Z`));
}
function longDay(iso: string) {
  return dayFmt.format(new Date(`${iso}T12:00:00Z`));
}

// Tomorrow · the next working day after it · next week's Monday · Pick.
function dayChips(today: string) {
  const tomorrow = addDays(today, 1);
  let second = addDays(today, 2);
  if (dow(second) === 6) second = addDays(second, 2);
  if (dow(second) === 0) second = addDays(second, 1);
  // The coming Monday (a week on when today is one).
  const monday = addDays(today, (8 - dow(today)) % 7 || 7);
  const chips = [
    { on: tomorrow, label: "Tomorrow" },
    { on: second, label: weekdayOf(second) },
    { on: monday, label: "Next week" },
  ];
  return chips.filter((chip, index) => chips.findIndex((other) => other.on === chip.on) === index);
}

const TIME_CHIPS = [
  { time: "09:00", label: "9" },
  { time: "10:00", label: "10" },
  { time: "11:00", label: "11" },
  { time: "13:00", label: "1" },
  { time: "14:00", label: "2" },
  { time: "15:00", label: "3" },
];

type Options = Awaited<ReturnType<typeof bookingOptions>>;

const chipClass = (on: boolean) =>
  `btn btn-sm min-h-9 pointer-coarse:min-h-11 ${on ? "btn-primary" : "btn-ghost"}`;

// The Book meeting sheet on a company page: who, the day and time as chips
// (Pick for anything else), who else from the company, where and a note
// behind "+ details", and — when the company already has an open Pipeline
// tile they are not on — "Add to the open Ironwood opportunity with
// Chase?" Yes / New one. Saves through bookMeeting (Meeting Set, the
// tile, the booker credited); the page then shows "Booked … · Undo".
// A dialog on document.body; a bottom sheet on a phone.
function BookMeetingSheet({
  people,
  today,
  initial,
  onClose,
  onBooked,
}: {
  people: BookPerson[];
  today: string;
  initial: string | null;
  onClose: () => void;
  onBooked: (message: string, batchId: string | null) => void;
}) {
  const days = useMemo(() => dayChips(today), [today]);
  const [who, setWho] = useState<string | null>(initial ?? (people.length === 1 ? people[0].id : null));
  const [on, setOn] = useState(days[0].on);
  const [picking, setPicking] = useState(false);
  const [time, setTime] = useState("");
  const [pickingTime, setPickingTime] = useState(false);
  const [withIds, setWithIds] = useState<string[]>([]);
  const [details, setDetails] = useState(false);
  const [where, setWhere] = useState("");
  const [note, setNote] = useState("");
  const [options, setOptions] = useState<Options | null>(null);
  const [opportunity, setOpportunity] = useState<string>("auto");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = "book-meeting-title";

  // Escape closes the sheet and nothing under it (capture phase).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("button, input")?.focus());
    return () => {
      document.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
    };
  }, [onClose]);

  // The company's open tiles, for "Add to the open … opportunity?".
  useEffect(() => {
    if (!who) return;
    let live = true;
    bookingOptions(who).then((result) => {
      if (!live) return;
      setOptions(result);
      if ("error" in result) return;
      const theirs = result.opportunities.find((row) => row.includesThem);
      setOpportunity(theirs ? "auto" : (result.opportunities[0]?.id ?? "auto"));
    });
    return () => {
      live = false;
    };
  }, [who]);

  const person = people.find((row) => row.id === who) ?? null;
  const others = people.filter((row) => row.id !== who);
  const open = options && !("error" in options) ? options.opportunities : [];
  const askJoin = open.length > 0 && !open.some((row) => row.includesThem);

  function save() {
    if (!who) {
      setError("Pick who the meeting is with");
      return;
    }
    setError(undefined);
    start(async () => {
      const result = await bookMeeting({
        contactId: who,
        on,
        time: time || undefined,
        withContactIds: withIds.filter((id) => id !== who),
        where: where || undefined,
        note: note || undefined,
        opportunity,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onBooked(result.success ?? "Booked", result.batchId ?? null);
    });
  }

  return createPortal(
    <div
      className="modal-backdrop items-end sm:items-center"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="popover card flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl"
        data-testid="book-sheet"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline-3)] px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold">
            {person ? `Book a meeting with ${person.name}` : "Book a meeting"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm pointer-coarse:min-h-11">
            <IconX size={13} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!initial && (
            <fieldset>
              <legend className="faint mb-1.5 text-xs">Who?</legend>
              <div className="flex flex-wrap gap-1.5">
                {people.slice(0, 12).map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    aria-pressed={who === row.id}
                    onClick={() => {
                      setWho(row.id);
                      setWithIds((ids) => ids.filter((id) => id !== row.id));
                    }}
                    className={chipClass(who === row.id)}
                    data-testid="book-who"
                  >
                    {row.name}
                  </button>
                ))}
                {people.length === 0 && <p className="faint text-xs">Add a person to this company first.</p>}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="faint mb-1.5 text-xs">Day</legend>
            <div className="flex flex-wrap gap-1.5">
              {days.map((chip) => (
                <button
                  key={chip.on}
                  type="button"
                  aria-pressed={!picking && on === chip.on}
                  onClick={() => {
                    setPicking(false);
                    setOn(chip.on);
                  }}
                  className={chipClass(!picking && on === chip.on)}
                  title={longDay(chip.on)}
                  data-testid="book-day"
                  data-on={chip.on}
                >
                  {chip.label}
                </button>
              ))}
              <button type="button" aria-pressed={picking} onClick={() => setPicking(true)} className={chipClass(picking)} data-testid="book-day-pick">
                Pick
              </button>
            </div>
            {picking && (
              <input
                type="date"
                min={today}
                value={on}
                onChange={(event) => setOn(event.target.value || on)}
                aria-label="Meeting day"
                className="input input-sm mt-2 w-44"
                data-testid="book-day-input"
              />
            )}
            <p className="faint mt-1.5 text-xs" data-testid="book-day-words">
              {longDay(on)}
            </p>
          </fieldset>

          <fieldset>
            <legend className="faint mb-1.5 text-xs">Time · optional</legend>
            <div className="flex flex-wrap gap-1.5">
              {TIME_CHIPS.map((chip) => (
                <button
                  key={chip.time}
                  type="button"
                  aria-pressed={!pickingTime && time === chip.time}
                  aria-label={`${chip.label} ${Number(chip.time.slice(0, 2)) < 12 ? "AM" : "PM"}`}
                  onClick={() => {
                    setPickingTime(false);
                    setTime(time === chip.time ? "" : chip.time);
                  }}
                  className={`${chipClass(!pickingTime && time === chip.time)} min-w-11`}
                  data-testid="book-time"
                  data-time={chip.time}
                >
                  {chip.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={pickingTime}
                onClick={() => setPickingTime(true)}
                className={chipClass(pickingTime)}
                data-testid="book-time-pick"
              >
                Pick
              </button>
            </div>
            {pickingTime && (
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                aria-label="Meeting time"
                className="input input-sm mt-2 w-36"
                data-testid="book-time-input"
              />
            )}
          </fieldset>

          {who && others.length > 0 && (
            <fieldset>
              <legend className="faint mb-1.5 text-xs">Who else from here?</legend>
              <div className="flex flex-wrap gap-1.5">
                {others.slice(0, 12).map((row) => {
                  const picked = withIds.includes(row.id);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => setWithIds(picked ? withIds.filter((id) => id !== row.id) : [...withIds, row.id])}
                      className={chipClass(picked)}
                      data-testid="book-with"
                    >
                      {row.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {askJoin && (
            <fieldset data-testid="book-join">
              <legend className="mb-1.5 text-sm">
                Add to the open <span className="font-medium">{open[0].title}</span> opportunity
                {open[0].primaryName ? ` with ${open[0].primaryName}` : ""}?
              </legend>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  aria-pressed={opportunity === open[0].id}
                  onClick={() => setOpportunity(open[0].id)}
                  className={chipClass(opportunity === open[0].id)}
                  data-testid="book-join-yes"
                >
                  Yes
                </button>
                <button
                  type="button"
                  aria-pressed={opportunity === "new"}
                  onClick={() => setOpportunity("new")}
                  className={chipClass(opportunity === "new")}
                  data-testid="book-join-new"
                >
                  New one
                </button>
              </div>
            </fieldset>
          )}

          {details ? (
            <div className="space-y-2">
              <label className="block text-xs">
                <span className="faint mb-1 block">Where · optional</span>
                <input value={where} onChange={(event) => setWhere(event.target.value)} maxLength={200} className="input input-sm" data-testid="book-where" />
              </label>
              <label className="block text-xs">
                <span className="faint mb-1 block">Note · optional</span>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={2000} className="textarea" data-testid="book-note" />
              </label>
            </div>
          ) : (
            <button type="button" onClick={() => setDetails(true)} className="link text-xs" data-testid="book-details">
              + details
            </button>
          )}
          <FormError message={error} />
        </div>
        <div className="border-t border-[var(--hairline-3)] px-5 py-3">
          <button
            type="button"
            disabled={pending || !who}
            onClick={save}
            className="btn btn-primary w-full min-h-12"
            data-testid="book-save"
          >
            {pending ? "Booking…" : "Book it"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
