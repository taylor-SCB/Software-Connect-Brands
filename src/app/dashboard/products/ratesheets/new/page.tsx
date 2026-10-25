import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BackLink, PageHeader } from "@/components/ui";
import { RatesheetForm } from "../ratesheet-form";
import { createRatesheet } from "../actions";

export default async function NewRatesheetPage() {
  const { organizationId } = await requireSession();

  // The picker searches the catalog itself; only the count is needed here.
  const productTotal = await prisma.product.count({ where: { organizationId } });

  return (
    <div className="max-w-6xl">
      <BackLink href="/dashboard/products/ratesheets" label="Ratesheets" />
      <PageHeader
        eyebrow="Catalog"
        title="Create Ratesheet"
        subtitle="Pick the products, name the sheet, and decide who can use it."
      />
      <RatesheetForm action={createRatesheet} productTotal={productTotal} submitLabel="Create ratesheet" />
    </div>
  );
}
