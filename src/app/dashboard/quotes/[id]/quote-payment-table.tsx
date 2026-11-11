"use client";

import { useCallback, useRef, useState } from "react";
import { useQuoteSaveSection } from "./quote-save";
import { PaymentTable, type PaymentTableRowInput } from "@/components/payment-table";
import { saveQuotePaymentSchedule } from "../actions";

// The quote's payment table: the same table a contract uses, without the
// money half. A quote is a promise — nothing can be recorded as paid
// against one, so the Paid column and the payment actions are simply not
// here.
export function QuotePaymentTable({
  quoteId,
  totalCents,
  paymentTerms,
  hidePaymentTable,
  initialRows,
  today,
  unsaved = false,
}: {
  quoteId: string;
  totalCents: number;
  paymentTerms: string;
  hidePaymentTable: boolean;
  initialRows: PaymentTableRowInput[];
  today: string;
  // True while the rows on screen are the suggested starting table and
  // nothing has been stored yet.
  unsaved?: boolean;
}) {
  const [hidden, setHidden] = useState(hidePaymentTable);
  const [savedHidden, setSavedHidden] = useState(hidePaymentTable);
  const [everSaved, setEverSaved] = useState(!unsaved);

  // Part of the quote's one Save (quote-save.tsx), after the lines.
  const [status, setStatus] = useState({ dirty: false, pending: false });
  const saveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const register = useCallback((next: { dirty: boolean; pending: boolean; save: () => Promise<boolean> }) => {
    saveRef.current = next.save;
    setStatus((was) => (was.dirty === next.dirty && was.pending === next.pending ? was : { dirty: next.dirty, pending: next.pending }));
  }, []);
  const joined = useQuoteSaveSection("payments", {
    label: "Payment table",
    order: 1,
    dirty: status.dirty,
    pending: status.pending,
    save: () => saveRef.current(),
  });

  return (
    <PaymentTable
      totalCents={totalCents}
      paymentTerms={paymentTerms}
      initialRows={initialRows}
      today={today}
      saveLabel="Save payment table"
      // A suggested table nobody has saved counts as unsaved, so the one
      // Save stores it as it stands (its own button used to).
      join={joined ? { register, extraDirty: hidden !== savedHidden || !everSaved } : undefined}
      onSave={async (payload) => {
        const sentHidden = hidden;
        const result = await saveQuotePaymentSchedule({ quoteId, hidePaymentTable: sentHidden, ...payload });
        if (!result.error) {
          setEverSaved(true);
          setSavedHidden(sentHidden);
        }
        return result;
      }}
      above={
        <>
          {/* These rows are a suggestion until someone saves them. Without
              saying so, a quote sent straight from this screen reaches the
              customer with no payment terms at all, while the sender was
              looking at a complete table. */}
          {!everSaved && (
            <p className="text-xs text-[var(--warn)]" data-testid="payment-table-unsaved">
              Not saved yet — this is a suggested table. The customer sees nothing until you save it.
            </p>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={hidden}
              onChange={(event) => setHidden(event.target.checked)}
              data-testid="hide-payment-table"
            />
            <span className="muted">
              Hide from quote — keep this table off the customer&apos;s copy and the PDF
            </span>
          </label>
        </>
      }
    />
  );
}
