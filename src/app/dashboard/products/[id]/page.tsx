import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { ProductForm } from "../product-form";
import { updateProduct, deleteProduct } from "../actions";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const product = await prisma.product.findFirst({ where: { id, organizationId } });
  if (!product) notFound();

  const usageCount = await prisma.quoteLineItem.count({
    where: { productId: product.id },
  });

  return (
    <div className="max-w-3xl">
      <BackLink href="/dashboard/products" label="Products" />
      <PageHeader
        eyebrow="Catalog"
        title={product.name}
        subtitle={
          usageCount > 0
            ? `Used on ${usageCount} quote ${usageCount === 1 ? "line" : "lines"}`
            : "Not used on any quotes yet"
        }
      />

      <Card lit>
        <CardHeader title="Product details" />
        <ProductForm
          action={updateProduct}
          submitLabel="Save changes"
          defaults={{
            id: product.id,
            name: product.name,
            description: product.description,
            sku: product.sku,
            unitPriceCents: product.unitPriceCents,
            defaultTag: product.defaultTag,
            active: product.active,
          }}
        />
      </Card>

      <Card className="mt-5 border-[rgb(251_113_133/0.25)]">
        <CardHeader
          title="Danger zone"
          subtitle="Quotes already built keep their own copy of the name and price, so existing documents are unaffected."
        />
        <form action={deleteProduct} className="p-5">
          <input type="hidden" name="productId" value={product.id} />
          <button type="submit" className="btn btn-danger btn-sm">
            <IconTrash size={13} />
            Delete product
          </button>
        </form>
      </Card>
    </div>
  );
}
