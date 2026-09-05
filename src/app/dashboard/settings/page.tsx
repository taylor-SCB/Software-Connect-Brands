import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { BrandingForm } from "./form";

export default async function SettingsPage() {
  const session = await requireSession();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
  });

  const canEdit = session.role === "OWNER" || session.role === "ADMIN";

  return (
    <div className="max-w-2xl">
      <PageHeader
        eyebrow="Workspace"
        title="Branding"
        subtitle="Your name and colors across the dashboard, quotes and contracts."
      />

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
          }}
          canEdit={canEdit}
        />
      </Card>
    </div>
  );
}
