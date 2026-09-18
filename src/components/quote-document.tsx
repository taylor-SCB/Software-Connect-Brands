// formatDay forces UTC: a due date is a DATE column that comes back as
// midnight UTC, and a zone-aware format would print the day before for
// anyone west of it.
import { formatCents, formatDate, formatDay } from "@/lib/format";
import { computeQuoteTotals, lineTotalCents, termTotalCents } from "@/lib/quote-math";
import {
  LINE_ITEM_TAGS,
  TAG_LABELS,
  UNIT_LABELS,
  SOFTWARE_BILLING_LABELS,
  type LineItemTagValue,
  type UnitOfMeasureValue,
  type SoftwareRateValue,
} from "@/lib/constants";

export type QuoteDocumentData = {
  number: number;
  title: string;
  template: string;
  status: string;
  introNote: string;
  terms: string;
  validUntil: Date | null;
  createdAt: Date;
  organization: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    timeZone: string;
    website: string | null;
  };
  contact: {
    name: string;
    company: { name: string; logoUrl?: string | null } | null;
    email: string | null;
    phone: string | null;
  };
  lineItems: {
    id: string;
    name: string;
    description: string;
    projectNotes: string;
    quantity: number;
    unitPriceCents: number;
    tag: string;
    // How a software line is counted, how it bills and for how long. The
    // customer is entitled to all three: the amount beside the line is one
    // period, and without the term it reads as the whole deal.
    unitOfMeasure: string | null;
    softwareRate: string | null;
    softwareTermMonths: number | null;
  }[];
  // What the customer is asked to pay and when. Not fetched at all when
  // the quote is set to hide it, so the numbers never reach the page.
  // Deliberately without percent or kind: how a row was worked out is
  // ours, the amount is theirs.
  paymentTerms?: string | null;
  payments?: { id: string; label: string; amountCents: number; dueOn: Date | null; terms: string | null }[];
  // Who to call about it. Only the fields filled in on their account.
  salesRep?: { name: string; email: string | null; phone: string | null; title: string | null } | null;
};

// This type is the allow-list for what a customer may see. A line's
// supplier and what it costs us are not on it, and must not be added.

/* -------------------------------------------------------------------- */
/* Shared pieces                                                         */
/* -------------------------------------------------------------------- */

// Money and quantities are set in the body face with tabular figures
// rather than the mono stack: mono here carried a wide advance that made
// every price look stretched and cheap on the printed page, which is the
// single biggest reason the old document read as amateur.
const NUM = "tabular-nums [font-variant-numeric:tabular-nums] tracking-normal";

// What the software on this quote comes to over its whole term, and how
// long that term is when every software line agrees on one. The amount
// beside a software line is a single period — per month, per year — so
// without this the customer is reading a fraction of what they are
// committing to. Kept separate from the quote total, which stays the sum
// of the line amounts exactly as every other line is counted.
function softwareOverTerm(quote: QuoteDocumentData) {
  const lines = quote.lineItems.filter(
    (item) => item.tag === "SOFTWARE" && item.softwareRate && item.softwareTermMonths,
  );
  if (lines.length === 0) return null;

  const totalCents = lines.reduce(
    (sum, item) =>
      sum + (termTotalCents(item.quantity, item.unitPriceCents, item.softwareRate, item.softwareTermMonths) ?? 0),
    0,
  );
  const terms = new Set(lines.map((item) => item.softwareTermMonths));
  // Only name the term when every software line runs the same one.
  const months = terms.size === 1 ? [...terms][0] : null;
  return { totalCents, months };
}

