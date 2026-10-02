"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconNote, IconSparkles, IconX } from "@/components/icons";
import { FormError } from "@/components/ui";
import { formatCents } from "@/lib/format";
import type { NotesProposal } from "@/lib/meeting-notes";
import { applyNotesAction, readNotesAction } from "@/app/dashboard/meeting-actions";

// "Meeting notes" (Oct 2, 2026). Two lines typed or dictated after a
// meeting; the AI reads them into a checklist — log it, mark it held, put
// the follow-up on the calendar, draft the quote from the catalog — and
// nothing happens until Apply. On a contact's page it is a header button;
// on the calendar it opens from "How did it go?" on a Meeting.
export function MeetingNotesButton({
  contactId,
  contactName,
  aiReady,
  eventId,
  onApplied,
  compact = false,
}: {
  contactId: string;
  contactName: string;
  aiReady: boolean;
  eventId?: string;
  onApplied?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={compact ? "text-xs text-[var(--brand)] underline" : "btn btn-ghost btn-sm"}
        data-testid="notes-open"
      >
        {!compact && <IconNote size={13} />}
        {compact ? "Paste or dictate meeting notes instead" : "Meeting notes"}
      </button>
      {open && (
        <MeetingNotesDialog
          contactId={contactId}
          contactName={contactName}
          aiReady={aiReady}
          eventId={eventId}
          onClose={() => {
            setOpen(false);
            // The box that opened this (the calendar's "How did it go?")
            // closes once the person has seen what was done, not before.
            if (applied) onApplied?.();
          }}
          onApplied={() => setApplied(true)}
        />
      )}
    </>
  );
}

type LineDraft = NotesProposal extends { quote: infer Q } ? (Q extends { lines: (infer L)[] } ? L : never) : never;

