import { formatDate, formatDateTime, formatDay, formatCents } from "@/lib/format";
import { TAG_LABELS, type LineItemTagValue } from "@/lib/constants";
import { contractSubtotalCents, contractTotalCents } from "@/lib/contracts";
import { lineNetCents } from "@/lib/quote-math";

export type ContractDocumentData = {
  number: number;
  title: string;
  type: string;
  body: string;
  status: string;
  createdAt: Date;
  signedAt: Date | null;
  signerName: string | null;
  organization: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    timeZone: string;
  };
  contact: { name: string; company: { name: string; logoUrl: string | null } | null; email: string | null };
  // Set by the deal tracker: the business the document is addressed to
  // when it isn't the contact's own company.
  company?: { name: string; logoUrl: string | null } | null;
  lineItems?: {
    id: string;
    name: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    tag: string;
    discountCents?: number;
    discountPercent?: number | null;
    // Release 3b, copied from the quote line: "Black · L" and a workspace
    // unit's name ("Box of 12").
    variationText?: string | null;
    unitLabel?: string | null;
  }[];
  // Money off the whole contract, after the rows' own discounts.
  discountCents?: number;
  discountPercent?: number | null;
  payments?: { id: string; label: string; amountCents: number; dueOn: Date | null; terms?: string | null; paidAt: Date | null }[];
  paymentTerms?: string | null;
  senderSignerName?: string | null;
  // The apparel pack (Nov 12, 2026): the proofs this contract carries, read
  // live, and where the printer's files download from (a money-out
  // contract that is out or signed only).
  proofs?: {
    versionId: string;
    token: string;
    number: number;
    version: number;
    productName: string;
    colorLabel: string | null;
    covers: string;
    status: string;
    approvedByName: string | null;
    approvedAt: string | null;
    panels: { position: number; locationLabel: string; artworkName: string; inkNote: string | null; shownOn: string | null; hasPrintFile: boolean }[];
  }[];
  proofDownloadBase?: string | null;
};

