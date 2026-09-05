import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { TemplateForm } from "../template-form";
import { createTemplate } from "../../actions";

export default function NewTemplatePage() {
  return (
    <div className="max-w-3xl">
      <BackLink href="/dashboard/contracts/templates" label="Templates" />
      <PageHeader eyebrow="Agreements" title="New template" />
      <Card lit>
        <CardHeader title="Template" />
        <TemplateForm action={createTemplate} submitLabel="Save template" />
      </Card>
    </div>
  );
}
