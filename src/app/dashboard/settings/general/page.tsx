import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { CompanyTiles } from "../company-tiles";
import { CompanyInfoForm } from "./form";
import { AccountTypeCard } from "./account-type-card";

// How long an answered type request is still mentioned on the card.
const ANSWER_SHOWN_DAYS = 30;

// The workspace's open type request, and the last one answered lately.
function loadTypeRequests(organizationId: string) {
  return Promise.all([
    prisma.accountTypeRequest.findFirst({
      where: { organizationId, status: "PENDING" },
      select: { toType: true, createdAt: true, requestedBy: { select: { name: true } } },
    }),
    prisma.accountTypeRequest.findFirst({
      where: {
        organizationId,
        status: { in: ["APPROVED", "DECLINED"] },
        decidedAt: { gte: new Date(Date.now() - ANSWER_SHOWN_DAYS * 24 * 60 * 60 * 1000) },
      },
      orderBy: { decidedAt: "desc" },
      select: { toType: true, status: true, decidedAt: true },
    }),
  ]);
}

export default async function CompanyGeneralPage() {
  const session = await requireSession();
  const [organization, [openRequest, lastAnswer]] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: session.organizationId },
    }),
    loadTypeRequests(session.organizationId),
  ]);
  const canEdit = session.role === "OWNER" || session.role === "ADMIN";

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings · Company Information"
        title="General"
        subtitle="Where you are, how to reach you, and who you are. Contracts can pull any of it in."
      />

      <CompanyTiles current="general" />

      <Card lit className="mb-5" id="account-type">
        <CardHeader
          title="Account type"
          subtitle="What kind of company you are. Every account can use every part of the app."
        />
        <AccountTypeCard
          accountType={organization.accountType}
          hasPlace={Boolean(organization.city || organization.state)}
          canEdit={canEdit}
          open={
            openRequest
              ? {
                  toType: openRequest.toType,
                  askedOn: formatDate(openRequest.createdAt, organization.timeZone),
                  askedBy: openRequest.requestedBy?.name ?? null,
                }
              : null
          }
          answered={
            lastAnswer?.decidedAt
              ? {
                  toType: lastAnswer.toType,
                  approved: lastAnswer.status === "APPROVED",
                  answeredOn: formatDate(lastAnswer.decidedAt, organization.timeZone),
                }
              : null
          }
        />
      </Card>

      <Card lit>
        <CardHeader
          title={organization.name}
          subtitle={
            canEdit
              ? "Merge fields under the Settings tab on a template read from here."
              : "Only owners and admins can change these."
          }
        />
        <CompanyInfoForm
          organization={{
            name: organization.name,
            logoUrl: organization.logoUrl,
            addressLine1: organization.addressLine1,
            addressLine2: organization.addressLine2,
            city: organization.city,
            state: organization.state,
            postalCode: organization.postalCode,
            phone: organization.phone,
            email: organization.email,
            website: organization.website,
            description: organization.description,
            history: organization.history,
            defaultPaymentTerms: organization.defaultPaymentTerms,
            defaultPaymentPreset: organization.defaultPaymentPreset,
            defaultDepositPercent: organization.defaultDepositPercent,
            defaultInstallmentCount: organization.defaultInstallmentCount,
            paymentInstructions: organization.paymentInstructions,
            quoteFollowUpDays: organization.quoteFollowUpDays,
            contractFollowUpDays: organization.contractFollowUpDays,
          }}
          canEdit={canEdit}
        />
      </Card>
    </div>
  );
}
