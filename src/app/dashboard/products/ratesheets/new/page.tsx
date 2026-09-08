import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BackLink, PageHeader } from "@/components/ui";
import { RatesheetForm } from "../ratesheet-form";
import { createRatesheet } from "../actions";

export default async function NewRatesheetPage() {
  const { organizationId } = await requireSession();

  const products = await prisma.product.findMany({
    where: { organizationId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, sku: true, unitPriceCents: true, defaultTag: true, active: true },
  });

  return (
    <div className="max-w-6xl">
      <BackLink href="/dashboard/products/ratesheets" label="Ratesheets" />
      <PageHeader
        eyebrow="Catalog"
        title="Create Ratesheet"
        subtitle="Pick the products, name the sheet, and decide who can use it."
      />
      <RatesheetForm action={createRatesheet} products={products} submitLabel="Create ratesheet" />
    </div>
  );
}
