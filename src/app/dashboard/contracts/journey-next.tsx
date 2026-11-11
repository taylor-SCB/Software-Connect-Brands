"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JourneyState } from "@/lib/health-journey";
import type { JourneyRefs } from "@/lib/deal-journey-load";
import { IconCheck, IconCopy, IconSend, IconSignature, IconFileText } from "@/components/icons";
import { setQuoteStatus } from "@/app/dashboard/quotes/actions";
import { sendInvoice } from "./payment-actions";

// The one Next button under the DealJourney strip (BDR redesign, Release
// 8), the same on the quote, the Contract Coordinator and the contract:
// Start a quote → Send quote → Customer said yes → Make contract → Send
// for signature → Copy signing link → Send deposit invoice. Each one does
// the step where the page can, and otherwise opens the page that does.
// A page passes `here` to put its own control in a slot (the quote page's
// Send quote sheet, the contract page's Send for signature).
export type JourneyPage = "quote" | "coordinator" | "contract";

// Full width on a phone, where the strip pins Next to the foot.
export const NEXT = "btn btn-primary btn-sm max-sm:w-full";

export function JourneyNext({
  next,
  refs,
  page,
  here,
}: {
  next: JourneyState["next"];
  refs: JourneyRefs;
  page: JourneyPage;
  here?: Partial<Record<NonNullable<JourneyState["next"]>["key"], React.ReactNode>>;
}) {
  if (!next) return null;
  const own = here?.[next.key];
  if (own) return <>{own}</>;
  const coordinator = `/dashboard/contracts/tracker?dealId=${refs.dealId}${refs.quote ? `&quoteId=${refs.quote.id}` : ""}`;

  switch (next.key) {
    case "start-quote":
      return (
        <Link href={`/dashboard/quotes/new?contactId=${refs.contactId}&dealId=${refs.dealId}`} className={NEXT} data-testid="journey-next">
          <IconFileText size={13} />
          {next.label}
        </Link>
      );
    case "send-quote":
      return refs.quote ? (
        <Link href={`/dashboard/quotes/${refs.quote.id}`} className={NEXT} data-testid="journey-next">
          <IconSend size={13} />
          {next.label}
        </Link>
      ) : null;
    case "quote-yes":
      return refs.quote ? (
        <form action={setQuoteStatus} className="max-sm:w-full">
          <input type="hidden" name="quoteId" value={refs.quote.id} />
          <input type="hidden" name="status" value="ACCEPTED" />
          <button type="submit" className={NEXT} data-testid="journey-next">
            <IconCheck size={13} />
            {next.label}
          </button>
        </form>
      ) : null;
    case "make-contract":
      return page === "coordinator" ? (
        <a href="#make-contracts" className={NEXT} data-testid="journey-next">
          <IconSignature size={13} />
          {next.label}
        </a>
      ) : (
        <Link href={coordinator} className={NEXT} data-testid="journey-next">
          <IconSignature size={13} />
          {next.label}
        </Link>
      );
    case "send-contract":
      return refs.draftContract ? (
        <Link href={`/dashboard/contracts/${refs.draftContract.id}`} className={NEXT} data-testid="journey-next">
          <IconSend size={13} />
          {next.label}
        </Link>
      ) : null;
    case "signing-link":
      return refs.sentContract ? <CopySigningLink path={`/c/${refs.sentContract.publicToken}`} label={next.label} /> : null;
    case "deposit":
      return refs.depositRow ? (
        <DepositInvoiceButton rowId={refs.depositRow.id} token={refs.depositRow.invoiceToken} label={next.label} />
      ) : refs.signedContract ? (
        <Link href={`/dashboard/contracts/${refs.signedContract.id}`} className={NEXT} data-testid="journey-next">
          {next.label}
        </Link>
      ) : null;
  }
}

function CopySigningLink({ path, label }: { path: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={NEXT}
      data-testid="journey-next"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${path}`);
        } catch {
          return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

// "Send deposit invoice": stamps the signed contract's first payment row
// as an invoice (INV-n and the customer's /i/ link, the same sendInvoice
// the payment table's "Send as invoice" uses), then offers the link to
// copy. Nothing is emailed from the app, as everywhere else.
export function DepositInvoiceButton({ rowId, token, label }: { rowId: string; token: string | null; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(token ? `/i/${token}` : null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy(path: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // The link is on screen to copy by hand.
    }
  }

  if (link) {
    return (
      <div className="flex flex-col items-end gap-1 max-sm:items-stretch" data-testid="deposit-invoice">
        <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-center">
          <button type="button" className={NEXT} data-testid="journey-next" onClick={() => copy(link)}>
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
            {copied ? "Copied" : "Copy invoice link"}
          </button>
          <a href={link} target="_blank" rel="noopener noreferrer" className="link text-xs" data-testid="deposit-invoice-link">
            Open invoice
          </a>
        </div>
        {message && <p className="text-xs text-[var(--ok)]" role="status">{message}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 max-sm:items-stretch">
      <button
        type="button"
        className={NEXT}
        disabled={pending}
        data-testid="journey-next"
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await sendInvoice(rowId);
            if (result.error || !result.token) {
              setError(result.error ?? "Couldn't make the invoice");
              return;
            }
            const path = `/i/${result.token}`;
            setLink(path);
            setMessage(`${result.success ?? "Invoice ready"} — copy the link and text or email it.`);
            void copy(path);
            router.refresh();
          })
        }
      >
        <IconSend size={13} />
        {pending ? "Making the invoice…" : label}
      </button>
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
