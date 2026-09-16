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
}: {
  quoteId: string;
  totalCents: number;
  paymentTerms: string;
  hidePaymentTable: boolean;
  initialRows: PaymentTableRowInput[];
  today: string;
}) {
  const [hidden, setHidden] = useState(hidePaymentTable);

  return (
    <PaymentTable
      totalCents={totalCents}
      paymentTerms={paymentTerms}
      initialRows={initialRows}
      today={today}
      saveLabel="Save payment table"
      onSave={async (payload) =>
        saveQuotePaymentSchedule({ quoteId, hidePaymentTable: hidden, ...payload })
      }
      above={
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
      }
    />
  );
}
