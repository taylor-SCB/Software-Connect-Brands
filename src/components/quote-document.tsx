import { formatCents, formatDate } from "@/lib/format";
import { computeQuoteTotals, lineTotalCents } from "@/lib/quote-math";
import {
  LINE_ITEM_TAGS,
  TAG_COLORS,
  TAG_LABELS,
  type LineItemTagValue,
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
  organization: { name: string; logoUrl: string | null; primaryColor: string };
  contact: {
    name: string;
    company: string | null;
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
  }[];
};

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

/* -------------------------------------------------------------------- */
/* SIMPLE — printable, black on white, nothing to distract from numbers  */
/* -------------------------------------------------------------------- */

function SimpleQuote({ quote }: { quote: QuoteDocumentData }) {
  const totals = getTotals(quote);
  const activeTags = LINE_ITEM_TAGS.filter((tag) => totals.byTag[tag] !== 0);

  return (
    <div className="mx-auto max-w-4xl bg-white p-8 text-[#111827] shadow-2xl sm:p-12 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#e5e7eb] pb-6">
        <div className="flex items-center gap-3">
          {quote.organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={quote.organization.logoUrl}
              alt=""
              className="h-11 w-11 rounded object-cover"
            />
          ) : (
            <div
              className="flex h-11 w-11 items-center justify-center rounded text-sm font-bold text-white"
              style={{ background: quote.organization.primaryColor }}
            >
              {quote.organization.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-lg font-semibold">{quote.organization.name}</p>
            <p className="text-xs text-[#6b7280]">Quotation</p>
          </div>
        </div>
        <div className="text-right text-xs text-[#6b7280]">
          <p className="font-mono text-sm font-semibold text-[#111827]">
            QUO-{quote.number}
          </p>
          <p className="mt-1">Issued {formatDate(quote.createdAt)}</p>
          {quote.validUntil && <p>Valid until {formatDate(quote.validUntil)}</p>}
        </div>
      </header>

      <div className="flex flex-wrap justify-between gap-6 py-6">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#9ca3af]">
            Prepared for
          </p>
          <p className="mt-1 font-medium">
            {quote.contact.company || quote.contact.name}
          </p>
          {quote.contact.company && (
            <p className="text-sm text-[#4b5563]">{quote.contact.name}</p>
          )}
          {quote.contact.email && (
            <p className="text-sm text-[#4b5563]">{quote.contact.email}</p>
          )}
          {quote.contact.phone && (
            <p className="text-sm text-[#4b5563]">{quote.contact.phone}</p>
          )}
        </div>
        <div className="max-w-sm text-right">
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#9ca3af]">
            Project
          </p>
          <p className="mt-1 font-medium">{quote.title}</p>
        </div>
      </div>

      {quote.introNote && (
        <p className="mb-6 whitespace-pre-line border-l-2 border-[#e5e7eb] pl-4 text-sm leading-relaxed text-[#374151]">
          {quote.introNote}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#d1d5db] text-left text-[0.65rem] uppercase tracking-widest text-[#6b7280]">
            <th className="pb-2 font-semibold">Item</th>
            <th className="pb-2 text-right font-semibold">Qty</th>
            <th className="pb-2 text-right font-semibold">Value</th>
            <th className="pb-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {quote.lineItems.map((item) => (
            <tr key={item.id} className="border-b border-[#f3f4f6] align-top">
              <td className="py-3 pr-4">
                <p className="font-medium">{item.name}</p>
                {item.description && (
                  <p className="mt-0.5 text-xs text-[#6b7280]">{item.description}</p>
                )}
                {item.projectNotes && (
                  <p className="mt-0.5 text-xs italic text-[#9ca3af]">
                    {item.projectNotes}
                  </p>
                )}
                <span className="mt-1 inline-block rounded border border-[#e5e7eb] px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[#6b7280]">
                  {TAG_LABELS[item.tag as LineItemTagValue]}
                </span>
              </td>
              <td className="py-3 text-right font-mono tabular-nums">{item.quantity}</td>
              <td className="py-3 text-right font-mono tabular-nums">
                {formatCents(item.unitPriceCents)}
              </td>
              <td className="py-3 text-right font-mono font-medium tabular-nums">
                {formatCents(lineTotalCents(item.quantity, item.unitPriceCents))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 flex flex-wrap justify-between gap-8">
        <div className="min-w-56">
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#9ca3af]">
            Totals by tag
          </p>
          <table className="mt-2 text-sm">
            <tbody>
              {activeTags.map((tag) => (
                <tr key={tag}>
                  <td className="py-1 pr-6 text-[#4b5563]">{TAG_LABELS[tag]}</td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {formatCents(totals.byTag[tag])}
                  </td>
                </tr>
              ))}
              {activeTags.length === 0 && (
                <tr>
                  <td className="py-1 text-[#9ca3af]">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="min-w-56 text-right">
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#9ca3af]">
            Total
          </p>
          <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">
            {formatCents(totals.totalCents)}
          </p>
        </div>
      </div>

      {quote.terms && (
        <footer className="mt-10 border-t border-[#e5e7eb] pt-4">
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#9ca3af]">
            Terms
          </p>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[#4b5563]">
            {quote.terms}
          </p>
        </footer>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* MODERN — dark, brand-lit, the one you send to win the job             */
/* -------------------------------------------------------------------- */

function ModernQuote({ quote }: { quote: QuoteDocumentData }) {
  const totals = getTotals(quote);
  const brand = quote.organization.primaryColor;
  const maxTag = Math.max(...LINE_ITEM_TAGS.map((tag) => totals.byTag[tag]), 1);

  return (
    <div
      className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-[var(--border)]"
      style={{ ["--brand" as string]: brand, background: "#0b0d13" }}
    >
      <header
        className="relative overflow-hidden px-8 py-10 sm:px-12"
        style={{
          background: `radial-gradient(700px 260px at 12% 0%, color-mix(in srgb, ${brand} 40%, transparent), transparent 70%), linear-gradient(180deg, rgb(255 255 255 / 0.06), transparent)`,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            {quote.organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={quote.organization.logoUrl}
                alt=""
                className="h-12 w-12 rounded-xl border border-white/10 object-cover"
              />
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl text-base font-bold text-white"
                style={{
                  background: `linear-gradient(140deg, color-mix(in srgb, ${brand} 85%, white), ${brand})`,
                  boxShadow: `0 10px 30px -10px ${brand}`,
                }}
              >
                {quote.organization.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-lg font-semibold text-white">
                {quote.organization.name}
              </p>
              <p className="text-xs text-white/50">Proposal</p>
            </div>
          </div>
          <div className="text-right">
            <span
              className="badge"
              style={{
                color: brand,
                background: `color-mix(in srgb, ${brand} 16%, transparent)`,
                borderColor: `color-mix(in srgb, ${brand} 35%, transparent)`,
              }}
            >
              QUO-{quote.number}
            </span>
            <p className="mt-2 text-xs text-white/45">
              Issued {formatDate(quote.createdAt)}
            </p>
            {quote.validUntil && (
              <p className="text-xs text-white/45">
                Valid until {formatDate(quote.validUntil)}
              </p>
            )}
          </div>
        </div>

        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {quote.title}
        </h1>
        <p className="mt-2 text-sm text-white/55">
          Prepared for {quote.contact.company || quote.contact.name}
          {quote.contact.company ? ` · ${quote.contact.name}` : ""}
        </p>

        {quote.introNote && (
          <p className="mt-6 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-white/70">
            {quote.introNote}
          </p>
        )}
      </header>

      <div className="px-4 pb-8 sm:px-8">
        <div className="space-y-2">
          {quote.lineItems.map((item) => {
            const tag = item.tag as LineItemTagValue;
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-white/8 bg-white/[0.03] p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-white">{item.name}</p>
                    <span
                      className="badge"
                      style={{
                        color: TAG_COLORS[tag],
                        background: `color-mix(in srgb, ${TAG_COLORS[tag]} 14%, transparent)`,
                        borderColor: `color-mix(in srgb, ${TAG_COLORS[tag]} 32%, transparent)`,
                      }}
                    >
                      {TAG_LABELS[tag]}
                    </span>
                  </div>
                  {item.description && (
                    <p className="mt-1 text-xs text-white/55">{item.description}</p>
                  )}
                  {item.projectNotes && (
                    <p className="mt-0.5 text-xs italic text-white/35">
                      {item.projectNotes}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold tabular-nums text-white">
                    {formatCents(lineTotalCents(item.quantity, item.unitPriceCents))}
                  </p>
                  <p className="font-mono text-xs tabular-nums text-white/40">
                    {item.quantity} × {formatCents(item.unitPriceCents)}
                  </p>
                </div>
              </div>
            );
          })}
          {quote.lineItems.length === 0 && (
            <p className="py-8 text-center text-xs text-white/35">
              No line items on this quote yet.
            </p>
          )}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-white/40">
              Totals by tag
            </p>
            <div className="mt-3 space-y-2">
              {LINE_ITEM_TAGS.map((tag) => (
                <div key={tag} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-white/60">
                    {TAG_LABELS[tag]}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max((totals.byTag[tag] / maxTag) * 100, 0)}%`,
                        background: TAG_COLORS[tag],
                      }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-white/75">
                    {formatCents(totals.byTag[tag])}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            className="flex min-w-56 flex-col justify-center rounded-xl border p-5 text-right"
            style={{
              borderColor: `color-mix(in srgb, ${brand} 35%, transparent)`,
              background: `linear-gradient(160deg, color-mix(in srgb, ${brand} 20%, transparent), transparent)`,
            }}
          >
            <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-white/50">
              Quote total
            </p>
            <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-white">
              {formatCents(totals.totalCents)}
            </p>
          </div>
        </div>

        {quote.terms && (
          <div className="mt-6 border-t border-white/8 pt-4">
            <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-white/40">
              Terms
            </p>
            <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-white/55">
              {quote.terms}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
