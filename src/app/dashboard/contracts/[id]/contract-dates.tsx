"use client";

import { useState, useTransition } from "react";
import { IconCalendar } from "@/components/icons";
import { addContractDates, readContractDates, type ContractDates } from "../ai-actions";

// B4, Dates in this contract (Release B, Nov 12, 2026): on a signed
// contract's page, the dated duties its wording sets, each with the words
// it came from, ticked onto the rep's calendar. Read on a tap and kept,
// so opening the page again costs nothing. Never on the customer's
// signing page.
export function ContractDatesCard({
  contractId,
  initial,
  aiOn,
}: {
  contractId: string;
  initial: ContractDates | null;
  aiOn: boolean;
}) {
  const [dates, setDates] = useState<ContractDates | null>(initial);
  const [ticked, setTicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  if (!dates && !aiOn) return null;

  return (
    <div className="space-y-3 p-5" data-testid="contract-dates">
      {!dates ? (
        <>
          <p className="muted text-sm">Find the deadlines this contract sets — deposit due, start by, warranty walk, insurance renewal — and put the ones you want on the calendar.</p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const read = await readContractDates(contractId);
                start(() => ("error" in read ? setError(read.error) : setDates(read)));
              })
            }
            className="btn btn-ghost btn-sm min-h-11 sm:min-h-0"
            data-testid="contract-dates-read"
          >
            <IconCalendar size={13} />
            {pending ? "Reading the contract…" : "Find the dates"}
          </button>
        </>
      ) : dates.duties.length === 0 && dates.undated.length === 0 ? (
        <p className="muted text-sm" data-testid="contract-dates-none">No dated duties found in this contract.</p>
      ) : (
        <>
          {dates.duties.length > 0 && (
            <ul className="space-y-2">
              {dates.duties.map((duty) => {
                const done = Boolean(duty.eventId);
                const off = Boolean(duty.already) || done;
                return (
                  <li key={duty.id} className="flex items-start gap-3" data-testid="contract-date" data-state={done ? "added" : duty.already ? "already" : "open"}>
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0"
                      aria-label={`${duty.title}, ${day(duty.date)}`}
                      disabled={off || pending}
                      checked={off ? done : ticked.includes(duty.id)}
                      onChange={(event) =>
                        setTicked((all) => (event.target.checked ? [...all, duty.id] : all.filter((id) => id !== duty.id)))
                      }
                      data-testid="contract-date-tick"
                    />
                    <div className="min-w-0 text-sm">
                      <p>
                        <span className="font-semibold text-[var(--text-strong)]">{duty.title}</span>{" "}
                        <span className="num">· {day(duty.date)}</span>
                        {done && <span className="ml-2 text-xs text-[var(--ok)]">On the calendar</span>}
                        {!done && duty.already && <span className="faint ml-2 text-xs">{duty.already}</span>}
                      </p>
                      <p className="faint text-xs">{duty.how}</p>
                      <p className="muted break-words text-xs">“{duty.snippet}”</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {dates.undated.length > 0 && (
            <div data-testid="contract-dates-undated">
              <p className="eyebrow">No date given</p>
              <ul className="mt-1 space-y-1">
                {dates.undated.map((row, index) => (
                  <li key={index} className="text-xs">
                    <span className="font-medium">{row.title}</span> <span className="muted">— “{row.snippet}”</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dates.duties.some((duty) => !duty.already && !duty.eventId) && (
            <button
              type="button"
              disabled={ticked.length === 0 || pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const saved = await addContractDates(contractId, ticked);
                  start(() => {
                    if ("error" in saved) {
                      setError(saved.error);
                      return;
                    }
                    setDates(saved.result);
                    setTicked([]);
                    setNotice(saved.added === 1 ? "1 date added to the calendar." : `${saved.added} dates added to the calendar.`);
                  });
                })
              }
              className="btn btn-primary btn-sm min-h-11 sm:min-h-0"
              data-testid="contract-dates-add"
            >
              <IconCalendar size={13} />
              Put {ticked.length === 1 ? "1 date" : `${ticked.length} dates`} on the calendar
            </button>
          )}
        </>
      )}
      {notice && <p role="status" className="text-sm text-[var(--ok)]" data-testid="contract-dates-notice">{notice}</p>}
      {error && <p role="alert" className="text-sm text-[var(--danger)]" data-testid="contract-dates-error">{error}</p>}
    </div>
  );
}
