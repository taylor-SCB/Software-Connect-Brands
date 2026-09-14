import { formatCents, formatDate, formatDay } from "@/lib/format";

export type InvoiceDocumentData = {
  invoiceNumber: number;
  label: string;
  amountCents: number;
  receivedCents: number;
  dueOn: Date | null;
  issuedAt: Date | null;
  paidAt: Date | null;
  payments: { amountCents: number; paidOn: Date; method: string | null; reference: string | null }[];
  contract: {
    number: number;
    title: string;
    type: string;
    paymentTerms: string | null;
  };
  project: { number: number; name: string } | null;
  recipient: { name: string; logoUrl: string | null } | null;
  contactName: string;
  organization: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    timeZone: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    phone: string | null;
    email: string | null;
    paymentInstructions: string;
  };
};

// The invoice a customer opens. Same paper as a contract, and it answers
// one question at the top: how much is owed and by when. `today` comes
// from the caller as yyyy-mm-dd in the workspace's own zone, so "overdue"
// means overdue where the business is, not where the server is.
export function InvoiceDocument({
  invoice,
  today,
}: {
  invoice: InvoiceDocumentData;
  today: string;
}) {
  const zone = invoice.organization.timeZone;
  const balanceCents = invoice.amountCents - invoice.receivedCents;
  const settled = balanceCents <= 0;
  const dueIso = invoice.dueOn ? invoice.dueOn.toISOString().slice(0, 10) : null;
  const overdue = !settled && dueIso !== null && dueIso < today;
  const address = [
    invoice.organization.addressLine1,
    invoice.organization.addressLine2,
    [invoice.organization.city, invoice.organization.state].filter(Boolean).join(", "),
    invoice.organization.postalCode,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-[#111827] shadow-2xl sm:p-12 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#e5e7eb] pb-6">
        <div className="flex items-center gap-3">
          {invoice.organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={invoice.organization.logoUrl} alt="" className="h-11 w-11 rounded object-cover" />
          ) : (
            <div
              className="flex h-11 w-11 items-center justify-center rounded text-sm font-bold text-white"
              style={{ background: invoice.organization.primaryColor }}
            >
              {invoice.organization.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-lg font-semibold">{invoice.organization.name}</p>
            <p className="text-xs text-[#6b7280]">Invoice</p>
          </div>
        </div>
        <div className="text-right text-xs text-[#6b7280]">
          <p className="font-mono text-sm font-semibold text-[#111827]" data-testid="invoice-number">
            INV-{invoice.invoiceNumber}
          </p>
          {invoice.issuedAt && <p>Sent {formatDate(invoice.issuedAt, zone)}</p>}
          <p>
            For agreement {invoice.contract.type} CON-{invoice.contract.number}
          </p>
          {invoice.project && (
            <p>
              Job PRJ-{invoice.project.number} · {invoice.project.name}
            </p>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-start justify-between gap-6 border-b border-[#e5e7eb] py-6">
        <div className="text-sm">
          <p className="text-[0.7rem] uppercase tracking-wide text-[#6b7280]">Billed to</p>
          <p className="font-semibold">{invoice.recipient?.name || invoice.contactName}</p>
          {invoice.recipient && <p className="text-xs text-[#6b7280]">{invoice.contactName}</p>}
        </div>
        <div className="text-right">
          <p className="text-[0.7rem] uppercase tracking-wide text-[#6b7280]">
            {settled ? "Paid in full" : "Amount due"}
          </p>
          <p
            className="font-mono text-3xl font-semibold"
            style={{ color: settled ? "#15803d" : overdue ? "#b91c1c" : "#111827" }}
            data-testid="invoice-balance"
          >
            {formatCents(settled ? invoice.amountCents : balanceCents)}
          </p>
          {invoice.dueOn && !settled && (
            <p className="text-xs" style={{ color: overdue ? "#b91c1c" : "#6b7280" }}>
              {overdue ? "Was due " : "Due "}
              {formatDay(invoice.dueOn)}
            </p>
          )}
          {settled && invoice.paidAt && (
            <p className="text-xs text-[#15803d]">Received {formatDate(invoice.paidAt, zone)}</p>
          )}
        </div>
      </div>

      <table className="mt-6 w-full text-sm" data-testid="invoice-lines">
        <thead>
          <tr className="border-b border-[#e5e7eb] text-left text-[0.7rem] uppercase tracking-wide text-[#6b7280]">
            <th className="pb-2">What this covers</th>
            <th className="pb-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[#f3f4f6]">
            <td className="py-3">
              <p className="font-medium">{invoice.label}</p>
              <p className="text-xs text-[#6b7280]">{invoice.contract.title}</p>
            </td>
            <td className="py-3 text-right font-mono">{formatCents(invoice.amountCents)}</td>
          </tr>
          {invoice.payments.map((payment, index) => (
            <tr key={index} className="border-b border-[#f3f4f6] text-[#15803d]">
              <td className="py-2">
                <p className="text-xs">
                  Received {formatDay(payment.paidOn)}
                  {payment.method ? ` · ${payment.method}` : ""}
                  {payment.reference ? ` · ${payment.reference}` : ""}
                </p>
              </td>
              <td className="py-2 text-right font-mono text-xs">−{formatCents(payment.amountCents)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-3 text-right font-semibold">{settled ? "Paid in full" : "Balance due"}</td>
            <td className="pt-3 text-right font-mono font-semibold">
              {formatCents(Math.max(0, balanceCents))}
            </td>
          </tr>
        </tbody>
      </table>

      {(invoice.contract.paymentTerms || invoice.organization.paymentInstructions) && (
        <section className="mt-8 border-t border-[#e5e7eb] pt-6 text-sm">
          <p className="text-[0.7rem] uppercase tracking-wide text-[#6b7280]">How to pay</p>
          {invoice.contract.paymentTerms && (
            <p className="mt-1 font-medium">{invoice.contract.paymentTerms}</p>
          )}
          {invoice.organization.paymentInstructions && (
            <p className="mt-1 whitespace-pre-wrap text-[#374151]" data-testid="invoice-instructions">
              {invoice.organization.paymentInstructions}
            </p>
          )}
        </section>
      )}

      <footer className="mt-8 border-t border-[#e5e7eb] pt-5 text-xs text-[#6b7280]">
        <p className="font-medium text-[#111827]">{invoice.organization.name}</p>
        {address.length > 0 && <p>{address.join(" · ")}</p>}
        <p>
          {[invoice.organization.phone, invoice.organization.email].filter(Boolean).join(" · ")}
        </p>
      </footer>
    </div>
  );
}
