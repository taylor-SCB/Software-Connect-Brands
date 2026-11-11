"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { bookMeeting, logActivity, undoLog } from "@/app/dashboard/contacts/actions";
import { completeEventWithLog, setEventDone } from "@/app/dashboard/calendar/actions";
import { markMeetingHeld, markMeetingNoShow, rescheduleMeeting } from "@/app/dashboard/deals/opportunity-actions";
import {
  ACTIVITY_LABELS,
  STATUS_REASONS,
  STATUS_REASON_LABELS,
  type ActivityOutcomeValue,
  type ActivityTypeValue,
  type StatusReasonValue,
} from "@/lib/constants";
import { outcomeNote, type LogMark, type NextStep } from "@/lib/outcomes";
import type { FollowUpSeed } from "@/lib/logging";
import { FormError } from "@/components/ui";
import { IconCalendar, IconCheck, IconMail, IconMessage, IconPhone } from "@/components/icons";
import { ContactMultiSelect, type PickableContact } from "@/components/contact-multi-select";
import { CompanyPeoplePicker, type CompanyPerson } from "@/components/company-people-picker";
import { FollowUpPrompt } from "@/components/follow-up-prompt";
import { BookMeetingFields, EMPTY_BOOKING, type BookingValue } from "@/components/book-meeting/book-meeting";
import { afterLog, logContext, notMovingForward, rescheduleEntry } from "./actions";
import { Chip, ChipGrid, Sheet } from "./sheet";
import { UndoToast, UNDO_MS } from "./undo-toast";
import { browserToday, dayChips, longDay, plusDays, whenWords } from "./dates";
import { useDialReturn } from "./dial-return";
import type { AfterLogInput, LogContext, SavedLog } from "./types";

// "How did it go?" (BDR redesign, Nov 11, 2026): one sheet on the contact
// page, the company page, the calendar's Done box, Up next rows and the
// opportunity panel.
//
// Step 1, the outcome, by kind of touch. One tap saves; the chip's words
// become the note (a typed note wins); "Saved · Undo" shows for ten
// seconds. Call: No answer · Left voicemail · Talked · Meeting booked ·
// Not interested, and More: Busy · Front desk · Wrong number. Text /
// Email: Sent · They replied · Meeting booked · Not interested. Meeting:
// Held · No-show · Rescheduled. On a company page "Who?" comes first,
// with a "Front desk / main line" chip for the company alone. "Just now
// ▾" changes when it happened (a day ahead schedules it instead), "+
// others" adds people. "Log phone call" still saves a touch with no
// outcome, which reads as "not recorded".
//
// Step 2, the next step, already picked: Try again <day> after a try (or
// "Try again in 30 days" once the workspace's try limit is reached with
// no connect), Book meeting / Try to book a meeting / Call back after a
// talk, a reason and "Check back in 90 days?" after Not interested, Start
// a quote / Book next meeting / Not moving forward after Held, Reschedule
// after a no-show. Dates are chips. Skip writes nothing. It goes into the
// same save, so the one Undo takes both.

export type LogTargetProps =
  | { contactId: string; companyId?: undefined }
  | { companyId: string; contactId?: undefined };

// A calendar entry ticked done (the Done box).
export type HowEvent = {
  id: string;
  type: string;
  title: string;
  notes: string;
  startOn?: string;
  startTime?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  companyId?: string | null;
  companyName?: string | null;
};

export type HowDidItGoOptions = {
  // What it is about: a record page's person or company, or a calendar entry.
  target?: LogTargetProps;
  event?: HowEvent;
  // The kind of touch it opens on (a Call after a tel: tap, a Text after sms:).
  type?: ActivityTypeValue;
  // Shown while the sheet reads the rest.
  name?: string;
  // The workspace's today, when the page has it.
  today?: string;
  // A contact page: its person, for "+ others".
  current?: PickableContact;
  // A company page: its first people, for "Who?", and who is logging.
  companyPeople?: CompanyPerson[];
  userName?: string;
  // A company page: people to tick to start with.
  pickContactIds?: string[];
  // Open straight on the Book meeting step ("Meeting booked").
  start?: "log" | "book";
  onSaved?: (saved: SavedLog) => void;
};

export type HowDidItGoProps = HowDidItGoOptions & {
  open: boolean;
  onClose: () => void;
  // Called once the sheet is closed and its "Saved · Undo" has gone, for
  // a host that unmounts it (the calendar's Done box).
  onFinished?: () => void;
};

type Toast = { batchId: string; words: string; href?: string | null; hrefLabel?: string; at: number };

type ChipDef = {
  key: string;
  label: string;
  outcome: ActivityOutcomeValue | null;
  connect?: boolean;
  mark?: LogMark;
  book?: boolean;
  reschedule?: boolean;
  // Words saved as the note when none is typed (else the outcome's own).
  note?: string;
};

