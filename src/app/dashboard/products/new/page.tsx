import { requireSession } from "@/lib/session";
import { BackLink, PageHeader } from "@/components/ui";
import { ProductForm } from "../product-form";
import { createProduct } from "../actions";
import { loadProductLookups, loadVariationLookups } from "../lookups";

export default async function NewProductPage() {
  const { organizationId } = await requireSession();
  const [{ manufacturers, distributors, serviceTypes, platformSuppliers }, variations] = await Promise.all([
    loadProductLookups(organizationId),
    loadVariationLookups(organizationId, null),
  ]);

  return (
    <div className="max-w-6xl">
      <BackLink href="/dashboard/products" label="Products" />
      <PageHeader eyebrow="Catalog" title="Add product" />
      <ProductForm
        action={createProduct}
        submitLabel="Save product"
        manufacturers={manufacturers}
        distributors={distributors}
        platformSuppliers={platformSuppliers}
        serviceTypes={serviceTypes}
        variationGroups={variations.variationGroups}
        customUnits={variations.customUnits}
      />
    </div>
  );
}
