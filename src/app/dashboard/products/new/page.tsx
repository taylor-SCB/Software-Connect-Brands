import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { ProductForm } from "../product-form";
import { createProduct } from "../actions";

export default function NewProductPage() {
  return (
    <div className="max-w-3xl">
      <BackLink href="/dashboard/products" label="Products" />
      <PageHeader eyebrow="Catalog" title="Add product" />
      <Card lit>
        <CardHeader title="Product details" />
        <ProductForm action={createProduct} submitLabel="Save product" />
      </Card>
    </div>
  );
}
