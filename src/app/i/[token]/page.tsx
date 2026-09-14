import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { InvoiceDocument } from "@/components/invoice-document";
import { IconDownload } from "@/components/icons";
import { paidCentsOf } from "@/lib/money";
import { todayIso } from "@/lib/payments";

export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
};

// The invoice a customer opens. Public by design, like a quote or a
// contract: the link is the only key, so it carries real entropy.
export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const row = await prisma.contractPayment.findUnique({
    where: { invoiceToken: token },
    select: {
      invoiceNumber: true,
      label: true,
      amountCents: true,
      dueOn: true,
      issuedAt: true,
      paidAt: true,
      payments: {
        orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
        select: { amountCents: true, paidOn: true, method: true, reference: true },
      },
      contract: {
        select: {
          number: true,
          title: true,
          type: true,
          paymentTerms: true,
          status: true,
          contact: { select: { name: true, company: { select: { name: true, logoUrl: true } } } },
          company: { select: { name: true, logoUrl: true } },
          project: { select: { number: true, name: true } },
          organization: {
            select: {
              name: true,
              logoUrl: true,
              primaryColor: true,
              timeZone: true,
              addressLine1: true,
              addressLine2: true,
              city: true,
              state: true,
              postalCode: true,
              phone: true,
              email: true,
              paymentInstructions: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!row || row.invoiceNumber === null) notFound();
  // A paused workspace's links go quiet along with the rest of it.
  if (row.contract.organization.status !== "ACTIVE") notFound();

  return (
    <div className="doc-page relative z-10 px-4 py-10 sm:px-6">
      <InvoiceDocument
        invoice={{
          invoiceNumber: row.invoiceNumber,
          label: row.label,
          amountCents: row.amountCents,
          receivedCents: paidCentsOf(row),
          dueOn: row.dueOn,
          issuedAt: row.issuedAt,
          paidAt: row.paidAt,
          payments: row.payments,
          contract: row.contract,
          project: row.contract.project,
          recipient: row.contract.company ?? row.contract.contact.company ?? null,
          contactName: row.contract.contact.name,
          organization: row.contract.organization,
        }}
        today={todayIso(row.contract.organization.timeZone)}
      />

      <div className="no-print mx-auto mt-5 flex max-w-3xl justify-center">
        <a href={`/i/${token}/pdf`} className="btn btn-ghost">
          <IconDownload size={14} />
          Download PDF
        </a>
      </div>
    </div>
  );
}
