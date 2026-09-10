import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { CompanyForm } from "../../company-form";
import { updateCompany, deleteCompany } from "../../actions";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const company = await prisma.company.findFirst({ where: { id, organizationId } });
  if (!company) notFound();

  return (
    <div className="max-w-3xl">
      <BackLink href={`/dashboard/companies/${company.id}`} label={company.name} />
      <PageHeader eyebrow="Edit" title={company.name} />

      <Card lit>
        <CardHeader title="Company details" />
        <CompanyForm
          action={updateCompany}
          submitLabel="Save changes"
          defaults={{
            logoUrl: company.logoUrl,
            id: company.id,
            name: company.name,
            phone: company.phone,
            email: company.email,
            website: company.website,
            city: company.city,
            state: company.state,
            status: company.status,
          }}
        />
      </Card>

      <Card className="mt-5 border-[rgb(251_113_133/0.25)]">
        <CardHeader
          title="Danger zone"
          subtitle="Deleting removes the company and the notes and activity logged on it. The people stay as contacts with no company."
        />
        <form action={deleteCompany} className="p-5">
          <input type="hidden" name="companyId" value={company.id} />
          <button type="submit" className="btn btn-danger btn-sm">
            <IconTrash size={13} />
            Delete company
          </button>
        </form>
      </Card>
    </div>
  );
}