// Contract bodies are plain text by design — rendering them as HTML would
// mean trusting template authors with markup inside a legal document, so
// the text is escaped by React and whitespace is preserved instead.
export function ContractDocument({ contract }: { contract: ContractDocumentData }) {
  const recipient = contract.company ?? contract.contact.company ?? null;
  const recipientName = recipient?.name || contract.contact.name;
  const lineItems = contract.lineItems ?? [];
  const payments = contract.payments ?? [];
  const contractDiscount = contract.discountCents ?? 0;
  const subtotalCents = contractSubtotalCents(lineItems);
  const totalCents = contractTotalCents(lineItems, contractDiscount);
  const anyLineDiscount = lineItems.some((item) => (item.discountCents ?? 0) > 0);
  const anyDiscount = anyLineDiscount || contractDiscount > 0;
  const zone = contract.organization.timeZone;
  const lastDue = payments.map((p) => p.dueOn).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime()).at(-1) ?? null;
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-[#111827] shadow-2xl sm:p-12 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#e5e7eb] pb-6">
        <div className="flex items-center gap-3">
          {contract.organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contract.organization.logoUrl}
              alt=""
              className="h-11 w-11 rounded object-cover"
            />
          ) : (
            <div
              className="flex h-11 w-11 items-center justify-center rounded text-sm font-bold text-white"
              style={{ background: contract.organization.primaryColor }}
            >
              {contract.organization.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-lg font-semibold">{contract.organization.name}</p>
            <p className="text-xs text-[#6b7280]">
              {contract.type || "Agreement"}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 text-right text-xs text-[#6b7280]">
          <div>
            <p className="font-mono text-sm font-semibold text-[#111827]">
              CON-{contract.number}
            </p>
            <p className="mt-1">Issued {formatDate(contract.createdAt, zone)}</p>
            {contract.paymentTerms && <p>Terms: {contract.paymentTerms}</p>}
          </div>
          {recipient?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={recipient.logoUrl} alt="" className="h-11 w-11 rounded object-cover" />
          )}
        </div>
      </header>

      <h1 className="mt-6 text-xl font-semibold">{contract.title}</h1>
      <p className="mt-1 text-sm text-[#6b7280]">
        Between {contract.organization.name} and {recipientName}
        {recipient && contract.contact.name !== recipientName ? ` (attn. ${contract.contact.name})` : ""}
      </p>

      <div className="mt-6 whitespace-pre-wrap text-[0.86rem] leading-relaxed text-[#1f2937]">
        {contract.body}
      </div>

      {lineItems.length > 0 && (
        <section className="mt-8" data-testid="document-items">
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#9ca3af]">Items</h2>
          <table className="mt-2 w-full text-[0.82rem]">
            <thead>
              <tr className="border-b border-[#e5e7eb] text-left text-[0.65rem] uppercase tracking-wider text-[#6b7280]">
                <th className="py-1.5 pr-2 font-semibold">Item</th>
                <th className="py-1.5 pr-2 font-semibold">Category</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Unit</th>
                {anyLineDiscount && <th className="py-1.5 pr-2 text-right font-semibold">Discount</th>}
                <th className="py-1.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.id} className="border-b border-[#f3f4f6] align-top">
                  <td className="py-1.5 pr-2">
                    <p className="font-medium">{item.name}</p>
                    {item.variationText && (
                      <p className="text-xs font-medium text-[#374151]" data-testid="document-line-labels">
                        {item.variationText}
                      </p>
                    )}
                    {item.description && <p className="text-xs text-[#6b7280]">{item.description}</p>}
                  </td>
                  <td className="py-1.5 pr-2 text-[#6b7280]">{TAG_LABELS[item.tag as LineItemTagValue] ?? item.tag}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.quantity}
                    {item.unitLabel && (
                      <span className="block text-[0.7rem] text-[#6b7280]" data-testid="document-line-unit">
                        {item.unitLabel}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatCents(item.unitPriceCents)}</td>
                  {anyLineDiscount && (
                    <td className="py-1.5 pr-2 text-right tabular-nums text-[#047857]">
                      {(item.discountCents ?? 0) > 0 ? `−${formatCents(item.discountCents ?? 0)}` : ""}
                      {(item.discountCents ?? 0) > 0 && item.discountPercent != null && (
                        <span className="block text-xs text-[#6b7280]">{item.discountPercent}% off</span>
                      )}
                    </td>
                  )}
                  <td className="py-1.5 text-right tabular-nums">{formatCents(lineNetCents(item))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {anyDiscount && (
                <tr>
                  <td colSpan={anyLineDiscount ? 5 : 4} className="pt-2 text-right text-[#6b7280]">Subtotal</td>
                  <td className="pt-2 text-right tabular-nums" data-testid="document-subtotal">{formatCents(subtotalCents)}</td>
                </tr>
              )}
              {contractDiscount > 0 && (
                <tr>
                  <td colSpan={anyLineDiscount ? 5 : 4} className="pt-1 text-right text-[#6b7280]">
                    Discount{contract.discountPercent != null ? ` (${contract.discountPercent}%)` : ""}
                  </td>
                  <td className="pt-1 text-right tabular-nums text-[#047857]" data-testid="document-discount">−{formatCents(contractDiscount)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={anyLineDiscount ? 5 : 4} className="pt-2 text-right font-semibold">Total</td>
                <td className="pt-2 text-right text-base font-semibold tabular-nums" data-testid="document-total">{formatCents(totalCents)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {(contract.proofs?.length ?? 0) > 0 && (
        <section className="mt-8" data-testid="document-proofs">
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#9ca3af]">Proofs</h2>
          <div className="mt-2 space-y-4">
            {contract.proofs!.map((proof) => (
              <div key={proof.versionId} className="break-inside-avoid rounded-lg border border-[#e5e7eb] p-3" data-testid="document-proof" data-proof={proof.number}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[0.86rem] font-semibold">
                    Proof {proof.number}
                    {proof.version > 1 ? ` (v${proof.version})` : ""} · {proof.productName}
                    {proof.colorLabel ? ` · ${proof.colorLabel}` : ""}
                  </p>
                  <p
                    className={`text-[0.75rem] font-semibold ${proof.status === "APPROVED" ? "text-[#15803d]" : "text-[#b91c1c]"}`}
                    data-testid="document-proof-status"
                  >
                    {proof.status === "APPROVED"
                      ? `Approved by ${proof.approvedByName ?? "the customer"}${proof.approvedAt ? ` · ${formatDay(new Date(proof.approvedAt))}` : ""}`
                      : proof.status === "SUPERSEDED"
                        ? proof.approvedAt
                          ? `Approved by ${proof.approvedByName ?? "the customer"}, since replaced by a newer version: check before printing`
                          : "Replaced by a newer version: don't print from this"
                        : "Not approved yet: don't print from this"}
                  </p>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/files/${proof.token}`} alt="" className="mt-2 h-auto max-h-80 w-auto max-w-full rounded border border-[#f3f4f6] bg-white" />
                {proof.covers && <p className="mt-2 text-[0.75rem] text-[#6b7280]">For {proof.covers}</p>}
                <ul className="mt-1 space-y-0.5 text-[0.78rem]">
                  {proof.panels.map((panel) => (
                    <li key={panel.position}>
                      <span className="font-medium">{panel.locationLabel}:</span> {panel.artworkName}
                      {panel.inkNote ? ` · ${panel.inkNote}` : ""}
                      {panel.shownOn ? ` · shown on ${panel.shownOn}` : ""}
                      {contract.proofDownloadBase && panel.hasPrintFile && proof.approvedAt && (
                        <>
                          {" · "}
                          <a href={`${contract.proofDownloadBase}/${proof.versionId}?p=${panel.position}`} className="underline" data-testid="document-print-file">
                            Download the print file
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {payments.length > 0 && (
        <section className="mt-8" data-testid="document-payments">
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#9ca3af]">Payment schedule</h2>
          <table className="mt-2 w-full text-[0.82rem]">
            <thead>
              <tr className="border-b border-[#e5e7eb] text-left text-[0.65rem] uppercase tracking-wider text-[#6b7280]">
                <th className="py-1.5 pr-2 font-semibold">Payment</th>
                <th className="py-1.5 pr-2 font-semibold">Due</th>
                <th className="py-1.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-[#f3f4f6]">
                  <td className="py-1.5 pr-2">
                    {payment.label}
                    {payment.paidAt && <span className="ml-2 text-xs text-[#047857]">Paid {formatDate(payment.paidAt, zone)}</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-[#6b7280]">{payment.dueOn ? formatDay(payment.dueOn) : payment.terms || "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCents(payment.amountCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-2 font-semibold">Total</td>
                <td className="pt-2 text-[#6b7280]">{lastDue ? `Final payment ${formatDate(lastDue, "UTC")}` : ""}</td>
                <td className="pt-2 text-right font-semibold tabular-nums">
                  {formatCents(payments.reduce((sum, payment) => sum + payment.amountCents, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      <div className="mt-10 border-t border-[#e5e7eb] pt-6">
        {contract.status === "SIGNED" && contract.signedAt ? (
          <div className="rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] p-4">
            <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#047857]">
              Signed
            </p>
            <p
              className="mt-1 text-2xl text-[#065f46]"
              style={{ fontFamily: "cursive" }}
            >
              {contract.signerName}
            </p>
            <p className="mt-1 text-xs text-[#047857]">
              Accepted electronically on{" "}
              {formatDateTime(contract.signedAt, contract.organization.timeZone)}
              {contract.contact.email ? ` · ${contract.contact.email}` : ""}
            </p>
          </div>
        ) : (
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <div className="h-10 border-b border-[#9ca3af]" />
              <p className="mt-1 text-xs text-[#6b7280]">
                {recipientName}
                {contract.contact.name !== recipientName ? ` · ${contract.contact.name}` : ""}
              </p>
            </div>
            <div>
              <div className="h-10 border-b border-[#9ca3af]" />
              <p className="mt-1 text-xs text-[#6b7280]">
                {contract.organization.name}
                {contract.senderSignerName ? ` · ${contract.senderSignerName}` : ""}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
