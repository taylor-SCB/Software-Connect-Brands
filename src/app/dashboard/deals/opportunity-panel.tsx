"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { PipelineColumn } from "@/lib/constants";
import { dollarsToCents, formatCents } from "@/lib/format";
import { shortDay, time12 } from "@/lib/health";
import { LifecycleMeter } from "@/components/lifecycle-meter";
import { DealJourney } from "@/components/deal-journey";
import { LeadLabelPicker } from "@/components/lead-label-chip";
import {
  IconCalendar,
  IconCheck,
  IconClock,
  IconFileText,
  IconMail,
  IconMessage,
  IconNote,
  IconPhone,
  IconPlus,
  IconSignature,
  IconX,
} from "@/components/icons";
import { JourneyNext, NEXT } from "@/app/dashboard/contracts/journey-next";
import { setQuoteStatus } from "@/app/dashboard/quotes/actions";
import type { HowDidItGoOptions } from "@/components/how-did-it-go/how-did-it-go";
import type { BookTarget } from "@/components/book-meeting/book-meeting";
import { dayChips, TIME_CHIPS } from "@/components/how-did-it-go/dates";
import {
  loadOpportunity,
  markMeetingHeld,
  markMeetingNoShow,
  rescheduleMeeting,
  saveOpportunity,
  type OpportunityDetail,
  type OpportunityPerson,
  type PanelMeeting,
} from "./opportunity-actions";
import { MoveMenu } from "./move-menu";
import { FollowUpButton, MeetingSuggest, QuietBadge, SuggestedLabel } from "./ai-assist-ui";

type Role = OpportunityPerson["role"];
const ROLES: { role: Role; label: string }[] = [
  { role: "PRIMARY", label: "Primary POC" },
  { role: "ASSOCIATED", label: "Associated POC" },
  { role: "HIDDEN", label: "Do Not List" },
];

// The meter's own next steps that are paperwork. Once the DealJourney strip
// has a Next, it does these where the panel is (or opens the page that
// does), so the meter's button would only say the same thing twice.
const PAPERWORK_ACTIONS = new Set(["start-quote", "quote-yes", "signing-link", "deposit"]);

