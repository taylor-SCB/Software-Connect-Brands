"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, type ActivityTypeValue } from "@/lib/constants";
import { FormError } from "@/components/ui";
import { IconCheck, IconMail, IconPhone, IconSparkles } from "@/components/icons";
import { MeetingNotesButton } from "@/components/meeting-notes";
import type { CallRow } from "@/lib/call-list";
import { logCallAction, markHeldAction, openersAction } from "./actions";

// The Call List's two sections — the rep's own and Nobody's — sharing one
// set of openers, drafted after the page has drawn so the list never waits
// on the AI.
export function CallSections({
  mine,
  nobodys,
  openers: initial,
  whose,
  aiReady,
  autoDraft,
  showOwner,
  emptyMine,
  headers,
}: {
  mine: CallRow[];
  nobodys: CallRow[];
  openers: Record<string, string>;
  whose: string;
  aiReady: boolean;
  autoDraft: boolean;
  showOwner: boolean;
  emptyMine: React.ReactNode;
  headers: { mine: React.ReactNode; nobodys: React.ReactNode };
}) {
  const [openers, setOpeners] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [drafting, start] = useTransition();
  const asked = useRef(false);

  function draft() {
    setError(undefined);
    start(async () => {
      const result = await openersAction(whose);
      if (result.openers) setOpeners((current) => ({ ...current, ...result.openers }));
      if (result.error) setError(result.error);
    });
  }

  useEffect(() => {
    if (!autoDraft || asked.current) return;
    asked.current = true;
    draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after the first draw
  }, [autoDraft]);

  const missing = [...mine, ...nobodys].some((row) => !openers[row.key]);

  return (
    <>
      <div className="card card-lit mb-5">
        {headers.mine}
        {aiReady && (drafting || missing || error) && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-2">
            {drafting && (
              <span className="faint text-xs" data-testid="openers-drafting">
                Drafting openers…
              </span>
            )}
            {!drafting && missing && (
              <button type="button" onClick={draft} className="btn btn-ghost btn-sm" data-testid="openers-draft">
                <IconSparkles size={13} />
                Draft openers
              </button>
            )}
          </div>
        )}
        {error && (
          <div className="px-4">
            <FormError message={error} />
          </div>
        )}
        {mine.length === 0 ? emptyMine : <CallRows rows={mine} openers={openers} showOwner={showOwner} aiReady={aiReady} />}
      </div>
      {nobodys.length > 0 && (
        <div className="card card-lit" data-testid="call-nobodys">
          {headers.nobodys}
          <CallRows rows={nobodys} openers={openers} showOwner={false} aiReady={aiReady} />
        </div>
      )}
    </>
  );
}

// A list of call rows. Also the Overview's "Today's calls", compact.
export function CallRows({
  rows,
  openers,
  showOwner,
  aiReady,
  compact = false,
}: {
  rows: CallRow[];
  openers: Record<string, string>;
  showOwner: boolean;
  aiReady: boolean;
  compact?: boolean;
}) {
  return (
    <ul className="divide-y divide-[var(--border)]" data-testid="call-rows">
      {rows.map((row) => (
        <Row key={row.key} row={row} opener={openers[row.key]} showOwner={showOwner} compact={compact} aiReady={aiReady} />
      ))}
    </ul>
  );
}

function Row({ row, opener, showOwner, compact, aiReady }: { row: CallRow; opener?: string; showOwner: boolean; compact: boolean; aiReady: boolean }) {
  const router = useRouter();
  const [logging, setLogging] = useState(false);
  const [type, setType] = useState<ActivityTypeValue>("PHONE_CALL");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);

  function run(action: () => Promise<{ error?: string }>) {
    setError(undefined);
    start(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else {
        setGone(true);
        router.refresh();
      }
    });
  }

  if (gone) return null;
  const href = row.contactId ? `/dashboard/contacts/${row.contactId}` : row.companyId ? `/dashboard/companies/${row.companyId}` : "#";

  return (
    <li className="px-4 py-3" data-testid="call-row" data-kind={row.kind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <Link href={href} className="font-medium hover:underline">
              {row.name}
            </Link>
            {row.company && <span className="faint"> · {row.company}</span>}
            {showOwner && <span className="badge ml-2 align-middle">{row.ownerName ?? "Nobody's"}</span>}
          </p>
          <p className="mt-0.5 text-sm text-[var(--brand)]" data-testid="call-reason">
            {row.reason}
          </p>
          {row.also.length > 0 && <p className="faint text-xs">Also: {row.also.join(" · ")}</p>}
          {!compact && opener && (
            <p className="muted mt-1 text-sm italic" data-testid="call-opener">
              “{opener}”
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.phone && (
            <a href={`tel:${row.phone}`} className="btn btn-ghost btn-sm" title={row.phone}>
              <IconPhone size={13} />
              {compact ? null : row.phone}
            </a>
          )}
          {!compact && row.email && (
            <a href={`mailto:${row.email}`} className="btn btn-ghost btn-sm !px-2" title={row.email} aria-label={`Email ${row.name}`}>
              <IconMail size={13} />
            </a>
          )}
          {!compact && row.quoteId && (
            <Link href={`/dashboard/quotes/${row.quoteId}`} className="btn btn-ghost btn-sm">
              Quote
            </Link>
          )}
          {row.kind === "held" && row.eventId ? (
            <button type="button" disabled={pending} onClick={() => run(() => markHeldAction(row.eventId!))} className="btn btn-primary btn-sm" data-testid="call-held">
              <IconCheck size={12} />
              {pending ? "Saving…" : "Mark held"}
            </button>
          ) : (
            <button type="button" onClick={() => setLogging(!logging)} className="btn btn-primary btn-sm" data-testid="call-log">
              <IconCheck size={12} />
              Log it
            </button>
          )}
        </div>
      </div>

      {row.kind === "held" && row.contactId && !compact && (
        <div className="mt-1">
          <MeetingNotesButton compact contactId={row.contactId} contactName={row.name} aiReady={aiReady} eventId={row.eventId ?? undefined} onApplied={() => setGone(true)} />
        </div>
      )}

      {logging && (
        <div className="mt-2 space-y-2 rounded-lg border border-[var(--border)] p-3" data-testid="call-log-box">
          <div className="flex flex-wrap gap-1.5">
            {ACTIVITY_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                aria-pressed={option === type}
                className={`btn btn-sm ${option === type ? "btn-primary" : "btn-ghost"}`}
              >
                {ACTIVITY_LABELS[option]}
              </button>
            ))}
          </div>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} className="textarea" placeholder="How did it go? (optional)" aria-label="How did it go" data-testid="call-note" />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => logCallAction({ contactId: row.contactId ?? undefined, followUpIds: row.followUpIds, type, note }))}
              className="btn btn-primary btn-sm"
              data-testid="call-log-save"
            >
              {pending ? "Logging…" : `Log ${ACTIVITY_LABELS[type].toLowerCase()}`}
            </button>
            <button type="button" onClick={() => setLogging(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
      <FormError message={error} />
    </li>
  );
}