const CALL: ChipDef[] = [
  { key: "NO_ANSWER", label: "No answer", outcome: "NO_ANSWER" },
  { key: "VOICEMAIL", label: "Left voicemail", outcome: "VOICEMAIL" },
  { key: "TALKED", label: "Talked", outcome: "TALKED", connect: true },
  { key: "BOOKED", label: "Meeting booked", outcome: "TALKED", connect: true, book: true },
  { key: "NOT_INTERESTED", label: "Not interested", outcome: "TALKED", connect: true, mark: "NOT_INTERESTED" },
];
const CALL_MORE: ChipDef[] = [
  { key: "BUSY", label: "Busy", outcome: "NO_ANSWER", note: "Busy" },
  { key: "GATEKEEPER", label: "Front desk", outcome: "GATEKEEPER" },
  { key: "BAD_NUMBER", label: "Wrong number", outcome: "BAD_NUMBER" },
];
const MESSAGE: ChipDef[] = [
  { key: "SENT", label: "Sent", outcome: "SENT" },
  { key: "REPLIED", label: "They replied", outcome: "REPLIED", connect: true },
  { key: "BOOKED", label: "Meeting booked", outcome: "REPLIED", connect: true, book: true },
  { key: "NOT_INTERESTED", label: "Not interested", outcome: "REPLIED", connect: true, mark: "NOT_INTERESTED" },
];
const MEETING: ChipDef[] = [
  { key: "HELD", label: "Held", outcome: "HELD", connect: true },
  { key: "NO_SHOW", label: "No-show", outcome: "NO_SHOW" },
  { key: "RESCHEDULED", label: "Rescheduled", outcome: null, reschedule: true },
];

function chipsFor(type: ActivityTypeValue) {
  return type === "PHONE_CALL" ? CALL : type === "MEETING" ? MEETING : MESSAGE;
}

// A call first: it is most of what a rep logs.
export const TYPE_ORDER: ActivityTypeValue[] = ["PHONE_CALL", "TEXT", "EMAIL", "MEETING"];
const TYPE_WORD: Record<ActivityTypeValue, string> = { PHONE_CALL: "Call", TEXT: "Text", EMAIL: "Email", MEETING: "Meeting" };
const TYPE_ICON = { PHONE_CALL: IconPhone, TEXT: IconMessage, EMAIL: IconMail, MEETING: IconCalendar } as const;
const TRIES = new Set(["NO_ANSWER", "VOICEMAIL", "BUSY", "GATEKEEPER", "BAD_NUMBER", "SENT"]);

// The kind of touch a calendar entry reads back as (mirrors activityTypeFor
// in calendar-auto.ts, so the box needs no round trip).
export function guessType(eventType: string): ActivityTypeValue {
  const lower = eventType.toLowerCase();
  if (lower === "meeting") return "MEETING";
  if (lower === "email") return "EMAIL";
  if (lower === "text") return "TEXT";
  return "PHONE_CALL";
}

// When a save landed, for the ten seconds of Undo (only ever read in a
// click handler, never while drawing).
const stamp = () => Date.now();

type Choice = "none" | "follow" | "park" | "book" | "meeting" | "quote" | "lost" | "reschedule";

// Draws the sheet while open, and the "Saved · Undo" toast that outlives
// it. The sheet's own state starts fresh every time it opens.
export function HowDidItGo(props: HowDidItGoProps) {
  const [toast, setToast] = useState<Toast | null>(null);
  const dismiss = useCallback(() => setToast(null), []);
  const { open, onFinished } = props;
  useEffect(() => {
    if (!open && !toast) onFinished?.();
  }, [open, toast, onFinished]);
  return (
    <>
      {props.open && <HowSheet {...props} onToast={setToast} />}
      <UndoToast saved={toast} onDone={dismiss} />
    </>
  );
}