function termLabel(months: number | null | undefined) {
  if (!months) return null;
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years}-year term`;
  }
  return `${months}-month term`;
}

// "Per Device · Monthly · 36-month term" under a software line's name.
function softwareSpec(item: QuoteDocumentData["lineItems"][number]) {
  if (item.tag !== "SOFTWARE") return null;
  const parts = [
    item.unitOfMeasure ? UNIT_LABELS[item.unitOfMeasure as UnitOfMeasureValue] : null,
    item.softwareRate ? SOFTWARE_BILLING_LABELS[item.softwareRate as SoftwareRateValue] : null,
    termLabel(item.softwareTermMonths),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// One label style for every section, so the eye learns it once.
function Eyebrow({
  children,
  dark = false,
  accent,
}: {
  children: React.ReactNode;
  dark?: boolean;
  accent?: string;
}) {
  return (
    <p
      className={`text-[0.6rem] font-semibold uppercase tracking-[0.14em] ${
        dark ? "text-white/45" : "text-[#9ca3af]"
      }`}
      style={accent ? { color: accent } : undefined}
    >
      {children}
    </p>
  );
}

function TagChip({ tag, dark = false }: { tag: string; dark?: boolean }) {
  return (
    <span
      className={`ml-2 inline-block whitespace-nowrap rounded-full px-2 py-[0.1rem] align-middle text-[0.6rem] font-medium tracking-wide ${
        dark ? "bg-white/10 text-white/65" : "bg-[#f3f4f6] text-[#6b7280]"
      }`}
    >
      {TAG_LABELS[tag as LineItemTagValue]}
    </span>
  );
}

// The line items table. One column layout for both templates so a quote
// reads the same whichever skin it is sent in — and, more to the point,
// so Qty / Value / Total get real room instead of being squeezed into the
// last third of the page while Item holds a half-page of white space.
function LineItems({ quote, dark = false }: { quote: QuoteDocumentData; dark?: boolean }) {
  const rule = dark ? "border-white/10" : "border-[#e5e7eb]";
  const head = dark ? "text-white/45" : "text-[#9ca3af]";
  const sub = dark ? "text-white/50" : "text-[#6b7280]";
  const note = dark ? "text-white/35" : "text-[#9ca3af]";

  return (
    <table className="w-full text-[0.82rem]">
      <colgroup>
        <col style={{ width: "50%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "19%" }} />
        <col style={{ width: "19%" }} />
      </colgroup>
      <thead>
        <tr className={`border-b ${rule} text-left text-[0.6rem] uppercase tracking-[0.14em] ${head}`}>
          <th className="pb-2 font-semibold">Item</th>
          <th className="pb-2 pl-3 text-right font-semibold">Qty</th>
          <th className="pb-2 pl-3 text-right font-semibold">Unit price</th>
          <th className="pb-2 pl-3 text-right font-semibold">Amount</th>
        </tr>
      </thead>
      <tbody>
        {quote.lineItems.map((item) => {
          const spec = softwareSpec(item);
          const overTerm = termTotalCents(
            item.quantity,
            item.unitPriceCents,
            item.softwareRate,
            item.softwareTermMonths,
          );
          const perPeriod = lineTotalCents(item.quantity, item.unitPriceCents);
          return (
            <tr key={item.id} className={`border-b ${rule} align-top`}>
              <td className="py-3 pr-4">
                <span className="font-medium">{item.name}</span>
                <TagChip tag={item.tag} dark={dark} />
                {spec && <p className={`mt-1 text-[0.72rem] leading-snug ${sub}`}>{spec}</p>}
                {item.description && <p className={`mt-1 text-[0.75rem] leading-snug ${sub}`}>{item.description}</p>}
                {item.projectNotes && (
                  <p className={`mt-0.5 text-[0.72rem] italic leading-snug ${note}`}>{item.projectNotes}</p>
                )}
              </td>
              <td className={`py-3 pl-3 text-right ${NUM} ${sub}`}>{item.quantity}</td>
              <td className={`py-3 pl-3 text-right ${NUM} ${sub}`}>{formatCents(item.unitPriceCents)}</td>
              <td className={`py-3 pl-3 text-right font-medium ${NUM}`}>
                {formatCents(perPeriod)}
                {/* The amount above is one billing period. Saying so, and
                    what the term comes to, stops a customer reading a
                    monthly figure as the whole commitment. */}
                {overTerm !== null && overTerm !== perPeriod && (
                  <span className={`mt-0.5 block text-[0.7rem] font-normal leading-snug ${sub}`}>
                    {formatCents(overTerm)} over term
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// The money block: what each kind of work came to, then the one number
// the reader is looking for, set in the workspace's own colour.
function Totals({
  quote,
  totals,
  dark = false,
}: {
  quote: QuoteDocumentData;
  totals: ReturnType<typeof computeQuoteTotals>;
  dark?: boolean;
}) {
  const brand = quote.organization.primaryColor;
  const activeTags = LINE_ITEM_TAGS.filter((tag) => totals.byTag[tag] !== 0);
  const rule = dark ? "border-white/10" : "border-[#e5e7eb]";
  const sub = dark ? "text-white/50" : "text-[#6b7280]";
  const software = softwareOverTerm(quote);

  return (
    <div className="mt-6 flex justify-end">
      <div className="w-full max-w-[21rem]">
        {activeTags.map((tag) => (
          <div key={tag} className="py-1">
            <div className={`flex items-baseline justify-between text-[0.8rem] ${sub}`}>
              <span>{TAG_LABELS[tag]}</span>
              <span className={NUM}>{formatCents(totals.byTag[tag])}</span>
            </div>
            {/* Software is the one tag whose subtotal is a period, not a
                sum, so it carries what the whole term comes to. */}
            {tag === "SOFTWARE" && software && (
              <div className={`flex items-baseline justify-between text-[0.72rem] ${sub} opacity-75`}>
                <span>{termLabel(software.months) ?? "over the term"}</span>
                <span className={NUM}>{formatCents(software.totalCents)}</span>
              </div>
            )}
          </div>
        ))}
        <div className={`mt-2 flex items-baseline justify-between border-t-2 pt-3 ${rule}`} style={{ borderTopColor: brand }}>
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em]">Total</span>
          <span
            className={`text-[1.75rem] font-semibold leading-none ${NUM}`}
            style={{ color: dark ? "#fff" : brand }}
            data-testid="document-total"
          >
            {formatCents(totals.totalCents)}
          </span>
        </div>
      </div>
    </div>
  );
}

function PaymentSchedule({
  payments,
  paymentTerms,
  dark = false,
}: {
  payments: QuoteDocumentData["payments"];
  paymentTerms?: string | null;
  dark?: boolean;
}) {
  if (!payments || payments.length === 0) return null;
  const total = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const rule = dark ? "border-white/10" : "border-[#e5e7eb]";
  const head = dark ? "text-white/45" : "text-[#9ca3af]";
  const sub = dark ? "text-white/50" : "text-[#6b7280]";

  return (
    <section className="mt-9" data-testid="document-payments">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow dark={dark}>Payment schedule</Eyebrow>
        {paymentTerms && <span className={`text-[0.75rem] ${sub}`}>{paymentTerms}</span>}
      </div>
      {/* Same column rhythm as the items table above, so the two read as
          one document rather than two tables that happen to share a page. */}
      <table className="w-full text-[0.82rem]">
        <colgroup>
          <col style={{ width: "50%" }} />
          <col style={{ width: "31%" }} />
          <col style={{ width: "19%" }} />
        </colgroup>
        <thead>
          <tr className={`border-b ${rule} text-left text-[0.6rem] uppercase tracking-[0.14em] ${head}`}>
            <th className="pb-2 font-semibold">Payment</th>
            <th className="pb-2 pl-3 font-semibold">Due</th>
            <th className="pb-2 pl-3 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className={`border-b ${rule}`}>
              <td className="py-2.5 pr-4 font-medium">{payment.label}</td>
              {/* A picked date wins; otherwise the row's term stands in. */}
              <td className={`py-2.5 pl-3 ${sub}`}>
                {payment.dueOn ? formatDay(payment.dueOn) : payment.terms || "—"}
              </td>
              <td className={`py-2.5 pl-3 text-right font-medium ${NUM}`}>{formatCents(payment.amountCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em]">Total</td>
            <td />
            <td
              className={`pt-3 pl-3 text-right font-semibold ${NUM}`}
              data-testid="document-payments-total"
            >
              {formatCents(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

// Strips the scheme so a website reads as a brand rather than a URL.
function tidyWebsite(url: string) {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function SalesRep({
  rep,
  organization,
  dark = false,
}: {
  rep: QuoteDocumentData["salesRep"];
  organization: QuoteDocumentData["organization"];
  dark?: boolean;
}) {
  const website = organization.website?.trim();
  // The card is worth printing for the website alone: a quote with no rep
  // named should still tell the customer where the company lives.
  if (!rep && !website) return null;

  const sub = dark ? "text-white/55" : "text-[#4b5563]";
  const faint = dark ? "text-white/40" : "text-[#6b7280]";
  const box = dark ? "border-white/10 bg-white/[0.03]" : "border-[#e5e7eb] bg-[#fafafa]";

  return (
    <section className={`mt-9 rounded-lg border px-5 py-4 ${box}`} data-testid="document-rep">
      <Eyebrow dark={dark} accent={dark ? undefined : organization.primaryColor}>
        Questions about this quote?
      </Eyebrow>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        {rep && (
          <>
            <p className="text-[0.95rem] font-semibold">
              {rep.name}
              {/* Each line only when that field is filled in on their account. */}
              {rep.title && <span className={`ml-2 text-[0.8rem] font-normal ${sub}`}>{rep.title}</span>}
            </p>
            <p className={`text-[0.82rem] ${sub}`}>
              {rep.email}
              {rep.email && rep.phone && <span className="px-2 opacity-40">·</span>}
              {rep.phone}
            </p>
          </>
        )}
      </div>
      {website && (
        <p className={`mt-2 border-t pt-2 text-[0.8rem] ${faint} ${dark ? "border-white/10" : "border-[#e5e7eb]"}`}>
          {organization.name} · {tidyWebsite(website)}
        </p>
      )}
    </section>
  );
}

export function QuoteDocument({ quote }: { quote: QuoteDocumentData }) {
  return quote.template === "MODERN" ? (
    <ModernQuote quote={quote} />
  ) : (
    <SimpleQuote quote={quote} />
  );
}

function getTotals(quote: QuoteDocumentData) {
  return computeQuoteTotals(
    quote.lineItems.map((item) => ({
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      tag: item.tag,
    })),
  );
}

function Logo({ quote, size = 44 }: { quote: QuoteDocumentData; size?: number }) {
  if (quote.organization.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={quote.organization.logoUrl}
        alt=""
        style={{ height: size, width: size }}
        className="rounded-md object-contain"
      />
    );
  }
  return (
    <div
      style={{ height: size, width: size, background: quote.organization.primaryColor }}
      className="flex items-center justify-center rounded-md text-base font-bold text-white"
    >
      {quote.organization.name.charAt(0).toUpperCase()}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* SIMPLE — printable, black on white, nothing to distract from numbers  */
/* -------------------------------------------------------------------- */

function SimpleQuote({ quote }: { quote: QuoteDocumentData }) {
  const totals = getTotals(quote);
  const brand = quote.organization.primaryColor;
  const zone = quote.organization.timeZone;

  return (
    <div className="mx-auto max-w-4xl bg-white text-[#111827] shadow-2xl print:shadow-none">
      {/* The workspace's colour as a band across the top: the one place a
          plain paper quote can carry a brand without fighting the type. */}
      <div style={{ background: brand }} className="h-1.5 w-full" />

      <div className="p-8 sm:p-12">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3.5">
            <Logo quote={quote} />
            <div>
              <p className="text-[1.05rem] font-semibold leading-tight">{quote.organization.name}</p>
              <p className="mt-0.5 text-[0.75rem] text-[#6b7280]">Quotation</p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-[1.05rem] font-semibold leading-tight ${NUM}`}>QUO-{quote.number}</p>
            <p className="mt-0.5 text-[0.75rem] text-[#6b7280]">
              Issued {formatDate(quote.createdAt, zone)}
            </p>
            {quote.validUntil && (
              <p className="text-[0.75rem] font-medium" style={{ color: brand }}>
                Valid until {formatDate(quote.validUntil, zone)}
              </p>
            )}
          </div>
        </header>

        <div className="mt-8 grid gap-6 border-y border-[#e5e7eb] py-5 sm:grid-cols-2">
          <div>
            <Eyebrow>Prepared for</Eyebrow>
            <p className="mt-1.5 flex items-center gap-2 text-[0.95rem] font-semibold">
              {quote.contact.company?.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={quote.contact.company.logoUrl} alt="" className="h-6 w-6 rounded object-contain" />
              )}
              {quote.contact.company?.name || quote.contact.name}
            </p>
            <div className="mt-0.5 text-[0.82rem] leading-relaxed text-[#4b5563]">
              {quote.contact.company?.name && <p>{quote.contact.name}</p>}
              {quote.contact.email && <p>{quote.contact.email}</p>}
              {quote.contact.phone && <p>{quote.contact.phone}</p>}
            </div>
          </div>
          <div className="sm:text-right">
            <Eyebrow>Project</Eyebrow>
            <p className="mt-1.5 text-[0.95rem] font-semibold">{quote.title}</p>
          </div>
        </div>

        {quote.introNote && (
          <p className="mt-6 whitespace-pre-line text-[0.85rem] leading-relaxed text-[#374151]">
            {quote.introNote}
          </p>
        )}

        <div className="mt-8">
          <LineItems quote={quote} />
        </div>

        <Totals quote={quote} totals={totals} />

        <PaymentSchedule payments={quote.payments} paymentTerms={quote.paymentTerms} />

        {quote.terms && (
          <section className="mt-9 border-t border-[#e5e7eb] pt-4">
            <Eyebrow>Terms</Eyebrow>
            <p className="mt-1.5 whitespace-pre-line text-[0.78rem] leading-relaxed text-[#4b5563]">
              {quote.terms}
            </p>
          </section>
        )}

        <SalesRep rep={quote.salesRep} organization={quote.organization} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* MODERN — dark, brand-lit, the one you send to win the job             */
