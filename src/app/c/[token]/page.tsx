import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { ContractDocument } from "@/components/contract-document";
import { IconDownload } from "@/components/icons";
import { SignForm } from "./sign-form";
import { contractTotalCents } from "@/lib/contracts";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = {
  title: "Contract",
  robots: { index: false, follow: false },
};

export default async function PublicContractPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const contract = await prisma.contract.findUnique({
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
      contact: { select: { name: true, company: { select: { name: true, logoUrl: true } }, email: true } },
      company: { select: { name: true, logoUrl: true } },
      lineItems: { orderBy: { position: "asc" } },
      payments: { orderBy: { position: "asc" } },
    },
  });

  if (!contract) notFound();

  // Drafts stay private; the owning team can still preview their own.
  let isOwnerPreview = false;
  if (contract.status === "DRAFT") {
    const session = await auth();
    isOwnerPreview = session?.user?.organizationId === contract.organization.id;
    if (!isOwnerPreview) notFound();
  }

  const canSign = contract.status === "SENT";
  // A cancelled contract's link stops working for the customer.
  if (contract.status === "CANCELLED" && !isOwnerPreview) {
    const session = await auth();
    if (session?.user?.organizationId !== contract.organization.id) notFound();
  }

  return (
    <div className={`doc-page relative z-10 px-4 py-10 sm:px-6 ${canSign ? "max-sm:pb-28" : ""}`}>
      {isOwnerPreview && (
        <div className="no-print mx-auto mb-4 max-w-3xl rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs">
          <span className="font-semibold">Draft preview.</span>{" "}
          <span className="muted">
            Send the contract to make this link live and enable signing.
          </span>
        </div>
      )}

      <ContractDocument contract={contract} />

      <div className="no-print mx-auto mt-5 flex max-w-3xl justify-center">
        <a href={`/c/${token}/pdf`} className="btn btn-ghost">
          <IconDownload size={14} />
          Download PDF
        </a>
      </div>

      {canSign && (
        <div id="sign" className="no-print mx-auto mt-5 max-w-3xl scroll-mt-6">
          <SignForm token={token} contactName={contract.contact.name} />
        </div>
      )}

      {/* On a phone the sign box is a long scroll down (ux-gaps: 2,900px
          into a 3,100px page), so a bar pinned to the foot takes them
          there, with what they are agreeing to pay. */}
      {canSign && (
        <div
          className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-[var(--hairline-3)] bg-[var(--overlay)] px-4 pb-[calc(0.6rem+env(safe-area-inset-bottom,0px))] pt-2.5 sm:hidden"
          data-testid="review-and-sign-bar"
        >
          <a href="#sign" className="btn btn-primary min-h-12 w-full">
            Review and sign ↓{contract.lineItems.length > 0 ? ` · ${formatCents(contractTotalCents(contract.lineItems, contract.discountCents))}` : ""}
          </a>
        </div>
      )}

      {contract.status === "DECLINED" && (
        <p className="no-print muted mx-auto mt-5 max-w-3xl text-center text-xs">
          This contract was marked declined. Contact {contract.organization.name} if
          that&apos;s a mistake.
        </p>
      )}
    </div>
  );
}
