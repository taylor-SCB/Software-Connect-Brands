import { formatDate, formatDateTime, formatDay, formatCents } from "@/lib/format";
import { TAG_LABELS, type LineItemTagValue } from "@/lib/constants";
import { contractTotalCents } from "@/lib/contracts";

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
  // Set by the Contract Coordinator: the business the document is
  // addressed to when it isn't the contact's own company.
  company?: { name: string; logoUrl: string | null } | null;
  lineItems?: { id: string; name: string; description: string; quantity: number; unitPriceCents: number; tag: string }[];
  payments?: { id: string; label: string; amountCents: number; dueOn: Date | null; terms?: string | null; paidAt: Date | null }[];
  paymentTerms?: string | null;
  senderSignerName?: string | null;
};

// An agreement is set to be read and relied on, not to sell. It is typeset
// rather than styled: a serif face for the body, one measure narrow enough
// to track across, numbered clauses that carry weight, and almost no
// colour — a single hairline of the workspace's own at the very top and
// nothing else. Everything that would flatter a quote (tinted totals,
// bars, brand headings) is deliberately absent here.
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif';

// Figures stay in the body face with tabular numerals so columns line up.
const NUM = "tabular-nums [font-variant-numeric:tabular-nums] tracking-normal";

function Rule() {
  return <div className="my-7 h-px w-full bg-[#e5e7eb]" />;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[#6b7280]">
      {children}
    </h2>
  );
}

// Contract bodies are plain text by design — rendering them as HTML would
// mean trusting template authors with markup inside a legal document, so
// the text is escaped by React and whitespace is preserved instead.
//
// The one thing read out of the text is its shape: a line that is short,
// has no sentence punctuation and is either numbered or upper case is a
// clause heading, and is set as one. That is presentation only; not a
// character of the agreement changes.
// Mirrors what renderMergeFields now does at creation time: take the
// token out, take the line with it when nothing but punctuation is left,
// and close the hole it leaves behind.
function stripTokens(body: string) {
  const token = /\{\{\s*[a-z_]+\s*\}\}/gi;
  const hasToken = /\{\{\s*[a-z_]+\s*\}\}/i;
  const separatorsOnly = /^[\s·,;:|/\\\-–—()[\]]*$/;

  return body
    .split("\n")
    .filter((line) => !(hasToken.test(line) && separatorsOnly.test(line.replace(token, ""))))
    .map((line) =>
      hasToken.test(line)
        ? line
            .replace(token, "")
            .replace(/\s*([·|])(?:\s*[·|])+\s*/g, " $1 ")
            .replace(/\s*([,;])(?:\s*[,;])+\s*/g, "$1 ")
            .replace(/([:—–-])\s*[·|,;]\s*/g, "$1 ")
            .replace(/[\s·|,;]+$/, "")
            .replace(/(\S)[ \t]{2,}/g, "$1 ")
        : line,
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function isHeading(line: string) {
  const text = line.trim();
  if (!text || text.length > 70) return false;
  if (/[.;:,]$/.test(text)) return false;
  const numbered = /^\d+(\.\d+)*[.)]?\s+\S/.test(text);
  const shouty = text === text.toUpperCase() && /[A-Z]{3}/.test(text);
  return numbered || shouty;
}

function ContractBody({ body }: { body: string }) {
  // A last line of defence for contracts created before merge fields
  // learned to drop themselves: their text is frozen in the database and
  // still carries "{{your_company_address}}" where a detail was missing.
  // A raw token is never meaningful content to either party, so it is not
  // shown — but the body itself is left exactly as it was stored, because
  // that is what was signed.
  const clean = stripTokens(body);
  // Blank-line separated blocks, so a clause and its paragraphs stay
  // together when the PDF breaks across pages.
  const blocks = clean.split(/\n{2,}/);
  return (
    <div style={{ fontFamily: SERIF }} className="text-[0.9rem] leading-[1.65] text-[#1f2937]">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const heading = isHeading(lines[0]) ? lines[0].trim() : null;
        const rest = heading ? lines.slice(1).join("\n") : block;
        return (
          <div key={index} className="break-inside-avoid" style={{ marginTop: index === 0 ? 0 : "1.15rem" }}>
            {heading && (
              <p className="mb-1 font-semibold tracking-tight text-[#111827]">{heading}</p>
            )}
            {rest.trim() && <p className="whitespace-pre-wrap">{rest}</p>}
          </div>
        );
      })}
    </div>
  );
}

