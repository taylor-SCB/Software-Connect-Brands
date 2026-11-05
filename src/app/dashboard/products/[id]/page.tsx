import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { ProductForm } from "../product-form";
import { updateProduct, deleteProduct } from "../actions";
import { loadProductLookups, loadVariationLookups } from "../lookups";
import { repairSupplierRows } from "@/lib/product-suppliers";
import { picturesFor } from "@/lib/product-images";
import { storageDriver } from "@/lib/storage";
import { PicturesCard } from "../pictures-card";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ added?: string }>;
}) {
  const { id } = await params;
  const { added } = await searchParams;
  const { organizationId } = await requireSession();

  // A product made before suppliers had rows gets its row first, so the
  // Suppliers card shows the supplier it already has.
  await repairSupplierRows(organizationId, [id]);
  const [product, lookups] = await Promise.all([
    prisma.product.findFirst({
      where: { id, organizationId },
      include: {
        distributorContacts: { select: { id: true } },
        suppliers: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            distributorId: true,
            costCents: true,
            discountBp: true,
            listPriceCents: true,
            minMarginBp: true,
            distributor: { select: { name: true } },
          },
        },
      },
    }),
    loadProductLookups(organizationId),
  ]);
  if (!product) notFound();

  const [usageCount, variations, pictures] = await Promise.all([
    prisma.quoteLineItem.count({ where: { productId: product.id } }),
    loadVariationLookups(organizationId, product),
    picturesFor(organizationId, [product.id]),
  ]);
  // The Colors it comes in, for a picture's Color box.
  const saved = new Set(variations.savedVariationIds);
  const colors = variations.variationGroups
    .filter((group) => group.kind === "COLOR")
    .flatMap((group) => group.options.filter((option) => saved.has(option.id)))
    .map((option) => ({ id: option.id, name: option.name }));

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

      {added === "1" && (
        <p className="mb-4 rounded-xl border border-[var(--ok)] px-4 py-3 text-sm" role="status" data-testid="product-added">
          Product added. Add pictures below.
        </p>
      )}

      <ProductForm
        action={updateProduct}
        submitLabel="Save changes"
        manufacturers={lookups.manufacturers}
        distributors={lookups.distributors}
        platformSuppliers={lookups.platformSuppliers}
        serviceTypes={lookups.serviceTypes}
        variationGroups={variations.variationGroups}
        savedVariationIds={variations.savedVariationIds}
        customUnits={variations.customUnits}
        defaults={{
          id: product.id,
          name: product.name,
          description: product.description,
          sku: product.sku,
          unitPriceCents: product.unitPriceCents,
          costCents: product.costCents,
          listPriceCents: product.listPriceCents,
          defaultTag: product.defaultTag,
          serviceType: product.serviceType,
          unitOfMeasure: product.unitOfMeasure,
          // A workspace unit counts only while no built-in one is set.
          customUnitId: product.unitOfMeasure ? null : product.customUnitId,
          softwareRate: product.softwareRate,
          softwareTerm: product.softwareTerm,
          manufacturerId: product.manufacturerId,
          distributorId: product.distributorId,
          contactIds: product.distributorContacts.map((contact) => contact.id),
          active: product.active,
          suppliers: product.suppliers.map(({ distributor, ...row }) => ({ ...row, name: distributor.name })),
        }}
      />

      <PicturesCard
        productId={product.id}
        pictures={pictures.get(product.id) ?? []}
        colors={colors}
        storageOn={storageDriver() !== null}
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
