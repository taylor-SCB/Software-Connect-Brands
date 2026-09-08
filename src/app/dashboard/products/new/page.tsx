import { requireSession } from "@/lib/session";
import { BackLink, PageHeader } from "@/components/ui";
import { ProductForm } from "../product-form";
import { createProduct } from "../actions";
import { loadProductLookups } from "../lookups";

export default async function NewProductPage() {
  const { organizationId } = await requireSession();
  const { manufacturers, distributors } = await loadProductLookups(organizationId);

  return (
    <div className="max-w-6xl">
      <BackLink href="/dashboard/products" label="Products" />
      <PageHeader eyebrow="Catalog" title="Add product" />
      <ProductForm
        action={createProduct}
        submitLabel="Save product"
        manufacturers={manufacturers}
        distributors={distributors}
      />
    </div>
  );
}
