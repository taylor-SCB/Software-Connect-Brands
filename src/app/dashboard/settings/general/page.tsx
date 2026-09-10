import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { CompanyTiles } from "../company-tiles";
import { CompanyInfoForm } from "./form";

export default async function CompanyGeneralPage() {
  const session = await requireSession();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
  });
  const canEdit = session.role === "OWNER" || session.role === "ADMIN";

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings · Company Information"
        title="General"
        subtitle="Where you are, how to reach you, and who you are. Contracts can pull any of it in."
      />

      <CompanyTiles current="general" />

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
          }}
          canEdit={canEdit}
        />
      </Card>
    </div>
  );
}
