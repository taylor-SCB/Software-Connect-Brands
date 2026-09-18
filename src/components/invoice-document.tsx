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

const NUM = "tabular-nums [font-variant-numeric:tabular-nums] tracking-normal";

const PAID = "#15803d";
const LATE = "#b91c1c";

// Whole days between two yyyy-mm-dd dates. Compared as dates rather than
// timestamps so "due today" is never off by an hour of time zone.
function daysBetween(fromIso: string, toIso: string) {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

// The invoice a customer opens. It answers one question at the top — how
// much is owed and by when — and says it in a word before they read a
// number. `today` comes from the caller as yyyy-mm-dd in the workspace's
// own zone, so "overdue" means overdue where the business is, not where
// the server is.
export function InvoiceDocument({
  invoice,
  today,
}: {
  invoice: InvoiceDocumentData;
  today: string;
}) {
  const zone = invoice.organization.timeZone;
  const brand = invoice.organization.primaryColor;
  const balanceCents = invoice.amountCents - invoice.receivedCents;
  const settled = balanceCents <= 0;
  const dueIso = invoice.dueOn ? invoice.dueOn.toISOString().slice(0, 10) : null;
  const overdue = !settled && dueIso !== null && dueIso < today;
  const partPaid = !settled && invoice.receivedCents > 0;
  const days = dueIso ? daysBetween(today, dueIso) : null;

  const status = settled ? "Paid in full" : overdue ? "Overdue" : partPaid ? "Part paid" : "Due";
  const statusColor = settled ? PAID : overdue ? LATE : brand;

  // "14 days overdue", "Due in 9 days", "Due today".
  const when =
    days === null
      ? null
      : days < 0
        ? `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`
        : days === 0
          ? "Due today"
          : `Due in ${days} ${days === 1 ? "day" : "days"}`;

  const address = [
    invoice.organization.addressLine1,
    invoice.organization.addressLine2,
    [invoice.organization.city, invoice.organization.state].filter(Boolean).join(", "),
    invoice.organization.postalCode,
  ].filter(Boolean);

  // "Checks to Acme\nZelle: pay@acme.com" reads better as rows than as a
  // paragraph — each way to pay is a separate thing to act on.
  const howToPay = invoice.organization.paymentInstructions
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl bg-white text-[#111827] shadow-2xl print:shadow-none">
      <div
        style={{ background: brand, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
        className="h-1.5 w-full"
      />

      <div className="px-8 py-10 sm:px-12">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3.5">
            {invoice.organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={invoice.organization.logoUrl} alt="" className="h-11 w-11 rounded-md object-contain" />
            ) : (
              <div
                className="flex h-11 w-11 items-center justify-center rounded-md text-base font-bold text-white"
                style={{ background: brand, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
              >
                {invoice.organization.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-[1.05rem] font-semibold leading-tight">{invoice.organization.name}</p>
              <p className="mt-0.5 text-[0.75rem] text-[#6b7280]">Invoice</p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-[1.05rem] font-semibold leading-tight ${NUM}`} data-testid="invoice-number">
              INV-{invoice.invoiceNumber}
            </p>
            {invoice.issuedAt && (
              <p className="mt-0.5 text-[0.75rem] text-[#6b7280]">Sent {formatDate(invoice.issuedAt, zone)}</p>
            )}
            <p className="text-[0.75rem] text-[#6b7280]">
              {invoice.contract.type} CON-{invoice.contract.number}
            </p>
            {invoice.project && (
              <p className="text-[0.75rem] text-[#6b7280]">
                Job PRJ-{invoice.project.number} · {invoice.project.name}
              </p>
            )}
          </div>
        </header>

        {/* The hero: status in a word, then the number, then when. */}
        <div className="mt-8 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[#9ca3af]">Billed to</p>
            <p className="mt-1.5 text-[1.05rem] font-semibold">
              {invoice.recipient?.name || invoice.contactName}
            </p>
            {invoice.recipient && <p className="text-[0.82rem] text-[#4b5563]">{invoice.contactName}</p>}
            <p className="mt-1 text-[0.82rem] text-[#6b7280]">{invoice.contract.title}</p>
          </div>

          <div
            className="rounded-xl px-6 py-5 text-right sm:min-w-[16rem]"
            style={{
              background: `linear-gradient(150deg, ${statusColor}1f, ${statusColor}08)`,
              border: `1px solid ${statusColor}2e`,
              printColorAdjust: "exact",
              WebkitPrintColorAdjust: "exact",
            }}
          >
            <span
              className="inline-block rounded-full px-2.5 py-[0.15rem] text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-white"
              style={{ background: statusColor, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
              data-testid="invoice-status"
            >
              {status}
            </span>
            <p
              className={`mt-2 text-[2rem] font-semibold leading-none ${NUM}`}
              style={{ color: settled ? PAID : overdue ? LATE : "#111827" }}
              data-testid="invoice-balance"
            >
              {formatCents(settled ? invoice.amountCents : balanceCents)}
            </p>
            {!settled && invoice.dueOn && (
              <p className="mt-1.5 text-[0.75rem] font-medium" style={{ color: overdue ? LATE : "#6b7280" }}>
                {when} · {formatDay(invoice.dueOn)}
              </p>
            )}
            {settled && invoice.paidAt && (
              <p className="mt-1.5 text-[0.75rem] font-medium" style={{ color: PAID }}>
                Received {formatDate(invoice.paidAt, zone)}
              </p>
            )}
          </div>
        </div>

        <table className="mt-9 w-full text-[0.82rem]" data-testid="invoice-lines">
          <colgroup>
            <col style={{ width: "72%" }} />
            <col style={{ width: "28%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-[#e5e7eb] text-left text-[0.6rem] uppercase tracking-[0.14em] text-[#9ca3af]">
              <th className="pb-2 font-semibold">What this covers</th>
              <th className="pb-2 pl-3 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-3 pr-3">
                <p className="font-medium">{invoice.label}</p>
                <p className="mt-0.5 text-[0.75rem] text-[#6b7280]">
                  {invoice.contract.type} CON-{invoice.contract.number}
                </p>
              </td>
              <td className={`py-3 pl-3 text-right font-medium ${NUM}`}>{formatCents(invoice.amountCents)}</td>
            </tr>
            {invoice.payments.map((payment, index) => (
              <tr key={index} className="border-b border-[#f3f4f6]">
                <td className="py-2 pr-3 text-[0.78rem]" style={{ color: PAID }}>
                  Received {formatDay(payment.paidOn)}
                  {payment.method ? ` · ${payment.method}` : ""}
                  {payment.reference ? ` · ${payment.reference}` : ""}
                </td>
                <td className={`py-2 pl-3 text-right text-[0.78rem] ${NUM}`} style={{ color: PAID }}>
                  −{formatCents(payment.amountCents)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-3 text-right text-[0.7rem] font-semibold uppercase tracking-[0.14em]">
                {settled ? "Paid in full" : "Balance due"}
              </td>
              <td
                className={`pt-3 pl-3 text-right text-[1.05rem] font-semibold ${NUM}`}
                style={{ color: settled ? PAID : overdue ? LATE : "#111827" }}
              >
                {formatCents(Math.max(0, balanceCents))}
              </td>
            </tr>
          </tfoot>
        </table>

        {(invoice.contract.paymentTerms || howToPay.length > 0) && (
          <section className="mt-9 rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-5 py-4">
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em]" style={{ color: brand }}>
              How to pay
            </p>
            {invoice.contract.paymentTerms && (
              <p className="mt-1.5 text-[0.9rem] font-semibold">{invoice.contract.paymentTerms}</p>
            )}
            {howToPay.length > 0 && (
              <ul className="mt-2 space-y-1" data-testid="invoice-instructions">
                {howToPay.map((line, index) => (
                  <li key={index} className="flex gap-2.5 text-[0.85rem] text-[#374151]">
                    <span aria-hidden className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-[#9ca3af]" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <footer className="mt-8 border-t border-[#e5e7eb] pt-5 text-[0.78rem] text-[#6b7280]">
          <p className="font-semibold text-[#111827]">{invoice.organization.name}</p>
          {address.length > 0 && <p className="mt-0.5">{address.join(" · ")}</p>}
          {(invoice.organization.phone || invoice.organization.email) && (
            <p>{[invoice.organization.phone, invoice.organization.email].filter(Boolean).join(" · ")}</p>
          )}
          {!settled && <p className="mt-2">Please reference INV-{invoice.invoiceNumber} with your payment.</p>}
        </footer>
      </div>
    </div>
  );
}
