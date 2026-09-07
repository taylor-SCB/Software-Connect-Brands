import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { QuoteDocument } from "@/components/quote-document";
import { IconDownload } from "@/components/icons";

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

  const quote = await prisma.quote.findUnique({
    where: { publicToken: token },
    include: {
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
        select: { name: true, company: true, email: true, phone: true },
      },
      lineItems: { orderBy: { position: "asc" } },
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
      <QuoteDocument quote={quote} />

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
