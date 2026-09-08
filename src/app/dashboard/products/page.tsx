import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { PageHeader, Card, EmptyState, TagBadge, Badge } from "@/components/ui";
import { IconPlus, IconBox, IconPower } from "@/components/icons";
import {
  UNIT_LABELS,
  SOFTWARE_RATE_LABELS,
  type LineItemTagValue,
  type UnitOfMeasureValue,
  type SoftwareRateValue,
} from "@/lib/constants";
import { ProductsSubnav } from "./products-subnav";
import { ProductRowActions } from "./product-row-actions";
import { LinkRatesheetButton } from "./link-ratesheet-button";
import { toggleProductActive } from "./actions";
import { uploadLinkedRatesheet } from "./ratesheets/actions";

export default async function ProductsPage() {
  const { organizationId } = await requireSession();

  const products = await prisma.product.findMany({
    where: { organizationId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { manufacturer: { select: { name: true } } },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        subtitle="The items and services you pull into quotes."
        actions={
          <>
            <LinkRatesheetButton action={uploadLinkedRatesheet} />
            <Link href="/dashboard/products/ratesheets/new" className="btn btn-neon btn-sm">
              <IconPlus size={14} />
              Create Ratesheet
            </Link>
            <Link href="/dashboard/products/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              Add product
            </Link>
          </>
        }
      />

      <ProductsSubnav current="products" />

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
                  <th className="hidden md:table-cell">SKU</th>
                  <th>Default tag</th>
                  <th className="hidden text-right md:table-cell">COGS</th>
                  <th className="text-right">Unit price</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const unit = product.unitOfMeasure
                    ? UNIT_LABELS[product.unitOfMeasure as UnitOfMeasureValue]
                    : null;
                  const rate = product.softwareRate
                    ? SOFTWARE_RATE_LABELS[product.softwareRate as SoftwareRateValue]
                    : null;
                  return (
                    <tr key={product.id}>
                      <td>
                        <Link
                          href={`/dashboard/products/${product.id}`}
                          className="font-medium hover:underline"
                        >
                          {product.name}
                        </Link>
                        {(product.manufacturer || product.description) && (
                          <p className="faint mt-0.5 line-clamp-1 max-w-md text-xs">
                            {product.manufacturer && (
                              <span className="muted">{product.manufacturer.name}</span>
                            )}
                            {product.manufacturer && product.description && " · "}
                            {product.description}
                          </p>
                        )}
                      </td>
                      <td className="faint num hidden text-xs md:table-cell">{product.sku || "—"}</td>
                      <td>
                        <TagBadge tag={product.defaultTag as LineItemTagValue} />
                      </td>
                      {/* Internal cost. This list is the owner's own; the
                          partner page never selects the column. */}
                      <td className="num muted hidden text-right md:table-cell">
                        {formatCents(product.costCents)}
                      </td>
                      <td className="num text-right font-medium">
                        {formatCents(product.unitPriceCents)}
                        {unit && (
                          <p className="faint text-[0.7rem] font-normal">
                            {unit}
                            {rate && ` · ${rate}`}
                          </p>
                        )}
                      </td>
                      <td>
                        {/* The state and the button that flips it sit
                            together, so "Inactive" always reads as the
                            action next to an Active badge. */}
                        <div className="flex items-center gap-2">
                          {product.active ? (
                            <Badge color="#34d399" dot>
                              Active
                            </Badge>
                          ) : (
                            <Badge color="#64748b">Inactive</Badge>
                          )}
                          <form action={toggleProductActive}>
                            <input type="hidden" name="productId" value={product.id} />
                            <button
                              type="submit"
                              className="btn btn-ghost btn-sm"
                              title={product.active ? "Mark inactive" : "Mark active"}
                            >
                              <IconPower size={12} />
                              {product.active ? "Inactive" : "Active"}
                            </button>
                          </form>
                        </div>
                      </td>
                      <td className="text-right">
                        <ProductRowActions productId={product.id} productName={product.name} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
