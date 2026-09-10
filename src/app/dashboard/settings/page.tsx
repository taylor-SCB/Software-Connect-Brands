import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { CompanyTiles } from "./company-tiles";
import { BrandingForm } from "./form";

export default async function SettingsPage() {
  const session = await requireSession();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
  });

  const canEdit = session.role === "OWNER" || session.role === "ADMIN";

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings · Company Information"
        title="Branding"
        subtitle="Your name, logo and colors across the dashboard, quotes and contracts."
      />

      <CompanyTiles current="branding" />

      <Card lit>
        <CardHeader
          title="White-label settings"
          subtitle={
            canEdit
              ? "Changes apply everywhere immediately, including customer-facing documents."
              : "Only owners and admins can change these."
          }
        />
        <BrandingForm
          organization={{
            name: organization.name,
            logoUrl: organization.logoUrl,
            primaryColor: organization.primaryColor,
            timeZone: organization.timeZone,
          }}
          canEdit={canEdit}
        />
      </Card>
    </div>
  );
}
