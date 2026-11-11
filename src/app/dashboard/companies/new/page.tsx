import { requireSession } from "@/lib/session";
import { getIndustryPickList } from "@/lib/industries";
import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { CompanyForm } from "../company-form";
import { createCompany } from "../actions";
import { loadRepChoices } from "@/lib/reps";

export default async function NewCompanyPage() {
  const { organizationId } = await requireSession();
  const [pickList, reps] = await Promise.all([getIndustryPickList(organizationId), loadRepChoices(organizationId)]);

  return (
    <div className="max-w-3xl">
      <BackLink href="/dashboard/companies" label="Companies" />
      <PageHeader eyebrow="New record" title="Add company" />
      <Card lit>
        <CardHeader
          title="Company details"
          subtitle="Only the name is required. Add the people who work there from the company's page."
        />
        <CompanyForm action={createCompany} pickList={pickList} reps={reps} submitLabel="Save company" />
      </Card>
    </div>
  );
}
