"use client";

import { useEffect, useMemo, useState } from "react";
import { IconPlus, IconCheck, IconSearch } from "@/components/icons";
import { DEAL_STAGE_LABELS, type DealStageValue } from "@/lib/constants";

export type PickableDeal = {
  id: string;
  title: string;
  contactId: string;
  stage: string;
};

// The Deal box on a new quote or contract. Searches the customer's
// existing deals as you type; "+ New deal" turns what you typed into a
// new one. Sends `dealId` when an existing deal was picked, otherwise
// `dealTitle` for the server to create (or match by name).
export function DealPicker({
  deals,
  contactId,
  required = true,
  defaultDealId,
  onPick,
}: {
  deals: PickableDeal[];
  contactId: string;
  required?: boolean;
  defaultDealId?: string;
  // Fires with the existing deal's id when one is picked, or "" when the
  // box is empty or names a deal that doesn't exist yet.
  onPick?: (dealId: string) => void;
}) {
  const own = useMemo(
    () => deals.filter((deal) => deal.contactId === contactId),
    [deals, contactId],
  );
  const preset = own.find((deal) => deal.id === defaultDealId);

  const [value, setValue] = useState(preset?.title ?? "");
  const [pickedId, setPickedId] = useState<string | null>(preset?.id ?? null);
  const [isNew, setIsNew] = useState(false);
  const [open, setOpen] = useState(false);

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = query
      ? own.filter((deal) => deal.title.toLowerCase().includes(query))
      : own;
    // Open deals first: those are the ones a new quote usually belongs to.
    return [...list]
      .sort((a, b) => Number(isClosed(a.stage)) - Number(isClosed(b.stage)))
      .slice(0, 8);
  }, [own, query]);

  const picked = pickedId ? own.find((deal) => deal.id === pickedId) : undefined;
  const pickedStillMatches = picked && picked.title === value;
  const canAddNew = query.length > 0 && !pickedStillMatches;

  const pickedExistingId = pickedStillMatches ? picked.id : "";
  useEffect(() => {
    onPick?.(pickedExistingId);
  }, [pickedExistingId, onPick]);

  return (
    <div className="relative">
      <label className="label" htmlFor="dealTitle">
        Deal
        {!required && <span className="faint font-normal"> · optional</span>}
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            id="dealTitle"
            name="dealTitle"
            value={value}
            required={required}
            autoComplete="off"
            disabled={!contactId}
            placeholder={
              contactId
                ? own.length
                  ? "Search this customer's deals or type a new one…"
                  : "Name the job, e.g. Kitchen remodel"
                : "Pick a customer first"
            }
            onChange={(event) => {
              setValue(event.target.value);
              setPickedId(null);
              setIsNew(false);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            className="input pl-8"
          />
          <input type="hidden" name="dealId" value={pickedStillMatches ? picked.id : ""} />
        </div>
        {pickedStillMatches ? (
          <span className="btn btn-ghost btn-sm shrink-0 cursor-default text-[var(--ok)]">
            <IconCheck size={12} />
            {DEAL_STAGE_LABELS[picked.stage as DealStageValue] ?? "Existing"}
          </span>
        ) : (
          <button
            type="button"
            disabled={!canAddNew}
            aria-pressed={isNew}
            onClick={() => {
              setIsNew(true);
              setOpen(false);
            }}
            className={`btn btn-sm shrink-0 ${isNew ? "btn-primary" : "btn-ghost"}`}
            title="Create a new deal with this name"
          >
            <IconPlus size={12} />
            {isNew ? "New deal" : "Add new deal"}
          </button>
        )}
      </div>
      {isNew && !pickedStillMatches && (
        <p className="faint mt-1 text-xs">
          “{value.trim()}” will be created as a new deal for this customer.
        </p>
      )}
      {open && contactId && matches.length > 0 && (
        <ul
          role="listbox"
          className="card absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto py-1 shadow-xl"
        >
          {matches.map((deal) => (
            <li key={deal.id}>
              <button
                type="button"
                role="option"
                aria-selected={deal.id === pickedId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setValue(deal.title);
                  setPickedId(deal.id);
                  setIsNew(false);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[rgb(255_255_255/0.05)]"
              >
                <span className={isClosed(deal.stage) ? "faint" : ""}>{deal.title}</span>
                <span className="faint text-[0.68rem]">
                  {DEAL_STAGE_LABELS[deal.stage as DealStageValue] ?? deal.stage}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function isClosed(stage: string) {
  return stage === "WON" || stage === "LOST";
}
