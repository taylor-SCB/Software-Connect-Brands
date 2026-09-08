import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { ProductForm } from "../product-form";
import { updateProduct, deleteProduct } from "../actions";
import { loadProductLookups } from "../lookups";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const [product, lookups] = await Promise.all([
    prisma.product.findFirst({
      where: { id, organizationId },
      include: { distributorContacts: { select: { id: true } } },
    }),
    loadProductLookups(organizationId),
  ]);
  if (!product) notFound();

  const usageCount = await prisma.quoteLineItem.count({
    where: { productId: product.id },
  });

  return (
    <div className="max-w-6xl">
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

      <ProductForm
        action={updateProduct}
        submitLabel="Save changes"
        manufacturers={lookups.manufacturers}
        distributors={lookups.distributors}
        defaults={{
          id: product.id,
          name: product.name,
          description: product.description,
          sku: product.sku,
          unitPriceCents: product.unitPriceCents,
          costCents: product.costCents,
          defaultTag: product.defaultTag,
          unitOfMeasure: product.unitOfMeasure,
          softwareRate: product.softwareRate,
          softwareTerm: product.softwareTerm,
          manufacturerId: product.manufacturerId,
          distributorId: product.distributorId,
          contactIds: product.distributorContacts.map((contact) => contact.id),
          active: product.active,
        }}
      />

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