export function ContractDocument({ contract }: { contract: ContractDocumentData }) {
  const recipient = contract.company ?? contract.contact.company ?? null;
  const recipientName = recipient?.name || contract.contact.name;
  const lineItems = contract.lineItems ?? [];
  const payments = contract.payments ?? [];
  const totalCents = contractTotalCents(lineItems);
  const zone = contract.organization.timeZone;
  const brand = contract.organization.primaryColor;
  const lastDue =
    payments
      .map((p) => p.dueOn)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => a.getTime() - b.getTime())
      .at(-1) ?? null;

  return (
    <div className="mx-auto max-w-3xl bg-white text-[#111827] shadow-2xl print:shadow-none">
      {/* The only colour on the page. */}
      <div style={{ background: brand, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }} className="h-1 w-full" />

      <div className="px-8 py-10 sm:px-14">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3.5">
            {contract.organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={contract.organization.logoUrl} alt="" className="h-11 w-11 rounded object-contain" />
            ) : (
              <div
                className="flex h-11 w-11 items-center justify-center rounded text-base font-bold text-white"
                style={{ background: brand, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
              >
                {contract.organization.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-[1.05rem] font-semibold leading-tight">{contract.organization.name}</p>
              <p className="mt-0.5 text-[0.75rem] text-[#6b7280]">{contract.type || "Agreement"}</p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-[1.05rem] font-semibold leading-tight ${NUM}`}>CON-{contract.number}</p>
            <p className="mt-0.5 text-[0.75rem] text-[#6b7280]">Issued {formatDate(contract.createdAt, zone)}</p>
            {contract.paymentTerms && (
              <p className="text-[0.75rem] text-[#6b7280]">Terms: {contract.paymentTerms}</p>
            )}
          </div>
        </header>

        <h1
          style={{ fontFamily: SERIF }}
          className="mt-9 text-center text-[1.6rem] font-semibold leading-tight tracking-tight"
        >
          {contract.title}
        </h1>

        {/* The parties, set as a formal recital rather than three stacked
            paragraphs — this is the first thing a reader checks. */}
        <div className="mt-7 grid gap-x-10 gap-y-4 border-y border-[#e5e7eb] py-5 sm:grid-cols-2">
          <div>
            <SectionHeading>Between</SectionHeading>
            <p style={{ fontFamily: SERIF }} className="text-[0.95rem] font-semibold">
              {contract.organization.name}
            </p>
            {contract.senderSignerName && (
              <p className="mt-0.5 text-[0.8rem] text-[#4b5563]">{contract.senderSignerName}</p>
            )}
          </div>
          <div>
            <SectionHeading>And</SectionHeading>
            {/* The other side's own mark, beside their name rather than
                floating in the header — this is where a reader checks who
                the agreement is with. */}
            <p style={{ fontFamily: SERIF }} className="flex items-center gap-2 text-[0.95rem] font-semibold">
              {recipient?.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={recipient.logoUrl} alt="" className="h-6 w-6 rounded object-contain" />
              )}
              {recipientName}
            </p>
            <p className="mt-0.5 text-[0.8rem] text-[#4b5563]">
              {contract.contact.name !== recipientName ? `Attn: ${contract.contact.name}` : contract.contact.name}
              {contract.contact.email ? ` · ${contract.contact.email}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-7">
          <ContractBody body={contract.body} />
        </div>

        {lineItems.length > 0 && (
          <>
            <Rule />
            <section data-testid="document-items" className="break-inside-avoid">
              <SectionHeading>Schedule of items</SectionHeading>
              <table className="w-full text-[0.82rem]">
                <colgroup>
                  <col style={{ width: "44%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "15%" }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-[#d1d5db] text-left text-[0.6rem] uppercase tracking-[0.14em] text-[#6b7280]">
                    <th className="pb-2 font-semibold">Item</th>
                    <th className="pb-2 pl-3 font-semibold">Category</th>
                    <th className="pb-2 pl-3 text-right font-semibold">Qty</th>
                    <th className="pb-2 pl-3 text-right font-semibold">Unit price</th>
                    <th className="pb-2 pl-3 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item) => (
                    <tr key={item.id} className="border-b border-[#f3f4f6] align-top">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium">{item.name}</p>
                        {item.description && (
                          <p className="mt-0.5 text-[0.75rem] leading-snug text-[#6b7280]">{item.description}</p>
                        )}
                      </td>
                      <td className="py-2.5 pl-3 text-[#6b7280]">
                        {TAG_LABELS[item.tag as LineItemTagValue] ?? item.tag}
                      </td>
                      <td className={`py-2.5 pl-3 text-right text-[#6b7280] ${NUM}`}>{item.quantity}</td>
                      <td className={`py-2.5 pl-3 text-right text-[#6b7280] ${NUM}`}>
                        {formatCents(item.unitPriceCents)}
                      </td>
                      <td className={`py-2.5 pl-3 text-right font-medium ${NUM}`}>
                        {formatCents(Math.round(item.quantity * item.unitPriceCents))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="pt-3 text-right text-[0.7rem] font-semibold uppercase tracking-[0.14em]">
                      Total
                    </td>
                    <td
                      className={`pt-3 pl-3 text-right text-[1.05rem] font-semibold ${NUM}`}
                      data-testid="document-total"
                    >
                      {formatCents(totalCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </section>
          </>
        )}

        {payments.length > 0 && (
          <>
            <Rule />
            <section data-testid="document-payments" className="break-inside-avoid">
              <SectionHeading>Payment schedule</SectionHeading>
              <table className="w-full text-[0.82rem]">
                <colgroup>
                  <col style={{ width: "50%" }} />
                  <col style={{ width: "31%" }} />
                  <col style={{ width: "19%" }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-[#d1d5db] text-left text-[0.6rem] uppercase tracking-[0.14em] text-[#6b7280]">
                    <th className="pb-2 font-semibold">Payment</th>
                    <th className="pb-2 pl-3 font-semibold">Due</th>
                    <th className="pb-2 pl-3 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-[#f3f4f6]">
                      <td className="py-2.5 pr-3 font-medium">
                        {payment.label}
                        {payment.paidAt && (
                          <span className="ml-2 text-[0.72rem] font-normal text-[#047857]">
                            Paid {formatDate(payment.paidAt, zone)}
                          </span>
                        )}
                      </td>
                      {/* A picked date wins; otherwise the row's term. */}
                      <td className="py-2.5 pl-3 text-[#6b7280]">
                        {payment.dueOn ? formatDay(payment.dueOn) : payment.terms || "—"}
                      </td>
                      <td className={`py-2.5 pl-3 text-right font-medium ${NUM}`}>
                        {formatCents(payment.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="pt-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em]">Total</td>
                    <td className="pt-3 pl-3 text-[0.75rem] text-[#6b7280]">
                      {lastDue ? `Final payment ${formatDay(lastDue)}` : ""}
                    </td>
                    <td className={`pt-3 pl-3 text-right font-semibold ${NUM}`}>
                      {formatCents(payments.reduce((sum, payment) => sum + payment.amountCents, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </section>
          </>
        )}

        <Rule />

        {/* Execution. Ruled lines and a printed name under each, the way an
            agreement is signed on paper — and once it is signed here, the
            electronic record set out plainly underneath rather than dressed
            up as a success message. */}
        <section className="break-inside-avoid">
          <SectionHeading>Execution</SectionHeading>
          <p style={{ fontFamily: SERIF }} className="mb-6 text-[0.85rem] leading-relaxed text-[#4b5563]">
            The parties have executed this {contract.type || "agreement"} as of the dates written below.
          </p>

          <div className="grid gap-10 sm:grid-cols-2">
            <div>
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-[#9ca3af]">
                For {recipientName}
              </p>
              {contract.status === "SIGNED" && contract.signedAt ? (
                <>
                  <p
                    className="mt-3 border-b border-[#111827] pb-1 text-[1.35rem] leading-tight text-[#111827]"
                    style={{ fontFamily: SERIF, fontStyle: "italic" }}
                  >
                    {contract.signerName}
                  </p>
                  {/* The typed name is printed once. The contact is only
                      added when they are someone else. */}
                  <p className="mt-1.5 text-[0.75rem] text-[#4b5563]">
                    {contract.signerName}
                    {contract.contact.name && contract.contact.name !== contract.signerName
                      ? ` · ${contract.contact.name}`
                      : ""}
                  </p>
                  <p className="mt-0.5 text-[0.72rem] text-[#6b7280]">
                    {formatDateTime(contract.signedAt, zone)}
                  </p>
                  <p className="mt-2 text-[0.68rem] leading-snug text-[#9ca3af]">
                    Accepted electronically
                    {contract.contact.email ? ` · ${contract.contact.email}` : ""}
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-3 h-11 border-b border-[#9ca3af]" />
                  <p className="mt-1.5 text-[0.75rem] text-[#4b5563]">{contract.contact.name}</p>
                  <div className="mt-6 h-6 border-b border-[#d1d5db]" />
                  <p className="mt-1.5 text-[0.7rem] text-[#9ca3af]">Date</p>
                </>
              )}
            </div>

            <div>
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-[#9ca3af]">
                For {contract.organization.name}
              </p>
              <div className="mt-3 h-11 border-b border-[#9ca3af]" />
              <p className="mt-1.5 text-[0.75rem] text-[#4b5563]">
                {contract.senderSignerName || contract.organization.name}
              </p>
              <div className="mt-6 h-6 border-b border-[#d1d5db]" />
              <p className="mt-1.5 text-[0.7rem] text-[#9ca3af]">Date</p>
            </div>
          </div>
        </section>

        <p className={`mt-10 text-center text-[0.68rem] text-[#9ca3af] ${NUM}`}>
          CON-{contract.number} · {contract.organization.name}
        </p>
      </div>
    </div>
  );
}
