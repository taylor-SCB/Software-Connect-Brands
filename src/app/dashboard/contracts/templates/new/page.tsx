import { requireSession } from "@/lib/session";
import { loadContractPickers } from "@/lib/contract-pickers";
import { BackLink, PageHeader } from "@/components/ui";
import { TemplateWorkspace } from "../template-workspace";
import { createTemplate } from "../../actions";

export default async function NewTemplatePage() {
  const { organizationId, userId } = await requireSession();
  const pickers = await loadContractPickers(organizationId);

  return (
    <div>
      <BackLink href="/dashboard/contracts/templates" label="Templates" />
      <PageHeader
        eyebrow="Agreements"
        title="New template"
        subtitle="Write it once with merge fields; generate it for any customer from the right."
      />
      <TemplateWorkspace
        action={createTemplate}
        submitLabel="Save template"
        currentUserId={userId}
        pickers={pickers}
      />
    </div>
  );
}
