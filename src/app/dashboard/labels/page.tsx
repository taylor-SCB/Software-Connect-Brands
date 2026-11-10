import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { loadLabelSections } from "@/lib/crm-labels";
import { LabelsManager } from "./labels-manager";

// CRM → Labels (Nov 10, 2026, Taylor): every Industry, Company Type, Lead
// Label and Job Title in use, how many records carry each, and Rename /
// Merge into… / Retire for Owners and Admins.
export default async function CrmLabelsPage({ searchParams }: { searchParams: Promise<{ title?: string }> }) {
  const { organizationId, role } = await requireSession();
  const titleQuery = String((await searchParams).title ?? "").slice(0, 60);
  const sections = await loadLabelSections(organizationId, titleQuery);
  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Labels"
        subtitle="The industries, company types, lead labels and job titles on your records. Fold the near-duplicates together so filters and reports count them as one."
      />
      <LabelsManager sections={sections} titleQuery={titleQuery} canManage={role === "OWNER" || role === "ADMIN"} />
    </div>
  );
}
