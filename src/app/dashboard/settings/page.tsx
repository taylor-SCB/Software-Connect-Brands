import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { BrandingForm, HelloSignIntegrationForm } from "./form";

export default async function SettingsPage() {
  const session = await requireSession();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
  });

  const canEdit = session.role === "OWNER" || session.role === "ADMIN";

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        subtitle="Configure branding, integrations, and e-signature options."
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
            timeZone: organization.timeZone,
          }}
          canEdit={canEdit}
        />
      </Card>

      <Card lit>
        <CardHeader
          title="HelloSign integration"
          subtitle={
            canEdit
              ? "Enable professional e-signatures for contracts. Customers can sign with their own HelloSign account."
              : "Only owners and admins can configure integrations."
          }
        />
        <HelloSignIntegrationForm
          organization={{
            hellosignApiKey: organization.hellosignApiKey,
          }}
          canEdit={canEdit}
        />
      </Card>
    </div>
  );
}
