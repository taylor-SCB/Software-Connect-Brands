import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BrandingForm } from "./form";

export default async function SettingsPage() {
  const { organizationId } = await requireSession();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold text-gray-900">Branding</h1>
      <p className="mt-1 text-sm text-gray-500">
        This is how your CRM appears to everyone on your team.
      </p>
      <BrandingForm organization={organization} />
    </div>
  );
}
