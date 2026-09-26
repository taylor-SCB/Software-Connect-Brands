"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { FormError } from "@/components/ui";
import Link from "next/link";
import { IconHardHat, IconSignature } from "@/components/icons";
import { formatCents } from "@/lib/format";
import { lineNetCents } from "@/lib/quote-math";
import { PAYMENT_TERM_OPTIONS, computeSchedule, type ScheduleRowInput } from "@/lib/payments";
import {
  CUSTOM_FILL,
  ScheduleRowsEditor,
  initialFillState,
  quickFillRows,
  rowsToInputs,
  type QuickFillState,
  type ScheduleRow,
} from "@/components/schedule-rows-editor";
import { DiscountInput, discountFromInput, discountPayload, type DiscountState } from "@/components/discount-input";
import type { PaymentDefaults } from "@/lib/tracker";
import { awardWithoutPaperwork } from "./actions";

export type AwardQuote = {
  id: string;
  number: number;
  paymentTerms: string | null;
  payments: { label: string; kind: "PERCENT" | "FIXED" | "BALANCE"; percent: number | null; amountCents: number; dueOn: string; terms: string | null }[];
  lineItems: {
    id: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    tag: string;
    cancelled: boolean;
  }[];
};

// For a job won on a handshake. Writes the Sales Order the quote already
// implies, records who agreed to it and when, and starts the job — so
// there is always one signed agreement behind a budget. The whole Job
// card when the deal isn't a job yet: a plain line saying so, the button,
// and the full form when it is open — which rows were agreed, a discount
// on the whole, and the payment rows written out.
export function AwardWithoutPaperwork({
  dealId,
  quote,
  today,
  defaults,
  sentContract = null,
}: {
  dealId: string;
  // The quote the coordinator is showing. Null when the deal has none.
  quote: AwardQuote | null;
  // A Money-in contract already out for signature. The server refuses a
  // handshake award while one is out, so the card says what to do
  // instead rather than offering a form that will be refused.
  sentContract?: { id: string; number: number; title: string } | null;
  // Today in the workspace's own clock, from the server. Reading the
  // browser's UTC clock prefilled tomorrow's date from 7pm Central
  // onward, and accepting it — the natural thing, since it looks like a
  // sensible default — dated the agreement and every payment on it a
  // day late.
  today: string;
  defaults: PaymentDefaults;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [signedOn, setSignedOn] = useState(today);
  const [note, setNote] = useState("");
  const openRows = useMemo(() => (quote?.lineItems ?? []).filter((row) => !row.cancelled), [quote]);
  // Every open row is in unless someone unticks it. Kept as the rows left
  // OUT rather than the rows in, so a row cancelled or restored in the
  // grid above comes and goes here on its own instead of going stale.
  const [excluded, setExcluded] = useState<string[]>([]);
  const selected = openRows.filter((row) => !excluded.includes(row.id)).map((row) => row.id);
  const [discount, setDiscount] = useState<DiscountState>({ input: "", mode: "percent" });
  const [terms, setTerms] = useState(quote?.paymentTerms || defaults.terms);

  const quoteRows: ScheduleRowInput[] | null =
    quote && quote.payments.length > 0
      ? quote.payments.map((row) => ({
          label: row.label,
          kind: row.kind,
          percent: row.percent,
          fixedCents: row.kind === "FIXED" ? row.amountCents : null,
          dueOn: row.dueOn,
          terms: row.terms,
        }))
      : null;
  const quoteTotalCents = (quote?.lineItems ?? []).reduce((sum, row) => sum + lineNetCents(row), 0);

  const [fill, setFill] = useState<QuickFillState>(() =>
    initialFillState({
      today,
      hasQuoteRows: Boolean(quoteRows),
      preset: defaults.preset,
      depositPercent: defaults.depositPercent,
      installmentCount: defaults.installmentCount,
    }),
  );
  const [schedule, setSchedule] = useState<ScheduleRow[]>(() =>
    quickFillRows(fill, { quoteRows, quoteTotalCents, totalCents: 0 }),
  );

  // A table still on "From the quote" follows the quote: a price edited
  // inline in the grid above moves the quote's total, and with it the
  // share a fixed deposit on the quote's table is worth. Adjusted during
  // render, the same way the coordinator's cards do it.
  const quoteShape = JSON.stringify({ quoteRows, quoteTotalCents });
  const [seenQuoteShape, setSeenQuoteShape] = useState(quoteShape);
  if (seenQuoteShape !== quoteShape) {
    setSeenQuoteShape(quoteShape);
    if (fill.fill === "__quote__") {
      setSchedule(quickFillRows(fill, { quoteRows, quoteTotalCents, totalCents: 0 }));
    }
  }

  const subtotalCents = openRows
    .filter((row) => selected.includes(row.id))
    .reduce((sum, row) => sum + lineNetCents(row), 0);
  const resolvedDiscount = discountFromInput(discount, subtotalCents);
  const totalCents = subtotalCents - resolvedDiscount.discountCents;

  function toggle(lineId: string) {
    setExcluded((all) => (all.includes(lineId) ? all.filter((id) => id !== lineId) : [...all, lineId]));
  }

  // The payment dates start from the day they agreed, as the old form's
  // preset did; a quick fill is re-dated when that day changes, a
  // hand-written table is left alone.
  function changeSignedOn(value: string) {
    setSignedOn(value);
    if (fill.fill === CUSTOM_FILL || !value) return;
    const next = { ...fill, start: value };
    setFill(next);
    setSchedule(quickFillRows(next, { quoteRows, quoteTotalCents, totalCents: 0 }));
  }

  function submit() {
    start(async () => {
      setError(undefined);
      // The same refusal the server gives, without the round trip.
      if (computeSchedule(rowsToInputs(schedule), totalCents).rows.some((row) => row.amountCents < 0)) {
        setError("The fixed payments add up to more than the job total. Fix the schedule.");
        return;
      }
      const result = await awardWithoutPaperwork(dealId, {
        signerName: name,
        signedOn,
        note,
        quoteId: quote?.id,
        lineItemIds: selected,
        discount: discountPayload(discount),
        paymentTerms: terms,
        schedule: rowsToInputs(schedule).map((row) => ({ ...row, terms: row.terms ?? null })),
        scheduleFromQuote: fill.fill === "__quote__",
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (result?.projectId) router.push(`/dashboard/projects/${result.projectId}`);
      else router.refresh();
    });
  }

  return (
    <div data-testid="job-card">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "color-mix(in srgb, var(--brand) 14%, transparent)", color: "var(--brand)" }}
          >
            <IconHardHat size={20} />
          </div>
          <div>
            <p className="eyebrow">Job</p>
            <p className="text-base font-semibold">Not a job yet</p>
            <p className="faint text-xs">
              {sentContract
                ? `CON-${sentContract.number} is out for the customer's signature. The job starts the moment they sign it — or, if they said yes another way, use Mark signed on that contract.`
                : "It becomes one the moment the customer signs a Money-in contract below. Won it on a handshake? Award it here and the job starts now."}
            </p>
          </div>
        </div>
        {sentContract && (
          <Link href={`/dashboard/contracts/${sentContract.id}`} className="btn btn-ghost btn-sm" data-testid="job-sent-contract">
            <IconSignature size={13} />
            Open CON-{sentContract.number}
          </Link>
        )}
        {!sentContract && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={openRows.length === 0}
            title={openRows.length === 0 ? "Write the quote first" : undefined}
            className="btn btn-primary btn-sm"
            data-testid="award-without-paperwork"
          >
            <IconHardHat size={13} />
            Award without paperwork
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-4 border-t border-[var(--border)] p-5" data-testid="award-form">
          <p className="muted text-sm">
            Records the quote as an agreement the customer said yes to — a signed Sales Order, marked signed
            offline — so the job can be tracked. The rows and the discount are what the job is awarded at, so
            check them here; the payment table can still be edited on the contract afterwards, and anything
            else changes with a change order.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs">
              <span className="label">Who agreed to it</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="input"
                placeholder="Their name"
                aria-label="Who agreed to it"
                data-testid="award-signer"
              />
            </label>
            <label className="block text-xs">
              <span className="label">When</span>
              <input
                type="date"
                value={signedOn}
                onChange={(event) => changeSignedOn(event.target.value)}
                className="input"
                aria-label="When they agreed"
                data-testid="award-date"
              />
            </label>
            <label className="block text-xs">
              <span className="label">Note <span className="faint font-normal">· optional</span></span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. agreed on site"
                className="input"
                aria-label="Note"
                data-testid="award-note"
              />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="space-y-3">
              <div>
                <p className="label">What they agreed to</p>
                <ul className="divide-y divide-[rgb(255_255_255/0.045)] rounded-lg border border-[var(--border)]" data-testid="award-rows">
                  {openRows.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <label className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selected.includes(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={`Include ${row.name}`}
                        />
                        <span className="truncate">{row.name}</span>
                      </label>
                      <span className="num shrink-0">{formatCents(lineNetCents(row))}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="muted text-xs">Subtotal</span>
                  <span className="num" data-testid="award-subtotal">{formatCents(subtotalCents)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <label className="muted text-xs" htmlFor="award-discount">Discount on the whole job</label>
                  <DiscountInput
                    id="award-discount"
                    label="Discount on the whole job"
                    state={discount}
                    onChange={setDiscount}
                    baseCents={subtotalCents}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between border-t border-[var(--border)] pt-1.5">
                  <span className="font-semibold">Awarded</span>
                  <span className="num text-lg font-semibold" data-testid="award-total">{formatCents(totalCents)}</span>
                </div>
              </div>
              <label className="block text-xs">
                <span className="label">Payment terms</span>
                <select
                  id="award-terms"
                  className="select"
                  value={terms}
                  onChange={(event) => setTerms(event.target.value)}
                  aria-label="Payment terms"
                >
                  {!PAYMENT_TERM_OPTIONS.includes(terms as (typeof PAYMENT_TERM_OPTIONS)[number]) && (
                    <option value={terms}>{terms}</option>
                  )}
                  {PAYMENT_TERM_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <p className="label">Payment schedule</p>
              <ScheduleRowsEditor
                idPrefix="award"
                rows={schedule}
                onChange={(rows) => setSchedule(rows)}
                fillState={fill}
                onFillChange={setFill}
                totalCents={totalCents}
                quoteRows={quoteRows}
                quoteTotalCents={quoteTotalCents}
                testId="award-schedule"
              />
            </div>
          </div>

          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || selected.length === 0}
              onClick={submit}
              className="btn btn-primary"
              data-testid="award-save"
            >
              <IconHardHat size={14} />
              {pending ? "Awarding…" : `Award the job · ${formatCents(totalCents)}`}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
