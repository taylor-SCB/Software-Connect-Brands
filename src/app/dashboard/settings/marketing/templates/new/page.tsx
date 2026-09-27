import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/session";
import { PageHeader, Card, BackLink } from "@/components/ui";
import { MarketingTemplateForm } from "../template-form";
import { createMarketingTemplate } from "../../actions";

export default async function NewMarketingTemplatePage() {
  const session = await requireAdminSession();
  if (!session.allowed) redirect("/dashboard/settings/marketing");

  return (
    <div className="max-w-3xl">
      <BackLink href="/dashboard/settings/marketing" label="Marketing" />
      <PageHeader eyebrow="Settings · Company Information · Marketing" title="New email template" />
      <Card lit className="p-5">
        <MarketingTemplateForm action={createMarketingTemplate} submitLabel="Save template" />
      </Card>
    </div>
  );
}
