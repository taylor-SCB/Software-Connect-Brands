import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { ContractDocument } from "@/components/contract-document";
import { SignForm } from "./sign-form";

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
        select: { id: true, name: true, logoUrl: true, primaryColor: true },
      },
      contact: { select: { name: true, company: true, email: true } },
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

  return (
    <div className="relative z-10 px-4 py-10 sm:px-6">
      {isOwnerPreview && (
        <div className="no-print mx-auto mb-4 max-w-3xl rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs">
          <span className="font-semibold">Draft preview.</span>{" "}
          <span className="muted">
            Send the contract to make this link live and enable signing.
          </span>
        </div>
      )}

      <ContractDocument contract={contract} />

      {canSign && (
        <div className="no-print mx-auto mt-5 max-w-3xl">
          <SignForm token={token} contactName={contract.contact.name} />
        </div>
      )}

      {contract.status === "DECLINED" && (
        <p className="muted mx-auto mt-5 max-w-3xl text-center text-xs">
          This contract was marked declined. Contact {contract.organization.name} if
          that&apos;s a mistake.
        </p>
      )}
    </div>
  );
}
