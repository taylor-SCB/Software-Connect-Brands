"use client";

import { useState } from "react";
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
  const [everSaved, setEverSaved] = useState(!unsaved);

  return (
    <PaymentTable
      totalCents={totalCents}
      paymentTerms={paymentTerms}
      initialRows={initialRows}
      today={today}
      saveLabel="Save payment table"
      onSave={async (payload) => {
        const result = await saveQuotePaymentSchedule({ quoteId, hidePaymentTable: hidden, ...payload });
        if (!result.error) setEverSaved(true);
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
