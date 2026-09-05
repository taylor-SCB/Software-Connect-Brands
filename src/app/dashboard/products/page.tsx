import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { PageHeader, Card, EmptyState, TagBadge, Badge } from "@/components/ui";
import { IconPlus, IconBox } from "@/components/icons";
import type { LineItemTagValue } from "@/lib/constants";

export default async function ProductsPage() {
  const { organizationId } = await requireSession();

  const products = await prisma.product.findMany({
    where: { organizationId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        subtitle="The items and services you pull into quotes."
        actions={
          <Link href="/dashboard/products/new" className="btn btn-primary btn-sm">
            <IconPlus size={14} />
            Add product
          </Link>
        }
      />

      <Card lit>
        {products.length === 0 ? (
          <EmptyState
            icon={<IconBox size={20} />}
            title="No products yet"
            body="Add the labor rates, materials and services you quote most often. Each one carries a default price and tag into the quote builder."
            action={
              <Link href="/dashboard/products/new" className="btn btn-primary btn-sm">
                <IconPlus size={14} />
                Add product
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Default tag</th>
                  <th className="text-right">Unit price</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <Link
                        href={`/dashboard/products/${product.id}`}
                        className="font-medium hover:underline"
                      >
                        {product.name}
                      </Link>
                      {product.description && (
                        <p className="faint mt-0.5 line-clamp-1 max-w-md text-xs">
                          {product.description}
                        </p>
                      )}
                    </td>
                    <td className="faint num text-xs">{product.sku || "—"}</td>
                    <td>
                      <TagBadge tag={product.defaultTag as LineItemTagValue} />
                    </td>
                    <td className="num text-right font-medium">
                      {formatCents(product.unitPriceCents)}
                    </td>
                    <td>
                      {product.active ? (
                        <Badge color="#34d399" dot>
                          Active
                        </Badge>
                      ) : (
                        <Badge color="#64748b">Inactive</Badge>
                      )}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/dashboard/products/${product.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
