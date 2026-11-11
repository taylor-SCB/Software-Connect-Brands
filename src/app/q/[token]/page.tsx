import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { QuoteDocument } from "@/components/quote-document";
import { IconDownload } from "@/components/icons";
import { linePicture, picturesFor } from "@/lib/product-images";
import { customUnitLabel, readSnapshot } from "@/lib/variation-shared";
import { formatDate } from "@/lib/format";
import { AcceptQuoteForm } from "./accept-form";
import { quoteExpired } from "@/lib/quote-accept";

export const metadata: Metadata = {
  title: "Quote",
  robots: { index: false, follow: false },
};

// Public, unauthenticated document view. The only key is the token in the
// URL, so nothing here may leak other tenants' data — every field
// rendered comes from this one quote.
export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Named field by field on purpose. This is the allow-list of what a
  // customer may see, and it has to stay one: a line carries internal
  // columns (what we pay, who we buy it from) that must never reach the
  // page or the PDF taken from it.
  const quote = await prisma.quote.findUnique({
    where: { publicToken: token },
    select: {
      number: true,
      title: true,
      template: true,
      status: true,
      introNote: true,
      terms: true,
      validUntil: true,
      createdAt: true,
      respondedAt: true,
      acceptedByName: true,
      // The discount on the whole quote and the rate it was given at.
      discountCents: true,
      discountPercent: true,
      organization: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          primaryColor: true,
          timeZone: true,
        },
      },
      contact: {
        select: { name: true, company: { select: { name: true, logoUrl: true } }, email: true, phone: true },
      },
      lineItems: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          projectNotes: true,
          quantity: true,
          unitPriceCents: true,
          discountCents: true,
          tag: true,
          // Release 3b. Read here to work out what is printed (the labels,
          // a workspace unit's name, the picture's token) — the line is
          // handed to the document field by field below, never as it is.
          productId: true,
          unitOfMeasure: true,
          unitLabel: true,
          variations: true,
          variationText: true,
          image: { select: { id: true, publicToken: true, removedAt: true } },
        },
      },
      paymentTerms: true,
      hidePaymentTable: true,
      payments: {
        orderBy: { position: "asc" },
        select: { id: true, label: true, amountCents: true, dueOn: true, terms: true },
      },
      // Only what is filled in on their account gets printed.
      leadSalesRep: { select: { name: true, email: true, phone: true, title: true } },
    },
  });

  if (!quote) notFound();

  // A draft has never been sent, so the link stays dark to the outside
  // world — but the team that owns it can still preview their own work.
  let isOwnerPreview = false;
  if (quote.status === "DRAFT") {
    const session = await auth();
    isOwnerPreview = session?.user?.organizationId === quote.organization.id;
    if (!isOwnerPreview) notFound();
  }

  const expired = quote.status === "SENT" && quoteExpired(quote.validUntil, quote.organization.timeZone);

  // A draft shows each product's picture live; a sent quote, the picture
  // each line went out with.
  const draft = quote.status === "DRAFT";
  const pictures = draft
    ? await picturesFor(
        quote.organization.id,
        quote.lineItems.flatMap((item) => (item.productId ? [item.productId] : [])),
      )
    : new Map();
  const lineItems = quote.lineItems.map((item) => {
    const picture = linePicture(
      {
        productId: item.productId,
        optionIds: readSnapshot(item.variations).map((entry) => entry.optionId),
        image: item.image ? { id: item.image.id, token: item.image.publicToken, removed: Boolean(item.image.removedAt) } : null,
      },
      pictures,
      draft,
    );
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      projectNotes: item.projectNotes,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
      tag: item.tag,
      variationText: item.variationText,
      unitLabel: customUnitLabel(item),
      pictureToken: picture?.token ?? null,
    };
  });

  return (
    <div className="doc-page relative z-10 px-4 py-10 sm:px-6">
      {isOwnerPreview && (
        <div className="no-print mx-auto mb-4 max-w-4xl rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs">
          <span className="font-semibold">Draft preview.</span>{" "}
          <span className="muted">
            This link stays private until you mark the quote as sent.
          </span>
        </div>
      )}
      {/* Hide from quote is honoured here rather than in CSS: hiding it in
          the browser would still ship the numbers inside the page, and
          .no-print only hides things on paper. */}
      <QuoteDocument
        quote={{
          ...quote,
          lineItems,
          payments: quote.hidePaymentTable ? [] : quote.payments,
          paymentTerms: quote.hidePaymentTable ? null : quote.paymentTerms,
          salesRep: quote.leadSalesRep,
        }}
      />

      {/* The customer says yes here (BDR redesign, Release 8). */}
      {quote.status === "SENT" && !expired && <AcceptQuoteForm token={token} businessName={quote.organization.name} />}
      {quote.status === "SENT" && expired && (
        <p className="no-print muted mx-auto mt-5 max-w-4xl text-center text-sm" data-testid="quote-expired">
          This quote expired on {formatDate(quote.validUntil!, quote.organization.timeZone)}. Contact {quote.organization.name} for an updated one.
        </p>
      )}
      {quote.status === "ACCEPTED" && (
        <p className="no-print mx-auto mt-5 max-w-4xl text-center text-sm" data-testid="quote-accepted">
          <span className="font-semibold">Accepted</span>
          {quote.acceptedByName ? ` by ${quote.acceptedByName}` : ""}
          {quote.respondedAt ? ` on ${formatDate(quote.respondedAt, quote.organization.timeZone)}` : ""}. {quote.organization.name} will be in touch with the agreement.
        </p>
      )}

      {/* Contractors need a file to drop into a bid package, not just a
          link — this is the primary action on a customer-facing quote. */}
      <div className="no-print mx-auto mt-5 flex max-w-4xl justify-center">
        <a href={`/q/${token}/pdf`} className="btn btn-primary">
          <IconDownload size={14} />
          Download PDF
        </a>
      </div>

      <p className="no-print faint mt-4 text-center text-xs">
        Questions about this quote? Reply to {quote.organization.name} directly.
      </p>
    </div>
  );
}