// Where the DealJourney strip pins its Next on every other page (its
// sticky rule in globals.css). In the panel, full screen there, the Next
// sits in the panel's own footer instead: that is already the foot of the
// screen, and nothing is position:fixed inside the panel.
const PHONE_QUERY = "(max-width: 639px)";
function usePhone() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(PHONE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

// A tile opened (Oct 27, 2026; BDR redesign, Nov 11, 2026). On top: the
// full lifecycle meter with its reason and the one next step, and for a
// tile with a deal the DealJourney strip (Meeting · Quote · Contract ·
// Signed · Deposit) with its one Next, as on the quote, the Contract
// Coordinator and the contract (Release 8). Then its
// name, stage, lead label and rep; the People, each with Call / Text /
// Email / Log and the Primary POC / Associated POC / Do Not List switch
// (one each, the other two grey out, one Primary); the meetings with their
// time and note, upcoming first, each answerable (Held / No-show /
// Reschedule) and + Book a meeting; the quotes. Nothing in the form is
// written until Save, which shows only once something changed; the Stage
// menu saves first. Logging, booking and the meeting answers save on
// their own, each with Undo.
//
// Log and Book open the shared sheets ("How did it go?" and Book meeting,
// docs/bdr-sprint-kit/api-log-sheet.md), which live on the board so their
// "Saved · Undo" (the board's one toast) outlives the panel. Each is told
// this tile (opportunityId): a meeting answered, logged or booked from
// here is this tile's. Anything they write bumps `reload`.
export function OpportunityPanel({
  id,
  timeZone,
  onClose,
  onMove,
  onSaved,
  sheets,
  reload = 0,
  ai = false,
  quietDays = null,
  suggestedLabel = null,
}: {
  id: string;
  timeZone: string;
  // The board's shared sheets.
  sheets: { log: (options: HowDidItGoOptions) => void; book: (target: BookTarget) => void };
  // Bumped by the board when a sheet saved, or its Undo ran: read again.
  reload?: number;
  // The AI helpers and the gone-quiet badge (Nov 10, 2026).
  ai?: boolean;
  quietDays?: number | null;
  suggestedLabel?: { label: string; reason: string } | null;
  onClose: () => void;
  // `saved` carries the name when the panel's edits were saved on the way.
  onMove: (column: PipelineColumn, saved?: { title: string }) => void;
  // Something saved from inside the panel: "Saved · Undo" on the board.
  onSaved?: (text: string, batchId?: string) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [title, setTitle] = useState("");
  const [leadLabel, setLeadLabel] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [value, setValue] = useState("");
  // Each person's role; null is "nothing ticked yet" for someone just added.
  const [people, setPeople] = useState<(Omit<OpportunityPerson, "role"> & { role: Role | null })[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  // The tile whose name, label, rep, value and people fill the form.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    loadOpportunity(id).then((result) => {
      if (!live) return;
      if ("error" in result) {
        setLoadError(result.error);
        return;
      }
      setDetail(result);
      // A reload after a log or a meeting answer keeps what is being typed.
      if (seeded.current === id) return;
      seeded.current = id;
      setTitle(result.title);
      setLeadLabel(result.leadLabel);
      setOwnerId(result.ownerId ?? "");
      setValue(result.deal ? (result.deal.valueCents / 100).toFixed(2) : "");
      setPeople(result.people);
    });
    return () => {
      live = false;
    };
  }, [id, version, reload]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Something saved from inside: tell the board (with Undo), refresh both.
  function saved(text: string, batchId?: string) {
    onSaved?.(text, batchId);
    router.refresh();
    setVersion((n) => n + 1);
  }

  // The shared sheets, about this tile. A Call or Text tapped in a
  // person's row opens "How did it go?" on its own when the tab comes back
  // (the board's sheet reads data-contact-id, and this tile as the open one).
  function logWith(contactId: string, name: string, type: "PHONE_CALL" | "MEETING" = "PHONE_CALL") {
    sheets.log({ target: { contactId }, type, name, today: detail?.today, opportunityId: id });
  }
  function bookWith(contactId: string, name: string) {
    sheets.book({ contactId, name, today: detail?.today, opportunityId: id });
  }

  // Ticking one of a person's three boxes greys the other two; unticking
  // frees them. There is one Primary: ticking it on someone moves the old
  // Primary to Associated.
  function tick(contactId: string, role: Role) {
    setPeople((rows) =>
      rows.map((row) => {
        if (row.contactId === contactId) return { ...row, role: row.role === role ? null : role };
        if (role === "PRIMARY" && row.role === "PRIMARY") return { ...row, role: "ASSOCIATED" };
        return row;
      }),
    );
  }

  // Anything changed in the panel since it opened.
  function unsaved() {
    if (!detail) return false;
    const roles = (rows: { contactId: string; role: Role | null }[]) => rows.map((row) => `${row.contactId}:${row.role}`).join(",");
    return (
      title !== detail.title ||
      leadLabel !== detail.leadLabel ||
      ownerId !== (detail.ownerId ?? "") ||
      value !== (detail.deal ? (detail.deal.valueCents / 100).toFixed(2) : "") ||
      roles(people) !== roles(detail.people)
    );
  }

  // `then` runs once the save has gone through and the panel is closed.
  function save(then?: (saved: { title: string }) => void) {
    if (!detail || pending) return;
    const unset = people.find((row) => row.role === null);
    if (unset) {
      setError(`Tick Primary POC, Associated POC or Do Not List for ${unset.name}`);
      return;
    }
    setError(undefined);
    start(async () => {
      const result = await saveOpportunity({
        id: detail.id,
        title,
        leadLabel,
        ownerId,
        valueCents: detail.deal && !detail.deal.hasQuotes ? dollarsToCents(value) : null,
        people: people.map((row) => ({ contactId: row.contactId, role: row.role as Role })),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
      then?.({ title: title.trim() });
    });
  }

  // The Stage menu in the panel (UX review, Nov 10, 2026): it used to
  // close the panel and drop every unsaved edit. Edits made here are saved
  // first, as Save would; a save that is refused keeps the panel open with
  // its message and moves nothing. The stage it is already in does nothing.
  function moveFromPanel(next: PipelineColumn) {
    if (next === column) return;
    if (!unsaved()) {
      onClose();
      onMove(next);
      return;
    }
    save((saved) => onMove(next, saved));
  }

  const column = detail?.column === "ARCHIVED" ? "CONTRACT_SENT" : ((detail?.column ?? "MEETING_SET") as PipelineColumn);
  const isDeal = Boolean(detail?.deal && !["LEAD", "CONTACTED"].includes(detail.deal.stage));
  const primary = people.find((row) => row.role === "PRIMARY");
  const dirty = unsaved();
  const health = detail?.health ?? null;
  // The DealJourney strip, for a tile with a deal. A lost deal keeps the
  // strip (how far it got) but offers no next step.
  const journey = detail?.journey ?? null;
  const journeyNext = journey && detail?.deal?.stage !== "LOST" ? journey.journey.next : null;
  const meterAction = health?.meter.action ?? null;
  const action = meterAction && !(journeyNext && PAPERWORK_ACTIONS.has(meterAction.key)) ? meterAction : null;
  const phone = usePhone();
  // The meeting "Mark held" answers (the shared rule, as health's "Did the
  // Nov 6 meeting happen?"). With none — a tile at Meeting Set with no
  // meeting known — Mark held opens How did it go? on Meeting for the
  // Primary, which answers this tile's meeting or logs one on it.
  const toHold = detail?.dueMeetingId ?? null;
  const latestQuote = detail?.deal?.quotes[0] ?? null;
  const nextHref =
    action?.key === "quote-yes" && latestQuote
      ? `/dashboard/quotes/${latestQuote.id}`
      : (action?.key === "signing-link" || action?.key === "deposit") && detail?.deal
        ? `/dashboard/deals/tracker?dealId=${detail.deal.id}`
        : undefined;
  // The one next step, and whether this panel can run it: a button is
  // drawn only for an action that does something here.
  function runNext() {
    if (!detail || !action) return;
    if (action.key === "call" && primary) logWith(primary.contactId, primary.name);
    else if (action.key === "book" && primary) bookWith(primary.contactId, primary.name);
    else if (action.key === "mark-held" && toHold) answerHeld(toHold);
    else if (action.key === "mark-held" && primary) logWith(primary.contactId, primary.name, "MEETING");
    else if (action.key === "start-quote") moveFromPanel("QUOTE_SENT");
  }
  const runnable = Boolean(
    action &&
      (nextHref ||
        action.key === "start-quote" ||
        ((action.key === "call" || action.key === "book") && primary) ||
        (action.key === "mark-held" && (toHold || primary))),
  );

  const [early, setEarly] = useState<{ meetingId: string; text: string } | null>(null);
  function answerHeld(meetingId: string, isEarly = false) {
    start(async () => {
      const result = await markMeetingHeld(meetingId, { early: isEarly });
      if (result.confirmEarly) {
        setEarly({ meetingId, text: result.error ?? "Did it happen early?" });
        return;
      }
      setEarly(null);
      if (result.error) return setError(result.error);
      saved(result.success ?? "Held", result.batchId);
    });
  }

  // "Customer said yes" marks the quote Accepted from here and reloads the
  // panel, so the strip moves on to Make contract. "Make contract" opens
  // the Contract Coordinator under the Pipeline, the way the panel's own
  // link does (how I got there is how I go back).
  function quoteYes(quote: { id: string; number: number }) {
    start(async () => {
      const form = new FormData();
      form.set("quoteId", quote.id);
      form.set("status", "ACCEPTED");
      await setQuoteStatus(form);
      saved(`QUO-${quote.number} accepted`);
    });
  }
  const journeyButton =
    journey && journeyNext ? (
      <JourneyNext
        next={journeyNext}
        refs={journey.refs}
        page="coordinator"
        here={{
          ...(journey.refs.quote
            ? {
                "quote-yes": (
                  <button
                    type="button"
                    onClick={() => quoteYes(journey.refs.quote!)}
                    disabled={pending}
                    className={NEXT}
                    data-testid="journey-next"
                  >
                    <IconCheck size={13} />
                    {journeyNext.label}
                  </button>
                ),
              }
            : {}),
          "make-contract": (
            <Link
              href={`/dashboard/deals/tracker?dealId=${journey.refs.dealId}${journey.refs.quote ? `&quoteId=${journey.refs.quote.id}` : ""}`}
              className={NEXT}
              data-testid="journey-next"
            >
              <IconSignature size={13} />
              {journeyNext.label}
            </Link>
          ),
        }}
      />
    ) : null;

  return (
    <>
      {createPortal(
    <div
      className="fixed inset-0 z-[70] flex justify-end bg-[var(--scrim)]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* .popover alone (it overrode everything .card gave): a glass card's
          blur is the box a pinned button is placed against, and the
          DealJourney's Next lives in here. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Opportunity"
        className="popover flex h-full w-full max-w-xl flex-col rounded-none"
        data-testid="opportunity-panel"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline-3)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-1">{isDeal ? "Deal" : "Opportunity"}</p>
            {detail ? (
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
                aria-label="Name"
                className="input w-full text-base font-semibold"
                data-testid="panel-title"
              />
            ) : (
              <p className="faint text-sm">{loadError ?? "Loading…"}</p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm min-h-9 min-w-9 justify-center !px-1.5" data-testid="panel-close">
            <IconX size={14} />
          </button>
        </div>

        {detail && (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {health && (
              <section className="space-y-2.5" data-testid="panel-health">
                <LifecycleMeter health={health} size="header" onNext={runnable ? runNext : undefined} nextHref={nextHref} testId="panel-meter" />
                {action && runnable && (
                  nextHref ? (
                    <Link href={nextHref} className="btn btn-primary btn-sm min-h-11 w-full justify-center sm:w-auto" data-testid="panel-next">
                      {action.label}
                    </Link>
                  ) : (
                    <button type="button" onClick={runNext} disabled={pending} className="btn btn-primary btn-sm min-h-11 w-full justify-center sm:w-auto" data-testid="panel-next">
                      {action.label}
                    </button>
                  )
                )}
                {early && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] p-2.5 text-sm" role="alert" data-testid="panel-early">
                    <span className="min-w-0 flex-1">{early.text}</span>
                    <button type="button" onClick={() => setEarly(null)} className="btn btn-ghost btn-sm min-h-9">
                      No
                    </button>
                    <button type="button" onClick={() => answerHeld(early.meetingId, true)} className="btn btn-primary btn-sm min-h-9" data-testid="panel-early-yes">
                      Yes, it happened
                    </button>
                  </div>
                )}
              </section>
            )}

            {journey && (
              <div data-testid="panel-journey">
                <DealJourney
                  journey={journey.journey}
                  tone={health?.tone ?? "good"}
                  next={phone ? undefined : journeyButton}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="text-[var(--text-dim)]">Stage</span>
                <MoveMenu current={column} archived={detail.column === "ARCHIVED"} locked={isDeal} onMove={moveFromPanel} />
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-[var(--text-dim)]">Lead label</span>
                <LeadLabelPicker value={leadLabel} customLabels={detail.customLabels} onChange={setLeadLabel} />
                {!leadLabel && <SuggestedLabel opportunityId={detail.id} rule={suggestedLabel} ai={ai} onAccept={setLeadLabel} />}
              </span>
              <label className="flex items-center gap-1.5">
                <span className="text-[var(--text-dim)]">Rep</span>
                <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="select input-sm w-44" data-testid="panel-rep">
                  <option value="">Unassigned</option>
                  {detail.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(quietDays !== null || ai) && (
              <div className="flex flex-wrap items-center gap-2" data-testid="panel-quiet">
                {quietDays !== null && <QuietBadge days={quietDays} />}
                {ai && <FollowUpButton opportunityId={detail.id} />}
              </div>
            )}

            {ai && (
              <MeetingSuggest
                opportunityId={detail.id}
                canSetValue={Boolean(detail.deal && isDeal && !detail.deal.hasQuotes)}
                onPrimary={(contactId) => {
                  const row = people.find((person) => person.contactId === contactId);
                  if (row && row.role !== "PRIMARY") {
                    setPeople((rows) =>
                      rows.map((person) =>
                        person.contactId === contactId
                          ? { ...person, role: "PRIMARY" }
                          : person.role === "PRIMARY"
                            ? { ...person, role: "ASSOCIATED" }
                            : person,
                      ),
                    );
                  }
                }}
                onLabel={setLeadLabel}
                onValue={(cents) => setValue((cents / 100).toFixed(2))}
              />
            )}

            {detail.deal && isDeal && (
              <label className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[var(--text-dim)]">Value{detail.deal.hasQuotes ? " (from its quotes)" : ""}</span>
                {detail.deal.hasQuotes ? (
                  <span className="num text-sm font-medium">{formatCents(detail.deal.valueCents)}</span>
                ) : (
                  <input
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    inputMode="decimal"
                    className="input input-sm num w-36 text-right"
                    data-testid="panel-value"
                  />
                )}
              </label>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">People</h3>
                <span className="text-xs text-[var(--text-dim)]">One box each · one Primary</span>
              </div>
              <ul className="divide-y divide-[var(--hairline-3)]" data-testid="panel-people">
                {people.map((row) => (
                  <li key={row.contactId} className="min-w-0 py-2.5" data-testid="panel-person" data-name={row.name}>
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                      <div className="min-w-0 flex-1">
                        <Link href={`/dashboard/contacts/${row.contactId}`} className="link block text-sm font-medium [overflow-wrap:anywhere]">
                          {row.name}
                        </Link>
                        <span className="block text-xs text-[var(--text-dim)] [overflow-wrap:anywhere]">
                          {[row.company, row.phone, row.fromMeeting ? "from the meeting" : "added"].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <ReachButtons person={row} onLog={() => logWith(row.contactId, row.name)} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label={`${row.name}: role on this opportunity`}>
                      {ROLES.map((item) => (
                        <label key={item.role} className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-xs">
                          {/* A greyed-out box is the browser's own disabled look,
                              as everywhere else; an extra 30% fade made it all
                              but vanish on white (UX review). */}
                          <input
                            type="checkbox"
                            checked={row.role === item.role}
                            disabled={row.role !== null && row.role !== item.role}
                            onChange={() => tick(row.contactId, item.role)}
                            aria-label={`${row.name}: ${item.label}`}
                            className="h-4 w-4 accent-[var(--brand)]"
                            data-testid={`role-${item.role}`}
                          />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              <AddPerson
                exclude={people.map((row) => row.contactId)}
                onAdd={(person) => setPeople((rows) => [...rows, { ...person, role: "ASSOCIATED", fromMeeting: false }])}
              />
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Meetings</h3>
                {primary && (
                  <button type="button" onClick={() => bookWith(primary.contactId, primary.name)} className="link inline-flex min-h-9 items-center gap-1 text-xs" data-testid="panel-book">
                    <IconPlus size={12} />
                    Book a meeting
                  </button>
                )}
              </div>
              {detail.meetings.length === 0 ? (
                <p className="text-xs text-[var(--text-dim)]">No meeting logged on this one.</p>
              ) : (
                <ul className="space-y-2" data-testid="panel-meetings">
                  {detail.meetings.map((meeting) => (
                    <MeetingRow
                      key={meeting.id}
                      meeting={meeting}
                      today={detail.today}
                      onHeld={() => answerHeld(meeting.id)}
                      onNoShow={() =>
                        start(async () => {
                          const result = await markMeetingNoShow(meeting.id);
                          if (result.error) return setError(result.error);
                          saved(result.success ?? "No-show", result.batchId);
                        })
                      }
                      onReschedule={async (on, time) => {
                        const result = await rescheduleMeeting(meeting.id, { on, time });
                        if (result.error) return result.error;
                        saved(result.success ?? "Rescheduled", result.batchId);
                        return null;
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Quotes</h3>
                {primary && (
                  <Link
                    href={`/dashboard/quotes/new?contactId=${primary.contactId}${detail.deal ? `&dealId=${detail.deal.id}` : ""}`}
                    className="btn btn-ghost btn-sm"
                    data-testid="panel-new-quote"
                  >
                    <IconPlus size={12} />
                    New quote
                  </Link>
                )}
              </div>
              {detail.deal?.quotes.length ? (
                <ul className="space-y-1 text-xs">
                  {detail.deal.quotes.map((quote) => (
                    <li key={quote.id}>
                      <Link href={`/dashboard/quotes/${quote.id}`} className="link flex items-center gap-1.5">
                        <IconFileText size={12} />
                        <span className="docnum">QUO-{quote.number}</span>
                        <span className="truncate">{quote.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--text-dim)]">No quotes yet.</p>
              )}
              {detail.deal && (
                <Link
                  href={`/dashboard/deals/tracker?dealId=${detail.deal.id}`}
                  className="mt-2 flex items-center gap-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
                  data-testid="panel-coordinator"
                >
                  <IconClock size={12} />
                  Contract Coordinator
                </Link>
              )}
            </section>
          </div>
        )}

        <div className="border-t border-[var(--hairline-3)] px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3">
          {error && (
            <p className="mb-2 text-xs text-[var(--danger)]" data-testid="panel-error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm min-h-9" data-testid="panel-cancel">
              {dirty ? "Cancel" : "Close"}
            </button>
            {dirty && (
              <button type="button" onClick={() => save()} disabled={!detail || pending} className="btn btn-primary btn-sm min-h-9" data-testid="panel-save">
                {pending ? "Saving…" : "Save"}
              </button>
            )}
          </div>
          {/* On a phone the strip's Next is here, full width at the foot
              of the full-screen panel, as it is pinned on every other page. */}
          {phone && journeyButton && (
            <div className="mt-2.5 flex flex-col" data-testid="panel-journey-next">
              {journeyButton}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
      )}
    </>
  );
}

/* ------------------------------ People rows ------------------------------ */

function ReachButtons({
  person,
  onLog,
}: {
  person: { contactId: string; name: string; phone: string | null; email: string | null };
  onLog: () => void;
}) {
  const button = "btn btn-ghost btn-sm min-h-9 min-w-9 justify-center !px-2 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11";
  const digits = person.phone?.replace(/[^\d+]/g, "") ?? "";
  return (
    <div className="flex shrink-0 items-center gap-1" data-testid="panel-reach" data-contact-id={person.contactId}>
      {digits ? (
        <>
          <a href={`tel:${digits}`} className={button} aria-label={`Call ${person.name}`} title={`Call ${person.phone}`} data-testid="panel-call">
            <IconPhone size={13} />
            <span className="max-sm:sr-only">Call</span>
          </a>
          <a href={`sms:${digits}`} className={button} aria-label={`Text ${person.name}`} data-testid="panel-text">
            <IconMessage size={13} />
            <span className="max-sm:sr-only">Text</span>
          </a>
        </>
      ) : null}
      {person.email && (
        <a href={`mailto:${person.email}`} className={button} aria-label={`Email ${person.name}`} title={person.email} data-testid="panel-email">
          <IconMail size={13} />
          <span className="max-sm:sr-only">Email</span>
        </a>
      )}
      <button type="button" onClick={onLog} className={button} aria-label={`Log a touch with ${person.name}`} data-testid="panel-log">
        <IconNote size={13} />
        <span className="max-sm:sr-only">Log</span>
      </button>
    </div>
  );
}

/* -------------------------------- Meetings -------------------------------- */

function meetingWhen(meeting: PanelMeeting) {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${meeting.day}T12:00:00Z`),
  );
  const time = time12(meeting.time);
  return time ? `${day}, ${time}` : day;
}

function MeetingRow({
  meeting,
  today,
  onHeld,
  onNoShow,
  onReschedule,
}: {
  meeting: PanelMeeting;
  today: string;
  onHeld: () => void;
  onNoShow: () => void;
  onReschedule: (on: string, time: string | null) => Promise<string | null>;
}) {
  const [moving, setMoving] = useState(false);
  const state = meeting.outcome === "HELD" ? "Held" : meeting.outcome === "NO_SHOW" ? "No-show" : meeting.ahead ? "Coming up" : "How did it go?";
  return (
    <li className="rounded-lg border border-[var(--hairline-3)] p-2.5 text-xs" data-testid="panel-meeting" data-state={state}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <IconCalendar size={12} className="text-[var(--text-dim)]" />
        <span className="font-medium" data-testid="panel-meeting-when">
          {meetingWhen(meeting)}
        </span>
        {meeting.where && <span className="text-[var(--text-dim)]">· {meeting.where}</span>}
        <span className={`ml-auto ${state === "How did it go?" ? "font-semibold text-[var(--text)]" : "text-[var(--text-dim)]"}`}>{state}</span>
      </div>
      {meeting.note && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[var(--text-dim)]">{meeting.note}</p>}
      {meeting.outcome !== "HELD" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!meeting.ahead && !meeting.outcome && (
            <>
              <button type="button" onClick={onHeld} className="btn btn-primary btn-sm min-h-9" data-testid="panel-meeting-held">
                Held
              </button>
              <button type="button" onClick={onNoShow} className="btn btn-ghost btn-sm min-h-9" data-testid="panel-meeting-noshow">
                No-show
              </button>
            </>
          )}
          {meeting.ahead && (
            <button type="button" onClick={onHeld} className="btn btn-ghost btn-sm min-h-9" data-testid="panel-meeting-held">
              It happened early
            </button>
          )}
          <button type="button" onClick={() => setMoving(!moving)} className="btn btn-ghost btn-sm min-h-9" data-testid="panel-meeting-reschedule">
            Reschedule
          </button>
        </div>
      )}
      {moving && (
        <DayTimePicker
          today={today}
          initialTime={meeting.time}
          saveLabel={(on) => `Move to ${shortDay(on)}`}
          onSave={async (on, time) => {
            const problem = await onReschedule(on, time);
            if (!problem) setMoving(false);
            return problem;
          }}
          onCancel={() => setMoving(false)}
        />
      )}
    </li>
  );
}

function DayTimePicker({
  today,
  initialTime,
  saveLabel,
  onSave,
  onCancel,
}: {
  today: string;
  initialTime: string | null;
  saveLabel: (on: string) => string;
  onSave: (on: string, time: string | null) => Promise<string | null>;
  onCancel: () => void;
}) {
  // The same day and time chips as the sheets (@/components/how-did-it-go/dates).
  const chips = dayChips(today);
  const [on, setOn] = useState(chips[0].on);
  const [time, setTime] = useState<string | null>(initialTime ?? "10:00");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chip = (active: boolean) =>
    `min-h-9 rounded-lg border px-2.5 text-xs font-medium [@media(pointer:coarse)]:min-h-11 ${
      active ? "border-[var(--brand)] bg-[var(--hover)] text-[var(--text)]" : "border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]"
    }`;
  return (
    <div className="mt-2 space-y-2" data-testid="day-time-picker">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((row) => (
          <button key={row.key} type="button" onClick={() => setOn(row.on)} className={chip(on === row.on)} title={row.sub} data-testid="picker-day" data-on={row.on}>
            {row.label}
          </button>
        ))}
        <input
          type="date"
          value={on}
          min={today}
          onChange={(event) => event.target.value && setOn(event.target.value)}
          aria-label="Pick a day"
          className="input input-sm w-auto"
          data-testid="picker-date"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TIME_CHIPS.map((row) => (
          <button key={row.value} type="button" onClick={() => setTime(row.value)} className={chip(time === row.value)} data-testid="picker-time">
            {row.label}
          </button>
        ))}
        <button type="button" onClick={() => setTime(null)} className={chip(time === null)} data-testid="picker-time-none">
          No time
        </button>
      </div>
      {error && (
        <p className="text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm min-h-9">
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const problem = await onSave(on, time);
              if (problem) setError(problem);
            })
          }
          className="btn btn-primary btn-sm min-h-9"
          data-testid="picker-save"
        >
          {pending ? "Saving…" : saveLabel(on)}
        </button>
      </div>
    </div>
  );
}

type Found = { id: string; name: string; company: string | null; email: string | null; phone: string | null };

// "+ Add contact": search the workspace's contacts by name, company,
// email or phone; a pick joins as Associated POC.
function AddPerson({
  exclude,
  onAdd,
}: {
  exclude: string[];
  onAdd: (person: { contactId: string; name: string; company: string | null; email: string | null; phone: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/dashboard/contacts/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : []))
        .then((rows: Found[]) => setResults(rows))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="link mt-2 inline-flex min-h-9 items-center gap-1 text-xs" data-testid="panel-add-person">
        <IconPlus size={12} />
        Add contact
      </button>
    );
  }
  const shown = query.trim().length >= 2 ? results.filter((row) => !exclude.includes(row.id)) : [];
  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] p-2">
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search contacts by name, company, email or phone"
        aria-label="Search contacts"
        className="input input-sm"
        data-testid="panel-add-search"
      />
      <ul className="mt-1 max-h-48 overflow-y-auto">
        {query.trim().length >= 2 && shown.length === 0 && <li className="px-2 py-1.5 text-xs text-[var(--text-dim)]">Nobody new matches.</li>}
        {shown.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => {
                onAdd({ contactId: row.id, name: row.name, company: row.company, email: row.email, phone: row.phone });
                setQuery("");
                setResults([]);
              }}
              className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--hover)]"
              data-testid="panel-add-result"
            >
              <span className="font-medium">{row.name}</span>
              <span className="text-[var(--text-dim)]">{[row.company, row.email, row.phone].filter(Boolean).join(" · ")}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setOpen(false)} className="link mt-1 min-h-9 text-xs">
        Done adding
      </button>
    </div>
  );
}
