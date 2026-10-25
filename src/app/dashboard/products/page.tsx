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
import { loadRatesheetSuppliers } from "./lookups";
import { marginPercent, markupPercent } from "@/lib/price-list";
import { uploadLinkedRatesheet } from "./ratesheets/actions";
import { pageWindow } from "@/lib/list-params";
import { getProductFilterOptions, productWhere } from "@/lib/product-list";
import { parseProductListParams, productListHref } from "@/lib/product-list-params";
import { Pagination } from "@/components/pagination";
import { ProductFilters } from "./product-filters";

const BASE_PATH = "/dashboard/products";

// One page of products at a time, searched and filtered in the database:
// the whole catalog on one page was 44 MB and 24 seconds at 8,600
// products (Oct 21, 2026), and a distributor's full catalog is more.
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await requireSession();
  const params = parseProductListParams(await searchParams);
  const where = productWhere(organizationId, params);

  const [total, unfiltered, options, suppliers] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.count({ where: { organizationId } }),
    getProductFilterOptions(organizationId, params),
    loadRatesheetSuppliers(organizationId),
  ]);
  const window = pageWindow(total, params.per, params.page);
  const products = await prisma.product.findMany({
    where,
    orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
    skip: window.skip,
    take: params.per,
    include: { manufacturer: { select: { name: true } } },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        subtitle={
          unfiltered === 0
            ? "The items and services you pull into quotes."
            : `${total.toLocaleString()} ${total === 1 ? "product" : "products"}${params.q ? ` matching “${params.q}”` : ""}`
        }
        actions={
          <>
            <LinkRatesheetButton uploadAction={uploadLinkedRatesheet} suppliers={suppliers} />
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

      {unfiltered > 0 && <ProductFilters basePath={BASE_PATH} params={params} options={options} />}

      <Card lit>
        {unfiltered > 0 && total === 0 ? (
          <EmptyState
            icon={<IconBox size={20} />}
            title="No products match"
            body="Nothing in your catalog fits this search and these filters. Clear one to see more."
            action={
              <Link href={BASE_PATH} className="btn btn-ghost btn-sm">
                Clear search and filters
              </Link>
            }
          />
        ) : products.length === 0 ? (
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
                  <th className="hidden text-right md:table-cell">Margin</th>
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
                      <td className="num hidden text-right text-xs md:table-cell" data-testid="product-margin">
                        <MarginCell costCents={product.costCents} priceCents={product.unitPriceCents} />
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
        {total > 0 && (
          <Pagination
            total={total}
            from={window.from}
            to={window.to}
            page={window.current}
            pages={window.pages}
            hrefFor={(page) => productListHref(BASE_PATH, params, { page })}
            noun="products"
          />
        )}
      </Card>
    </div>
  );
}

// Margin first (what most of a sale you keep), markup under it (how far
// over cost the price sits) — the two numbers a contractor prices by.
function MarginCell({ costCents, priceCents }: { costCents: number; priceCents: number }) {
  const margin = marginPercent(costCents, priceCents);
  const markup = markupPercent(costCents, priceCents);
  if (margin === null || costCents <= 0) return <span className="faint">—</span>;
  return (
    <>
      <span className={margin < 0 ? "text-[var(--danger)]" : ""}>{Math.round(margin)}%</span>
      {markup !== null && <p className="faint text-[0.7rem]">{Math.round(markup)}% markup</p>}
    </>
  );
}
