import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import {
  PageHeader,
  Card,
  CardHeader,
  BackLink,
  StatusBadge,
} from "@/components/ui";
import { IconTrash, IconSend, IconExternal } from "@/components/icons";
import { PublicLinkField } from "@/components/copy-link";
import { LineItemsEditor } from "./line-items-editor";
import { QuoteMetaForm } from "./quote-meta-form";
import { setQuoteStatus, deleteQuote } from "../actions";

// yyyy-mm-dd for <input type="date">, which only accepts that shape.
function toDateInput(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function QuoteBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const [quote, products] = await Promise.all([
    prisma.quote.findFirst({
      where: { id, organizationId },
      include: {
        contact: { select: { id: true, name: true, company: true } },
        lineItems: { orderBy: { position: "asc" } },
      },
    }),
    prisma.product.findMany({
      where: { organizationId, active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        unitPriceCents: true,
        defaultTag: true,
      },
    }),
  ]);

  if (!quote) notFound();

  const publicPath = `/q/${quote.publicToken}`;

  return (
    <div>
      <BackLink href="/dashboard/quotes" label="Quotes" />

      <PageHeader
        eyebrow={`QUO-${quote.number} · ${quote.contact.company || quote.contact.name}`}
        title={quote.title}
        actions={
          <>
            <StatusBadge status={quote.status} />
            <Link
              href={publicPath}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <IconExternal size={13} />
              Preview
            </Link>
            {quote.status === "DRAFT" ? (
              <form action={setQuoteStatus}>
                <input type="hidden" name="quoteId" value={quote.id} />
                <input type="hidden" name="status" value="SENT" />
                <button type="submit" className="btn btn-primary btn-sm">
                  <IconSend size={13} />
                  Mark as sent
                </button>
              </form>
            ) : (
              <form action={setQuoteStatus}>
                <input type="hidden" name="quoteId" value={quote.id} />
                <input type="hidden" name="status" value="DRAFT" />
                <button type="submit" className="btn btn-ghost btn-sm">
                  Back to draft
                </button>
              </form>
            )}
          </>
        }
      />

      {quote.status !== "DRAFT" && (
        <Card className="mb-5 p-4">
          <p className="eyebrow mb-2">Customer link</p>
          <PublicLinkField path={publicPath} />
          <p className="faint mt-2 text-xs">
            Anyone with this link can view the quote — send it by email or text.
            {quote.sentAt && ` Marked sent ${formatDate(quote.sentAt)}.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={setQuoteStatus}>
              <input type="hidden" name="quoteId" value={quote.id} />
              <input type="hidden" name="status" value="ACCEPTED" />
              <button type="submit" className="btn btn-ghost btn-sm">
                Mark accepted
              </button>
            </form>
            <form action={setQuoteStatus}>
              <input type="hidden" name="quoteId" value={quote.id} />
              <input type="hidden" name="status" value="DECLINED" />
              <button type="submit" className="btn btn-ghost btn-sm">
                Mark declined
              </button>
            </form>
          </div>
        </Card>
      )}

      <div className="space-y-5">
        <Card lit>
          <CardHeader
            title="Line items"
            subtitle="Each line carries a product description, project-specific notes and a tag."
          />
          <LineItemsEditor
            quoteId={quote.id}
            products={products}
            initialLines={quote.lineItems.map((item) => ({
              productId: item.productId,
              name: item.name,
              description: item.description,
              projectNotes: item.projectNotes,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              tag: item.tag,
            }))}
          />
        </Card>

        <Card lit>
          <CardHeader title="Quote details" />
          <QuoteMetaForm
            quoteId={quote.id}
            defaults={{
              title: quote.title,
              template: quote.template,
              introNote: quote.introNote,
              terms: quote.terms,
              validUntil: toDateInput(quote.validUntil),
            }}
          />
        </Card>

        <Card className="border-[rgb(251_113_133/0.25)]">
          <CardHeader title="Danger zone" subtitle="Deleting a quote can't be undone." />
          <form action={deleteQuote} className="p-5">
            <input type="hidden" name="quoteId" value={quote.id} />
            <button type="submit" className="btn btn-danger btn-sm">
              <IconTrash size={13} />
              Delete quote
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
