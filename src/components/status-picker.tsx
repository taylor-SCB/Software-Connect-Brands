"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui";
import { IconChevronDown } from "@/components/icons";
import {
  CONTACT_STATUS_LABELS,
  PIPELINE_STEPS,
  STATUS_REASONS,
  STATUS_REASON_LABELS,
  type ContactStatusValue,
  type StatusReasonValue,
} from "@/lib/constants";
import { setRecordStatus } from "@/app/dashboard/status-actions";
import { FloatingMenu } from "@/components/floating-menu";

// Which pipeline steps a move passes through without a date on record:
// the same rule the server applies, so the form asks for exactly those.
function stepsFor(current: string, target: string): string[] {
  const to = PIPELINE_STEPS.indexOf(target as (typeof PIPELINE_STEPS)[number]);
  if (to < 0) return [];
  const from = PIPELINE_STEPS.indexOf(current as (typeof PIPELINE_STEPS)[number]);
  const steps = PIPELINE_STEPS.slice(from === -1 ? 0 : from + 1, to + 1) as readonly string[];
  return steps.length > 1 ? [...steps] : [];
}

// The full picker, grouped (BDR redesign, Nov 11, 2026): forward moves
// normally happen on their own (a logged touch, a talk, a booking, a held
// meeting, paperwork going out or signed), so those carry a small "auto"
// tag; this is where a person corrects them.
const GROUPS: { title: string; statuses: ContactStatusValue[] }[] = [
  { title: "Working it", statuses: ["NOT_ACTIONED", "CONTACTED", "CONNECTED", "INTERESTED"] },
  { title: "Pipeline", statuses: ["MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON"] },
  { title: "Closed", statuses: ["NOT_INTERESTED", "LOST", "ARCHIVED"] },
];
const AUTO: ReadonlySet<string> = new Set(["CONTACTED", "CONNECTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON"]);
// Not Interested and Lost ask an optional one-tap reason (decision 14).
const ASKS_REASON: ReadonlySet<string> = new Set(["NOT_INTERESTED", "LOST"]);

// The picker's contents, without a button: the grouped list, then the
// day each skipped pipeline step happened, or the reason for Not
// Interested / Lost. Used by <StatusPicker> and by the contact page's
// ⋯ More → "Set status by hand".
export function StatusPanel({
  kind,
  id,
  status,
  meetingSetOn,
  today,
  onDone,
}: {
  kind: "contact" | "company";
  id: string;
  status: string;
  // yyyy-mm-dd, or null when no meeting has been set.
  meetingSetOn: string | null;
  today: string;
  // After a save (and on "nothing changed").
  onDone: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<ContactStatusValue | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<StatusReasonValue | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  function save(next: ContactStatusValue, withDates: Record<string, string>, why: StatusReasonValue | null = null) {
    setError(undefined);
    start(async () => {
      const result = await setRecordStatus({ kind, id, target: next, dates: withDates, reason: why });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTarget(null);
      onDone();
      router.refresh();
    });
  }

  function choose(next: ContactStatusValue) {
    if (ASKS_REASON.has(next)) {
      setTarget(next);
      setReason(null);
      return;
    }
    const steps = stepsFor(status, next);
    if (steps.length === 0) {
      save(next, {});
      return;
    }
    const preset = meetingSetOn ?? today;
    setTarget(next);
    setDates(Object.fromEntries(steps.map((step) => [step, step === "MEETING_SET" && meetingSetOn ? meetingSetOn : preset])));
  }

  const steps = target ? stepsFor(status, target) : [];

  if (target && ASKS_REASON.has(target)) {
    return (
      <div className="space-y-2.5 p-3" data-testid="status-reason">
        <p className="text-xs">
          <strong>{CONTACT_STATUS_LABELS[target]}</strong>. Why? Optional, one tap.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_REASONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={reason === option}
              onClick={() => setReason(reason === option ? null : option)}
              className={`btn btn-sm pointer-coarse:min-h-11 ${reason === option ? "btn-primary" : "btn-ghost"}`}
              data-testid={`status-reason-${option}`}
            >
              {STATUS_REASON_LABELS[option]}
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={() => setTarget(null)} className="btn btn-ghost btn-sm pointer-coarse:min-h-11">
            Back
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => save(target, {}, reason)}
            className="btn btn-primary btn-sm pointer-coarse:min-h-11"
            data-testid="status-save"
          >
            {pending ? "Saving…" : reason ? "Save" : "Save without a reason"}
          </button>
        </div>
      </div>
    );
  }

  if (target) {
    return (
      <div className="space-y-2.5 p-3" data-testid="status-dates">
        <p className="text-xs">
          Skipping ahead to <strong>{CONTACT_STATUS_LABELS[target]}</strong>. When did each step happen?
        </p>
        {steps.map((step) => (
          <label key={step} className="flex items-center justify-between gap-2 text-xs">
            <span>{CONTACT_STATUS_LABELS[step as ContactStatusValue]}</span>
            <input
              type="date"
              value={dates[step] ?? ""}
              max={today}
              required
              onChange={(event) => setDates({ ...dates, [step]: event.target.value })}
              className="input input-sm w-40"
              data-testid={`status-date-${step}`}
            />
          </label>
        ))}
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={() => setTarget(null)} className="btn btn-ghost btn-sm">
            Back
          </button>
          <button
            type="button"
            disabled={pending || steps.some((step) => !dates[step])}
            onClick={() => save(target, dates)}
            className="btn btn-primary btn-sm"
            data-testid="status-save"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div role="listbox" aria-label="Status" className="py-1">
      {GROUPS.map((group) => (
        <div key={group.title} role="group" aria-label={group.title}>
          <p className="eyebrow px-3 pb-0.5 pt-2">{group.title}</p>
          {group.statuses.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === status}
              disabled={pending}
              onClick={() => (option === status ? onDone() : choose(option))}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)] pointer-coarse:min-h-11 ${
                option === status ? "font-semibold" : ""
              }`}
              data-testid={`status-option-${option}`}
            >
              {CONTACT_STATUS_LABELS[option]}
              {AUTO.has(option) && <span className="faint text-[0.62rem]">auto</span>}
            </button>
          ))}
        </div>
      ))}
      {error && <p className="px-3 py-1.5 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}

// The status on a contact's or company's page, as a button. Picking a new
// one saves it; jumping ahead in the pipeline past a step never recorded
// asks for the day each one happened first, prefilled with the day the
// meeting was set so the usual case is one click.
export function StatusPicker({
  kind,
  id,
  status,
  meetingSetOn,
  today,
}: {
  kind: "contact" | "company";
  id: string;
  status: string;
  // yyyy-mm-dd, or null when no meeting has been set.
  meetingSetOn: string | null;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  // Re-mounted on each open so a half-finished pick starts over.
  const [round, setRound] = useState(0);
  const button = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => {
          if (!open) setRound(round + 1);
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-label={`Status: ${CONTACT_STATUS_LABELS[status as ContactStatusValue] ?? status}. Change it`}
        className="inline-flex items-center gap-1 rounded-full"
        data-testid="status-picker"
      >
        <StatusBadge status={status} />
        <IconChevronDown size={11} className="opacity-60" />
      </button>

      {/* Floats over the page (Oct 27, 2026): drawn inside the page it was
          cut off by a narrow column or the sidebar. */}
      <FloatingMenu anchor={button} open={open} onClose={() => setOpen(false)} testId="status-menu" label="Status">
        <StatusPanel key={round} kind={kind} id={id} status={status} meetingSetOn={meetingSetOn} today={today} onDone={() => setOpen(false)} />
      </FloatingMenu>
    </div>
  );
}