function MeetingNotesDialog({
  contactId,
  contactName,
  aiReady,
  eventId,
  onClose,
  onApplied,
}: {
  contactId: string;
  contactName: string;
  aiReady: boolean;
  eventId?: string;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [proposal, setProposal] = useState<NotesProposal | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  // What is ticked and what has been edited, starting from the proposal.
  const [logIt, setLogIt] = useState(true);
  const [summary, setSummary] = useState("");
  const [held, setHeld] = useState(true);
  const [followIt, setFollowIt] = useState(true);
  const [followOn, setFollowOn] = useState("");
  const [followWhat, setFollowWhat] = useState("");
  const [quoteIt, setQuoteIt] = useState(true);
  const [quoteTitle, setQuoteTitle] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [done, setDone] = useState<string[] | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  function read() {
    setError(undefined);
    start(async () => {
      const result = await readNotesAction({ contactId, notes });
      if (result.error || !result.proposal) {
        setError(result.error ?? "Couldn't read those notes");
        return;
      }
      const next = result.proposal;
      setProposal(next);
      setLogIt(true);
      setSummary(next.summary);
      setHeld(next.meetingHappened);
      setFollowIt(Boolean(next.followUp));
      setFollowOn(next.followUp?.on ?? "");
      setFollowWhat(next.followUp?.what ?? "");
      setQuoteIt(Boolean(next.quote && next.quote.lines.length > 0));
      setQuoteTitle(next.quote?.title ?? "");
      setLines(next.quote?.lines ?? []);
    });
  }

  function apply() {
    setError(undefined);
    start(async () => {
      const result = await applyNotesAction({
        contactId,
        eventId,
        notes,
        log: logIt ? { summary } : null,
        markHeld: held,
        followUp: followIt ? { on: followOn, what: followWhat } : null,
        quote: quoteIt && lines.length ? { title: quoteTitle, lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, note: line.note })) } : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onApplied?.();
      if (result.quoteId) {
        router.push(`/dashboard/quotes/${result.quoteId}`);
        return;
      }
      setDone(result.done ?? []);
      router.refresh();
    });
  }

  const total = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceCents), 0);
  const nothingTicked = !logIt && !held && !followIt && !(quoteIt && lines.length);

  return (
    <div className="modal-backdrop" onClick={() => !pending && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Meeting notes"
        onClick={(event) => event.stopPropagation()}
        className="card card-lit popover flex max-h-[90vh] w-full max-w-2xl flex-col"
        data-testid="notes-dialog"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">Meeting notes · {contactName}</h2>
            <p className="faint mt-0.5 text-xs">Nothing changes until you press Apply.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm">
            <IconX size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {done ? (
            <div data-testid="notes-done">
              <p className="text-sm font-medium">Done.</p>
              <ul className="muted mt-1 list-disc pl-5 text-sm">
                {done.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : !proposal ? (
            <>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={5}
                autoFocus
                className="textarea"
                placeholder="Walked the roof, they want the north side first, budget around 40k, decision by the 15th."
                aria-label="Your notes"
                data-testid="notes-text"
              />
              <p className="faint text-xs">On a phone, tap the microphone on the keyboard to talk instead of typing.</p>
              {!aiReady && (
                <p className="text-xs text-[var(--warn)]">AI drafting isn&apos;t switched on for this workspace yet, so notes can&apos;t be read automatically.</p>
              )}
            </>
          ) : (
            <div className="space-y-4" data-testid="notes-proposal">
              <Tick checked={logIt} onChange={setLogIt} label="Log it in their history" testId="notes-log">
                {logIt && <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} className="textarea mt-1.5" aria-label="Line for their history" data-testid="notes-summary" />}
              </Tick>

              <Tick checked={held} onChange={setHeld} label="Mark the meeting held (Meeting Completed)" testId="notes-held" />

              <Tick checked={followIt} onChange={setFollowIt} label="Put a follow-up call on the calendar" testId="notes-follow">
                {followIt && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <input type="date" value={followOn} onChange={(event) => setFollowOn(event.target.value)} className="input input-sm w-40" aria-label="Follow-up day" data-testid="notes-follow-on" />
                    <input value={followWhat} onChange={(event) => setFollowWhat(event.target.value)} className="input input-sm min-w-0 flex-1" aria-label="What the follow-up is for" placeholder="Follow up" />
                  </div>
                )}
              </Tick>

              {proposal.quote && (
                <Tick
                  checked={quoteIt && lines.length > 0}
                  onChange={setQuoteIt}
                  disabled={lines.length === 0}
                  label={lines.length ? "Draft the quote from your products" : "Nothing in your products matched, so no quote lines"}
                  testId="notes-quote"
                >
                  {lines.length > 0 && quoteIt && (
                    <div className="mt-1.5 space-y-2">
                      <input value={quoteTitle} onChange={(event) => setQuoteTitle(event.target.value)} className="input input-sm" aria-label="Quote title" data-testid="notes-quote-title" />
                      <table className="w-full text-xs" data-testid="notes-lines">
                        <thead>
                          <tr className="faint text-left">
                            <th className="py-1 font-normal">Product</th>
                            <th className="w-20 py-1 font-normal">Qty</th>
                            <th className="w-24 py-1 text-right font-normal">Price</th>
                            <th className="w-24 py-1 text-right font-normal">Line</th>
                            <th className="w-6" />
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line, index) => (
                            <tr key={`${line.productId}-${index}`} className="border-t border-[var(--border)]">
                              <td className="py-1.5 pr-2">
                                <span className="block">{line.name}</span>
                                {line.note && <span className="faint block">{line.note}</span>}
                              </td>
                              <td className="py-1.5">
                                <input
                                  type="number"
                                  min={0.01}
                                  step="any"
                                  value={line.quantity}
                                  onChange={(event) => {
                                    const quantity = Number(event.target.value);
                                    setLines(lines.map((row, at) => (at === index ? { ...row, quantity: Number.isFinite(quantity) ? quantity : row.quantity } : row)));
                                  }}
                                  className="input input-sm w-full"
                                  aria-label={`Quantity of ${line.name}`}
                                />
                              </td>
                              <td className="num py-1.5 text-right">
                                {formatCents(line.unitPriceCents)}
                                {line.unit ? <span className="faint"> /{line.unit}</span> : null}
                              </td>
                              <td className="num py-1.5 text-right">{formatCents(Math.round(line.quantity * line.unitPriceCents))}</td>
                              <td className="py-1.5 text-right">
                                <button type="button" onClick={() => setLines(lines.filter((_, at) => at !== index))} aria-label={`Take ${line.name} off`} className="btn btn-ghost btn-sm !px-1">
                                  <IconX size={10} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-right text-xs" data-testid="notes-total">
                        Total <span className="num font-medium">{formatCents(total)}</span>
                        {proposal.quote.budgetCents ? <span className="faint"> · their budget {formatCents(proposal.quote.budgetCents)}</span> : null}
                      </p>
                      <p className="faint text-xs">Prices are your catalog&apos;s. It opens as a draft quote for you to finish; nothing is sent.</p>
                    </div>
                  )}
                  {proposal.quote.notInCatalog.length > 0 && (
                    <p className="faint mt-1.5 text-xs" data-testid="notes-missing">
                      Not in your products, add by hand: {proposal.quote.notInCatalog.join("; ")}
                    </p>
                  )}
                </Tick>
              )}
            </div>
          )}
          <FormError message={error} />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          {done ? (
            <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
              Close
            </button>
          ) : !proposal ? (
            <button type="button" onClick={read} disabled={pending || !aiReady || notes.trim().length < 8} className="btn btn-primary btn-sm" data-testid="notes-read">
              <IconSparkles size={13} />
              {pending ? "Reading…" : "Read my notes"}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setProposal(null)} disabled={pending} className="btn btn-ghost btn-sm">
                Back to the notes
              </button>
              <button type="button" onClick={apply} disabled={pending || nothingTicked} className="btn btn-primary btn-sm" data-testid="notes-apply">
                {pending ? "Applying…" : "Apply"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Tick({
  checked,
  onChange,
  label,
  children,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  children?: React.ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--brand)]" data-testid={testId} />
        {label}
      </label>
      {children ? <div className="pl-6">{children}</div> : null}
    </div>
  );
}