function HowSheet(props: HowDidItGoProps & { onToast: (toast: Toast) => void }) {
  const { target, event, onClose, onToast } = props;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const eventMode = Boolean(event);
  const company = Boolean(target?.companyId) && !eventMode;

  const [ctx, setCtx] = useState<LogContext | null>(null);
  const [fallbackToday] = useState(browserToday);
  const today = props.today ?? ctx?.today ?? fallbackToday;
  const [type, setType] = useState<ActivityTypeValue>(props.type ?? (event ? guessType(event.type) : "PHONE_CALL"));
  const [phase, setPhase] = useState<"log" | "book" | "next" | "several">(props.start === "book" ? "book" : "log");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState<string | null>(null);
  const [atTime, setAtTime] = useState("");
  const [whenOpen, setWhenOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState<SavedLog | null>(null);
  const [seed, setSeed] = useState<FollowUpSeed | null>(null);
  const [undoLeft, setUndoLeft] = useState(false);
  const [people, setPeople] = useState<string[]>(props.pickContactIds ?? []);
  const [book, setBook] = useState<BookingValue>(EMPTY_BOOKING);
  const [bookMode, setBookMode] = useState<"log" | "reschedule" | "new" | "entry">("log");
  const [early, setEarly] = useState<{ day: string; retry: () => void } | null>(null);
  // Step 2.
  const [choice, setChoice] = useState<Choice>("none");
  const [nextOn, setNextOn] = useState("");
  const [pickNextDay, setPickNextDay] = useState(false);
  const [nextType, setNextType] = useState<ActivityTypeValue>("PHONE_CALL");
  const [interested, setInterested] = useState(false);
  const [reason, setReason] = useState<StatusReasonValue | null>(null);
  const [checkBack, setCheckBack] = useState(false);

  useEffect(() => {
    let live = true;
    const ask = event ? { eventId: event.id } : target?.contactId ? { contactId: target.contactId } : { companyId: target?.companyId ?? null };
    logContext(ask).then((answer) => {
      if (live && !("error" in answer)) setCtx(answer);
    });
    return () => {
      live = false;
    };
  }, [event, target?.contactId, target?.companyId]);

  // "Saved · Undo" shows for ten seconds after the save.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setUndoLeft(false), Math.max(0, UNDO_MS - (Date.now() - saved.at)));
    return () => window.clearTimeout(timer);
  }, [saved]);

  const name = ctx?.name ?? props.name ?? event?.contactName ?? event?.companyName ?? "";
  const first = company ? name : (ctx?.firstName ?? name.split(/\s+/)[0] ?? "");
  const day = when ?? today;
  const ahead = !eventMode && day > today;
  const days = dayChips(today);
  // Who a meeting is booked with: the page's person, the first ticked on a
  // company page, or the entry's person.
  const bookWith = target?.contactId ?? (company ? people[0] : null) ?? ctx?.contactId ?? event?.contactId ?? null;
  const meeting = ctx?.meeting ?? null;
  // "Booked Tue, Nov 17, 10:00 AM · Kristen is on your Pipeline in Meeting Set"
  const bookedName = () => {
    const id = bookWith;
    const person = props.companyPeople?.find((row) => row.id === id);
    const full = person?.name ?? (target?.contactId || eventMode ? (ctx?.name ?? props.name ?? event?.contactName ?? "") : "");
    return full.split(/\s+/)[0] || "They";
  };
  const bookedWords = (value: BookingValue) => `Booked ${whenWords(value.on, value.time || null)} · ${bookedName()} is on your Pipeline in Meeting Set`;

  /* ------------------------------ Saving ------------------------------ */

  function toastAndClose(toast: Omit<Toast, "at"> & { at?: number }) {
    onToast({ ...toast, at: toast.at ?? stamp() });
    onClose();
  }

  function enterNext(next: SavedLog, chip: ChipDef | null, followUp: FollowUpSeed | null) {
    setSaved(next);
    setUndoLeft(true);
    setSeed(followUp);
    setError(undefined);
    props.onSaved?.(next);
    const key = chip?.key ?? null;
    setReason(null);
    setInterested(false);
    setCheckBack(false);
    setPickNextDay(false);
    setNextOn(days[1].on);
    // A plain log (no outcome) gets the full follow-up box.
    if (!chip) {
      setPhase(followUp ? "several" : "next");
      setChoice("follow");
      setNextType(next.type === "MEETING" ? "PHONE_CALL" : next.type);
      return;
    }
    setPhase("next");
    if (key && TRIES.has(key)) {
      setChoice(ctx?.park ? "park" : "follow");
      setNextType(key === "BAD_NUMBER" ? "EMAIL" : "PHONE_CALL");
    } else if (key === "TALKED" || key === "REPLIED") setChoice("meeting");
    else if (key === "NOT_INTERESTED") setChoice("none");
    else if (key === "HELD") setChoice("quote");
    else if (key === "NO_SHOW") setChoice("reschedule");
    else setChoice("none");
    setBook(EMPTY_BOOKING);
  }

  // The touch, from the form (with whatever is on it) plus the chip.
  function saveTouch(chip: ChipDef | null, options: { booking?: BookingValue; early?: boolean } = {}) {
    setError(undefined);
    start(async () => {
      const outcome = chip?.outcome ?? null;
      const mark = chip?.mark ?? null;
      const typed = note.trim();
      const chipWords = chip?.note ?? null;

      // A meeting booked with them that has come: Held / No-show answer it.
      if (!eventMode && type === "MEETING" && meeting && (outcome === "HELD" || outcome === "NO_SHOW")) {
        const result: { error?: string; success?: string; batchId?: string; confirmEarly?: string; opportunityId?: string } =
          outcome === "HELD"
            ? await markMeetingHeld(meeting.id, { early: options.early, note: typed || undefined })
            : await markMeetingNoShow(meeting.id);
        if (result.confirmEarly) {
          const day = result.confirmEarly;
          setEarly({ day, retry: () => saveTouch(chip, { ...options, early: true }) });
          return;
        }
        if (result.error || !result.batchId) {
          setError(result.error ?? "That couldn't be saved");
          return;
        }
        setEarly(null);
        const opportunityId = result.opportunityId ?? null;
        enterNext({ batchId: result.batchId, words: result.success ?? chip!.label, type, outcome, chip: chip!.key, opportunityId, note: typed, at: Date.now() }, chip, null);
        return;
      }

      const booking = options.booking;
      const next: NextStep | undefined = booking
        ? {
            kind: "meeting",
            on: booking.on,
            time: booking.time || undefined,
            withContactIds: booking.withContactIds,
            where: booking.where || undefined,
            note: booking.note || undefined,
            opportunity: booking.opportunity,
          }
        : undefined;

      if (eventMode && event) {
        const result = await completeEventWithLog(event.id, {
          activityType: type,
          note: typed || chipWords || (outcome || mark ? outcomeNote({ outcome, mark, booked: Boolean(booking) }) : ""),
          outcome,
          mark,
          next,
          early: options.early,
        });
        if (result.confirmEarly) {
          setEarly({ day: result.confirmEarly, retry: () => saveTouch(chip, { ...options, early: true }) });
          return;
        }
        if (result.error || !result.batchId) {
          setError(result.error ?? "That couldn't be saved");
          return;
        }
        setEarly(null);
        if (booking) {
          const ok = (result.notices ?? []).some((line) => /on your Pipeline/.test(line));
          toastAndClose({
            batchId: result.batchId,
            words: ok ? `${chip?.label ?? "Logged"} · ${bookedWords(booking)}` : (result.notices ?? []).join(" · ") || result.success || "Logged",
            href: ok ? "/dashboard/deals" : null,
            hrefLabel: "Pipeline →",
          });
          return;
        }
        // A meeting ticked done with no outcome was held.
        const read = chip ?? (type === "MEETING" ? MEETING[0] : null);
        enterNext(
          { batchId: result.batchId, words: chip?.label ?? `${ACTIVITY_LABELS[type]} logged`, type, outcome, chip: read?.key ?? null, opportunityId: null, note: typed, at: Date.now() },
          read,
          null,
        );
        return;
      }

      const form = formRef.current;
      if (!form) return;
      const data = new FormData(form);
      data.set("type", type);
      if (chip) data.set("body", typed || chipWords || "");
      if (outcome) data.set("outcome", outcome);
      if (mark) data.set("mark", mark);
      if (next) {
        data.set("next", "meeting");
        data.set("nextOn", next.on ?? "");
        data.set("nextTime", next.time ?? "");
        data.delete("nextWith");
        for (const id of next.withContactIds) data.append("nextWith", id);
        data.set("nextWhere", next.where ?? "");
        data.set("nextNote", next.note ?? "");
        data.set("opportunity", next.opportunity ?? "auto");
      }
      const result = await logActivity({}, data);
      if (result.error || !result.batchId) {
        setError(result.error ?? "That couldn't be saved");
        return;
      }
      const words = chip?.label ?? (ahead ? "Scheduled" : `${ACTIVITY_LABELS[type]} logged`);
      if (!result.followUp) {
        // Scheduled ahead, or the next step was in the same save.
        const booked = Boolean(next && booking && (result.notices ?? []).some((line) => /on your Pipeline/.test(line)));
        toastAndClose({
          batchId: result.batchId,
          words: booked && booking ? `${words} · ${bookedWords(booking)}` : next ? (result.notices ?? []).join(" · ") || result.success || words : result.success || words,
          href: booked ? "/dashboard/deals" : null,
          hrefLabel: "Pipeline →",
        });
        return;
      }
      enterNext(
        { batchId: result.batchId, words, type, outcome, chip: chip?.key ?? null, opportunityId: result.opportunityId ?? null, note: typed || (data.get("body") as string) || "", at: Date.now() },
        chip,
        result.followUp,
      );
    });
  }

  function tapChip(chip: ChipDef) {
    if (pending) return;
    if (chip.book || chip.reschedule) {
      if (chip.reschedule) setBookMode(meeting ? "reschedule" : eventMode ? "entry" : "new");
      else setBookMode("log");
      setBook(EMPTY_BOOKING);
      setError(undefined);
      setPhase("book");
      return;
    }
    saveTouch(chip);
  }

  // Book it, from the Book meeting step.
  function saveBooking() {
    if (!book.on) return;
    setError(undefined);
    if (bookMode === "log") {
      const chip = chipsFor(type).find((row) => row.book) ?? null;
      saveTouch(chip, { booking: book });
      return;
    }
    start(async () => {
      if (bookMode === "reschedule" && meeting) {
        const result = await rescheduleMeeting(meeting.id, { on: book.on, time: book.time || null });
        if (result.error) return setError(result.error);
        if (result.batchId) toastAndClose({ batchId: result.batchId, words: result.success ?? "Rescheduled", href: "/dashboard/deals", hrefLabel: "Pipeline →" });
        else toastAndClose({ batchId: "", words: result.success ?? "Rescheduled" });
        return;
      }
      if (bookMode === "entry" && event) {
        const result = await rescheduleEntry(event.id, { on: book.on, time: book.time || null });
        if (result.error) return setError(result.error);
        toastAndClose({ batchId: "", words: result.success ?? "Moved" });
        return;
      }
      if (!bookWith) return setError("Pick who the meeting is with first");
      const result = await bookMeeting({
        contactId: bookWith,
        on: book.on,
        time: book.time || undefined,
        withContactIds: book.withContactIds,
        where: book.where || undefined,
        note: book.note || undefined,
        opportunity: book.opportunity,
      });
      if (result.error || !result.batchId) return setError(result.error ?? "That couldn't be booked");
      toastAndClose({ batchId: result.batchId, words: bookedWords(book), href: "/dashboard/deals", hrefLabel: "Pipeline →" });
    });
  }

  // Step 2's Save.
  function saveNext() {
    if (!saved) return;
    setError(undefined);
    start(async () => {
      if (choice === "lost") {
        const result = await notMovingForward({ opportunityId: saved.opportunityId, batchId: saved.batchId, reason });
        if (result.error) return setError(result.error);
        toastAndClose({ batchId: saved.batchId, words: `${saved.words} · ${result.success}`, at: saved.at });
        return;
      }
      if (choice === "reschedule" && book.on) {
        if (meeting) {
          const result = await rescheduleMeeting(meeting.id, { on: book.on, time: book.time || null });
          if (result.error) return setError(result.error);
          toastAndClose({ batchId: result.batchId ?? saved.batchId, words: result.success ?? "Rescheduled", href: "/dashboard/deals", hrefLabel: "Pipeline →" });
          return;
        }
      }
      const input: AfterLogInput = { batchId: saved.batchId };
      const typed = note.trim();
      if (typed && typed !== saved.note) input.note = typed;
      if (saved.chip === "NOT_INTERESTED") {
        if (reason) input.reason = reason;
        if (checkBack) input.next = { kind: "follow", on: plusDays(today, 90), type: "PHONE_CALL", withContactIds: [] };
      } else {
        if (interested) input.mark = "INTERESTED";
        if (choice === "follow") input.next = { kind: "follow", on: nextOn, type: nextType, withContactIds: [] };
        if (choice === "book") input.next = { kind: "book", on: nextOn, withContactIds: [] };
        if (choice === "park") input.next = { kind: "park", withContactIds: [] };
        if ((choice === "meeting" || choice === "reschedule") && book.on) {
          input.next = {
            kind: "meeting",
            on: book.on,
            time: book.time || undefined,
            withContactIds: book.withContactIds,
            where: book.where || undefined,
            note: book.note || undefined,
            opportunity: book.opportunity,
          };
        }
      }
      if (!input.note && !input.mark && !input.reason && !input.next) {
        toastAndClose({ batchId: saved.batchId, words: `Saved · ${saved.words}`, at: saved.at });
        return;
      }
      const result = await afterLog(input);
      if (result.error) return setError(result.error);
      const booked = input.next?.kind === "meeting";
      const lines = (result.words ?? []).map((line) => (booked && /on your Pipeline/.test(line) ? bookedWords(book) : line));
      toastAndClose({
        batchId: saved.batchId,
        words: [saved.words, ...lines].join(" · "),
        href: booked ? "/dashboard/deals" : null,
        hrefLabel: "Pipeline →",
      });
    });
  }

  function skip() {
    if (saved) onToast({ batchId: saved.batchId, words: `Saved · ${saved.words}`, at: saved.at });
    onClose();
  }

  function undoNow() {
    if (!saved) return;
    start(async () => {
      const result = await undoLog(saved.batchId);
      if (result.error) return setError(result.error);
      setSaved(null);
      setSeed(null);
      setPhase("log");
      router.refresh();
    });
  }

  function onSubmit(fired: FormEvent<HTMLFormElement>) {
    fired.preventDefault();
    // Enter in a box on step 2 must not log the touch a second time.
    if (phase !== "log" || pending) return;
    saveTouch(null);
  }

  /* ------------------------------ Drawing ------------------------------ */

  const chips = chipsFor(type);
  const meetingWaiting = type === "MEETING" && !eventMode && !ctx;
  const title =
    phase === "book"
      ? bookMode === "reschedule" || bookMode === "entry"
        ? `Move the meeting${first ? ` with ${first}` : ""}`
        : `Book a meeting${first ? ` with ${first}` : ""}`
      : phase === "next" || phase === "several"
        ? `What's next${first ? ` with ${first}` : ""}?`
        : company
          ? "How did it go?"
          : `How did it go${first ? ` with ${first}` : ""}?`;
  const typeTestId = (option: ActivityTypeValue) => (eventMode ? `done-type-${option}` : `log-type-${option}`);

  const footer = (
    <div className="space-y-2">
      <FormError message={error} />
      {early && (
        <div className="rounded-lg border border-[var(--border)] p-3 text-sm" role="group" aria-label="Did it happen early?" data-testid="log-early">
          <p className="mb-2">This meeting is {longDay(early.day)}. Did it happen early?</p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button type="button" className="btn btn-primary min-h-11" onClick={early.retry} disabled={pending} data-testid="log-early-yes">
              Yes, it happened
            </button>
            <button type="button" className="btn btn-ghost min-h-11" onClick={() => setEarly(null)} data-testid="log-early-no">
              Not yet
            </button>
          </div>
        </div>
      )}
      {phase === "log" && !eventMode && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className={`btn ${ahead ? "btn-primary" : "btn-ghost"} min-h-11 flex-1 sm:flex-none`} data-testid="activity-submit">
            {pending ? (ahead ? "Scheduling…" : "Saving…") : `${ahead ? "Schedule" : "Log"} ${ACTIVITY_LABELS[type].toLowerCase()}`}
          </button>
          {!ahead && <span className="faint text-xs">or tap how it went</span>}
        </div>
      )}
      {phase === "log" && eventMode && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button type="submit" disabled={pending} className="btn btn-ghost col-span-2 min-h-11" data-testid="done-log">
            <IconCheck size={12} />
            {pending ? "Saving…" : `Log ${ACTIVITY_LABELS[type].toLowerCase()} and tick it`}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await setEventDone(event!.id, true);
                if (result?.error) return setError(result.error);
                onClose();
              })
            }
            className="btn btn-ghost min-h-11"
            data-testid="done-only"
          >
            Just tick it
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost min-h-11">
            Cancel
          </button>
        </div>
      )}
      {phase === "book" && (
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" onClick={() => setPhase(saved ? "next" : "log")} className="btn btn-ghost min-h-12 sm:min-h-11" data-testid="book-back">
            Back
          </button>
          <button type="button" onClick={saveBooking} disabled={pending || !book.on} className="btn btn-primary min-h-12 sm:min-h-11" data-testid="book-submit">
            <IconCalendar size={14} />
            {pending ? "Saving…" : book.on ? `${bookMode === "reschedule" || bookMode === "entry" ? "Move it" : "Book it"} · ${longDay(book.on)}` : "Pick a day"}
          </button>
        </div>
      )}
      {phase === "next" && (
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" onClick={skip} disabled={pending} className="btn btn-ghost min-h-12 sm:min-h-11" data-testid="follow-up-skip">
            Skip
          </button>
          {choice === "quote" && bookWith ? (
            <Link
              href={`/dashboard/quotes/new?contactId=${bookWith}`}
              onClick={() => skip()}
              className="btn btn-primary min-h-12 sm:min-h-11"
              data-testid="follow-up-save"
            >
              Start a quote
            </Link>
          ) : (
            <button
              type="button"
              onClick={saveNext}
              disabled={pending || ((choice === "meeting" || choice === "reschedule") && !book.on) || ((choice === "follow" || choice === "book") && !nextOn)}
              className="btn btn-primary min-h-12 sm:min-h-11"
              data-testid="follow-up-save"
            >
              {pending ? "Saving…" : saveLabel()}
            </button>
          )}
        </div>
      )}
    </div>
  );

  function saveLabel() {
    const dayWord = nextOn ? (days.find((row) => row.on === nextOn)?.label ?? longDay(nextOn)) : "";
    if (saved?.chip === "NOT_INTERESTED") return checkBack ? "Save · check back in 90 days" : "Save";
    switch (choice) {
      case "follow":
        return saved?.chip && TRIES.has(saved.chip) && nextType === "PHONE_CALL" ? `Try again ${dayWord}` : `${TYPE_WORD[nextType]} ${dayWord}`;
      case "park":
        return "Try again in 30 days";
      case "book":
        return `Remind me ${dayWord}`;
      case "meeting":
      case "reschedule":
        return book.on ? `Book it · ${longDay(book.on)}` : "Pick a day";
      case "lost":
        return "Move to Lost";
      default:
        return interested ? "Save" : "Done";
    }
  }

  return (
    <Sheet
      open
      onClose={saved ? skip : onClose}
      title={title}
      eyebrow={eventMode ? event!.title : company && name ? name : undefined}
      testId={eventMode ? "done-box" : "how-did-it-go"}
      formRef={formRef}
      onSubmit={onSubmit}
      formTestId={eventMode ? "done-form" : "log-activity-form"}
      footer={footer}
    >
      {!eventMode && target?.contactId && <input type="hidden" name="contactId" value={target.contactId} />}
      {!eventMode && target?.companyId && <input type="hidden" name="companyId" value={target.companyId} />}
      <input type="hidden" name="type" value={type} />

      <div className="space-y-4">
        {phase === "log" && (
          <>
            {company && (
              <section aria-label="Who?" className="space-y-2">
                <p className="text-sm font-medium">Who was it with?</p>
                <CompanyPeoplePicker
                  companyId={target!.companyId!}
                  people={props.companyPeople ?? []}
                  userName={props.userName}
                  initial={props.pickContactIds}
                  onChange={(ids) => setPeople(ids)}
                />
              </section>
            )}

            <div role="group" aria-label="Kind of touch" className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap">
              {TYPE_ORDER.map((option) => {
                const Icon = TYPE_ICON[option];
                const on = option === type;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setType(option);
                      setMore(false);
                      setError(undefined);
                    }}
                    aria-pressed={on}
                    className={`btn btn-sm min-h-11 ${on ? "btn-primary" : "btn-ghost"} sm:min-h-0`}
                    data-testid={typeTestId(option)}
                  >
                    <Icon size={13} />
                    {TYPE_WORD[option]}
                  </button>
                );
              })}
            </div>

            {ahead ? (
              <p className="faint text-sm" data-testid="activity-when-note">
                That&apos;s ahead: it goes on the calendar as something to do, not into the history yet.
              </p>
            ) : (
              <div className="space-y-2">
                {type === "MEETING" && meeting && (
                  <p className="faint text-xs" data-testid="log-meeting-line">
                    The meeting booked for {longDay(meeting.on)}
                    {meeting.ahead ? " (still ahead)" : ""}
                  </p>
                )}
                <ChipGrid label={`How did the ${TYPE_WORD[type].toLowerCase()} go?`} testId="outcome-chips">
                  {chips.map((chip) => (
                    <Chip
                      key={chip.key}
                      connect={chip.connect}
                      onClick={() => tapChip(chip)}
                      disabled={pending || meetingWaiting || (chip.book && !bookWith)}
                      title={chip.book && !bookWith ? "Pick who it was with first" : undefined}
                      testId={`outcome-${chip.key}`}
                    >
                      {chip.label}
                    </Chip>
                  ))}
                  {type === "PHONE_CALL" && !more && (
                    <Chip onClick={() => setMore(true)} testId="outcome-more">
                      More…
                    </Chip>
                  )}
                  {type === "PHONE_CALL" &&
                    more &&
                    CALL_MORE.map((chip) => (
                      <Chip key={chip.key} onClick={() => tapChip(chip)} disabled={pending} testId={`outcome-${chip.key}`}>
                        {chip.label}
                      </Chip>
                    ))}
                </ChipGrid>
                <p className="faint text-xs">
                  <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--health-good)]" />
                  counts as a talk. One tap saves it.
                </p>
              </div>
            )}
          </>
        )}

        {phase === "book" && (
          <BookMeetingFields
            contactId={bookWith}
            today={today}
            value={book}
            onChange={setBook}
            who={bookMode === "log" || bookMode === "new"}
            opportunity={bookMode === "log" || bookMode === "new"}
          />
        )}

        {(phase === "next" || phase === "several") && saved && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--tint-2)] px-3 py-2 text-sm" role="status" data-testid="log-saved">
            <IconCheck size={13} className="text-[var(--health-good)]" />
            <span className="min-w-0 flex-1">
              Saved · <span className="font-medium">{saved.words}</span>
            </span>
            {undoLeft && (
              <button type="button" onClick={undoNow} disabled={pending} className="btn btn-ghost btn-sm min-h-11 sm:min-h-0" data-testid="log-undo">
                Undo
              </button>
            )}
          </div>
        )}

        {phase === "several" && saved && seed && (
          <FollowUpPrompt
            seed={seed}
            today={today}
            batchId={saved.batchId}
            onClose={(message) => {
              if (message) toastAndClose({ batchId: saved.batchId, words: `${saved.words} · ${message}`, at: Date.now() });
              else skip();
            }}
          />
        )}
        {phase === "several" && saved && (
          <button
            type="button"
            onClick={() => {
              setBook(EMPTY_BOOKING);
              setChoice("meeting");
              setPhase("next");
            }}
            className="btn btn-ghost btn-sm min-h-11 sm:min-h-0"
            disabled={!bookWith}
            data-testid="follow-up-book-now"
          >
            <IconCalendar size={12} />
            Book it now
          </button>
        )}

        {phase === "next" && saved && (
          <div className="space-y-4" role="group" aria-label="Next step" data-testid="follow-up-prompt">
            {saved.chip === "NOT_INTERESTED" ? (
              <>
                <ReasonChips value={reason} onChange={setReason} />
                <Chip role="checkbox" on={checkBack} onClick={() => setCheckBack(!checkBack)} testId="next-checkback" sub={longDay(plusDays(today, 90))}>
                  Check back in 90 days?
                </Chip>
              </>
            ) : (
              <>
                <ChipGrid label="Next step">
                  {nextChoices(saved.chip, Boolean(ctx?.park), Boolean(bookWith)).map((option) => (
                    <Chip
                      key={option.key}
                      role="radio"
                      on={choice === option.key}
                      connect={option.key === "meeting"}
                      onClick={() => setChoice(choice === option.key ? "none" : option.key)}
                      testId={`next-${option.key}`}
                      sub={option.sub}
                    >
                      {option.label}
                    </Chip>
                  ))}
                </ChipGrid>

                {(saved.chip === "TALKED" || saved.chip === "REPLIED") && (
                  <Chip role="checkbox" on={interested} onClick={() => setInterested(!interested)} testId="mark-INTERESTED">
                    Interested
                  </Chip>
                )}

                {(choice === "follow" || choice === "book") && (
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-sm font-medium">When?</legend>
                    <ChipGrid label="Day">
                      {days.map((row) => (
                        <Chip
                          key={row.key}
                          role="radio"
                          on={nextOn === row.on && !pickNextDay}
                          sub={row.sub}
                          onClick={() => {
                            setPickNextDay(false);
                            setNextOn(row.on);
                          }}
                          testId={`next-day-${row.key}`}
                        >
                          {row.label}
                        </Chip>
                      ))}
                      <Chip role="radio" on={pickNextDay || (Boolean(nextOn) && !days.some((row) => row.on === nextOn))} onClick={() => setPickNextDay(true)} testId="next-day-pick">
                        Pick
                      </Chip>
                    </ChipGrid>
                    {(pickNextDay || (nextOn && !days.some((row) => row.on === nextOn))) && (
                      <input type="date" min={today} value={nextOn} onChange={(fired) => setNextOn(fired.target.value)} aria-label="Day" className="input input-sm max-w-[12rem]" data-testid="next-day-input" />
                    )}
                    {choice === "follow" && (
                      <div role="radiogroup" aria-label="By" className="flex flex-wrap gap-1.5">
                        {(["PHONE_CALL", "TEXT", "EMAIL"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={nextType === option}
                            onClick={() => setNextType(option)}
                            className={`btn btn-sm min-h-11 sm:min-h-0 ${nextType === option ? "btn-primary" : "btn-ghost"}`}
                            data-testid={`next-type-${option}`}
                          >
                            {TYPE_WORD[option]}
                          </button>
                        ))}
                      </div>
                    )}
                  </fieldset>
                )}

                {(choice === "meeting" || choice === "reschedule") && (
                  <BookMeetingFields
                    contactId={bookWith}
                    today={today}
                    value={book}
                    onChange={setBook}
                    who={choice === "meeting" || !meeting}
                    opportunity={choice === "meeting" || !meeting}
                  />
                )}

                {choice === "lost" && <ReasonChips value={reason} onChange={setReason} />}

                {seed && (
                  <button type="button" onClick={() => setPhase("several")} className="link text-xs" data-testid="next-several">
                    Several follow-ups…
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Always there, in the same place, so it keeps what was typed. */}
        {phase !== "book" && (
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--text-dim)]">What happened? <span className="faint">optional</span></span>
            {/* Uncontrolled on purpose: React writes a controlled
                textarea's value into its text, which then reads as words
                on the page. */}
            <textarea
              name="body"
              rows={2}
              defaultValue=""
              onChange={(fired) => setNote(fired.target.value)}
              maxLength={5000}
              placeholder={eventMode && event?.notes ? `Leave blank to log “${event.notes.slice(0, 60)}”` : "Anything worth remembering"}
              aria-label="What happened"
              className="textarea"
              data-testid={eventMode ? "done-note" : "log-note"}
            />
          </label>
        )}

        {phase === "log" && !eventMode && (
          <div className="flex flex-wrap items-start gap-2">
            {whenOpen ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="block text-xs">
                  <span className="faint block">When</span>
                  <input
                    type="date"
                    name="occurredOn"
                    value={day}
                    onChange={(fired) => setWhen(fired.target.value || null)}
                    className="input input-sm"
                    data-testid="activity-when"
                  />
                </label>
                <label className="block text-xs">
                  <span className="faint block">Time · optional</span>
                  <input type="time" name="atTime" value={atTime} onChange={(fired) => setAtTime(fired.target.value)} className="input input-sm" data-testid="activity-time" />
                </label>
                {!ahead && (
                  <p className="faint pb-1.5 text-xs" data-testid="activity-when-note">
                    Goes on the calendar on that day, too.
                  </p>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => setWhenOpen(true)} className="btn btn-ghost btn-sm min-h-11 sm:min-h-0" aria-expanded={false} data-testid="activity-when-toggle">
                Just now ▾
              </button>
            )}
            {target?.contactId && props.current && <ContactMultiSelect current={props.current} label="+ others" />}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function nextChoices(chip: string | null, park: boolean, canBook: boolean): { key: Choice; label: string; sub?: string }[] {
  if (chip === "TALKED" || chip === "REPLIED") {
    return [
      ...(canBook ? [{ key: "meeting" as const, label: "Book meeting" }] : []),
      { key: "book", label: "Try to book a meeting", sub: "a reminder" },
      { key: "follow", label: "Call back on…" },
    ];
  }
  if (chip === "HELD") {
    return [
      ...(canBook ? [{ key: "quote" as const, label: "Start a quote" }, { key: "meeting" as const, label: "Book next meeting" }] : []),
      { key: "lost", label: "Not moving forward" },
    ];
  }
  if (chip === "NO_SHOW") {
    return [...(canBook ? [{ key: "reschedule" as const, label: "Reschedule" }] : []), { key: "follow", label: "Call them" }];
  }
  if (chip && TRIES.has(chip)) {
    return [
      { key: "follow", label: "Try again" },
      ...(park ? [{ key: "park" as const, label: "Try again in 30 days", sub: "6 tries, never reached" }] : []),
      { key: "book", label: "Try to book a meeting", sub: "a reminder" },
    ];
  }
  return [
    { key: "follow", label: "Follow up" },
    { key: "book", label: "Try to book a meeting", sub: "a reminder" },
    ...(canBook ? [{ key: "meeting" as const, label: "Book it now" }] : []),
    ...(park ? [{ key: "park" as const, label: "Try again in 30 days" }] : []),
  ];
}

function ReasonChips({ value, onChange }: { value: StatusReasonValue | null; onChange: (next: StatusReasonValue | null) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">
        Why? <span className="faint font-normal">optional</span>
      </legend>
      <ChipGrid label="Reason">
        {STATUS_REASONS.map((key) => (
          <Chip key={key} role="radio" on={value === key} onClick={() => onChange(value === key ? null : key)} testId={`reason-${key}`}>
            {STATUS_REASON_LABELS[key]}
          </Chip>
        ))}
      </ChipGrid>
    </fieldset>
  );
}

// For other screens: const how = useHowDidItGo(); how.open({ target:
// { contactId }, type: "PHONE_CALL", name }); render {how.element} once.
// useHowDidItGo({ dial: true }) also opens it on its own, set to Call or
// Text, when the rep comes back from a tel: or sms: tap on a link inside
// an element carrying data-contact-id (an Up next row, a Who to call row).
export function useHowDidItGo(settings: { dial?: boolean } = {}) {
  const [state, setState] = useState<{ open: boolean; options: HowDidItGoOptions | null }>({ open: false, options: null });
  const open = useCallback((options: HowDidItGoOptions) => setState({ open: true, options }), []);
  const close = useCallback(() => setState((prev) => ({ ...prev, open: false })), []);
  useDialReturn({ contactIds: [], any: true, enabled: Boolean(settings.dial) }, (tap) => {
    if (tap.contactId) open({ target: { contactId: tap.contactId }, type: tap.type });
  });
  const element = state.options ? <HowDidItGo open={state.open} onClose={close} {...state.options} /> : null;
  return { open, close, element, isOpen: state.open };
}
