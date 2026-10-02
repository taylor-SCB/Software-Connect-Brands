"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui";
import { IconChevronDown } from "@/components/icons";
import { CONTACT_STATUSES, CONTACT_STATUS_LABELS, PIPELINE_STEPS, type ContactStatusValue } from "@/lib/constants";
import { setRecordStatus } from "@/app/dashboard/status-actions";

// Which pipeline steps a move passes through without a date on record:
// the same rule the server applies, so the form asks for exactly those.
function stepsFor(current: string, target: string): string[] {
  const to = PIPELINE_STEPS.indexOf(target as (typeof PIPELINE_STEPS)[number]);
  if (to < 0) return [];
  const from = PIPELINE_STEPS.indexOf(current as (typeof PIPELINE_STEPS)[number]);
  const steps = PIPELINE_STEPS.slice(from === -1 ? 0 : from + 1, to + 1) as readonly string[];
  return steps.length > 1 ? [...steps] : [];
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ContactStatusValue | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function save(next: ContactStatusValue, withDates: Record<string, string>) {
    setError(undefined);
    start(async () => {
      const result = await setRecordStatus({ kind, id, target: next, dates: withDates });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setTarget(null);
      router.refresh();
    });
  }

  function choose(next: ContactStatusValue) {
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

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`Status: ${CONTACT_STATUS_LABELS[status as ContactStatusValue] ?? status}. Change it`}
        className="inline-flex items-center gap-1 rounded-full"
        data-testid="status-picker"
      >
        <StatusBadge status={status} />
        <IconChevronDown size={11} className="opacity-60" />
      </button>

      {open && (
        <div className="card popover absolute right-0 top-full z-40 mt-1 w-72" data-testid="status-menu">
          {target ? (
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
          ) : (
            <ul role="listbox" aria-label="Status" className="py-1">
              {CONTACT_STATUSES.map((option) => (
                <li key={option}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option === status}
                    disabled={pending}
                    onClick={() => (option === status ? setOpen(false) : choose(option))}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-[rgb(255_255_255/0.04)] ${
                      option === status ? "font-semibold" : ""
                    }`}
                    data-testid={`status-option-${option}`}
                  >
                    {CONTACT_STATUS_LABELS[option]}
                    {(PIPELINE_STEPS as readonly string[]).includes(option) && <span className="faint text-[0.62rem]">pipeline</span>}
                  </button>
                </li>
              ))}
              {error && <li className="px-3 py-1.5 text-xs text-[var(--danger)]">{error}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