/* -------------------------------------------------------------------- */

function ModernQuote({ quote }: { quote: QuoteDocumentData }) {
  const totals = getTotals(quote);
  const brand = quote.organization.primaryColor;
  const zone = quote.organization.timeZone;
  const activeTags = LINE_ITEM_TAGS.filter((tag) => totals.byTag[tag] !== 0);
  // Bars are relative to the biggest kind of work, not to the total, so a
  // small category is still visible.
  const maxTag = Math.max(...activeTags.map((tag) => totals.byTag[tag]), 1);
  const software = softwareOverTerm(quote);

  return (
    <div
      className="mx-auto max-w-4xl overflow-hidden rounded-2xl"
      style={{ background: "#0b0d13" }}
    >
      <div
        className="px-8 pb-10 pt-8 sm:px-12"
        style={{ background: `linear-gradient(160deg, ${brand}26 0%, transparent 62%)` }}
      >
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3.5">
            <Logo quote={quote} />
            <div>
              <p className="text-[1.05rem] font-semibold leading-tight text-white">
                {quote.organization.name}
              </p>
              <p className="mt-0.5 text-[0.75rem] text-white/50">Proposal</p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-[1.05rem] font-semibold leading-tight text-white ${NUM}`}>
              QUO-{quote.number}
            </p>
            <p className="mt-0.5 text-[0.75rem] text-white/50">Issued {formatDate(quote.createdAt, zone)}</p>
            {quote.validUntil && (
              <p className="text-[0.75rem] font-medium text-white/80">
                Valid until {formatDate(quote.validUntil, zone)}
              </p>
            )}
          </div>
        </header>

        <h1 className="mt-9 text-[2.4rem] font-semibold leading-[1.1] tracking-tight text-white">
          {quote.title}
        </h1>
        <p className="mt-2 text-[0.9rem] text-white/55">
          Prepared for {quote.contact.company?.name || quote.contact.name}
          {quote.contact.company?.name && ` · ${quote.contact.name}`}
        </p>

        {quote.introNote && (
          <p className="mt-5 max-w-2xl whitespace-pre-line text-[0.85rem] leading-relaxed text-white/60">
            {quote.introNote}
          </p>
        )}
      </div>

      <div className="px-8 pb-10 text-white sm:px-12">
        <LineItems quote={quote} dark />

        <div className="mt-7 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
          {activeTags.length > 0 && (
            <div>
              <Eyebrow dark>Totals by tag</Eyebrow>
              <div className="mt-2.5 space-y-2">
                {activeTags.map((tag) => (
                  <div key={tag}>
                    <div className="flex items-center gap-3 text-[0.8rem]">
                      <span className="w-28 shrink-0 text-white/55">{TAG_LABELS[tag]}</span>
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/8">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max((totals.byTag[tag] / maxTag) * 100, 3)}%`,
                            background: brand,
                          }}
                        />
                      </span>
                      <span className={`w-28 shrink-0 text-right text-white/80 ${NUM}`}>
                        {formatCents(totals.byTag[tag])}
                      </span>
                    </div>
                    {/* Software bills per period, so its bar is one period
                        too. The line under it is what the customer is
                        actually signing up to across the whole term. */}
                    {tag === "SOFTWARE" && software && (
                      <div className="mt-1 flex items-center gap-3 text-[0.72rem]">
                        <span className="w-28 shrink-0 text-white/35">
                          {termLabel(software.months) ?? "Over the term"}
                        </span>
                        <span className="h-px flex-1 bg-white/8" />
                        <span className={`w-28 shrink-0 text-right text-white/55 ${NUM}`}>
                          {formatCents(software.totalCents)}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className="rounded-xl px-6 py-5 text-right sm:min-w-[15rem]"
            style={{ background: `linear-gradient(150deg, ${brand}33, ${brand}0d)` }}
          >
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-white/55">
              Quote total
            </p>
            <p
              className={`mt-1.5 text-[2rem] font-semibold leading-none text-white ${NUM}`}
              data-testid="document-total"
            >
              {formatCents(totals.totalCents)}
            </p>
          </div>
        </div>

        <PaymentSchedule payments={quote.payments} paymentTerms={quote.paymentTerms} dark />

        {quote.terms && (
          <section className="mt-9 border-t border-white/10 pt-4">
            <Eyebrow dark>Terms</Eyebrow>
            <p className="mt-1.5 whitespace-pre-line text-[0.78rem] leading-relaxed text-white/55">
              {quote.terms}
            </p>
          </section>
        )}

        <SalesRep rep={quote.salesRep} organization={quote.organization} dark />
      </div>
    </div>
  );
}
