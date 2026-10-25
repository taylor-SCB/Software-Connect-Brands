"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "@/components/icons";
import { Chip, MultiSelect } from "@/components/list-filters";
import { LINE_ITEM_TAGS, PAGE_SIZES, TAG_LABELS, type LineItemTagValue } from "@/lib/constants";
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  activeProductFilterCount,
  productListHref,
  type ProductFilterOptions,
  type ProductListParams,
  type ProductStatusValue,
} from "@/lib/product-list-params";

// The bar above the Products table: the search box, the stacking
// dropdowns (Supplier, Manufacturer, Tag, Service type, Status) and the
// per-page choice. The same shape as the Contacts bar: every change is a
// new address, so the database does the filtering at any catalog size and
// the view can be bookmarked.
export function ProductFilters({
  basePath,
  params: current,
  options,
}: {
  basePath: string;
  params: ProductListParams;
  options: ProductFilterOptions;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Shows a click at once and holds it until the server has answered;
  // built from the optimistic state so a second click keeps the first.
  const [params, setShown] = useOptimistic(current);
  const go = (overrides: Partial<ProductListParams>) =>
    startTransition(() => {
      const next = { ...params, ...overrides, page: 1 };
      setShown(next);
      router.push(productListHref(basePath, next));
    });

  const toggle = <T extends string>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const supplierNames = Object.fromEntries(options.suppliers.map((row) => [row.id, row.name]));
  const makerNames = Object.fromEntries(options.makers.map((row) => [row.id, row.name]));
  const active = activeProductFilterCount(params);

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("q") as HTMLInputElement;
            go({ q: input.value.trim() });
          }}
          className="relative"
          role="search"
        >
          <IconSearch
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            key={params.q}
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder="Search name, SKU, maker…"
            aria-label="Search products"
            className="input input-sm w-60 pl-8"
          />
        </form>

        <MultiSelect
          label="Supplier"
          values={params.suppliers}
          choices={options.suppliers.map((row) => row.id)}
          labels={supplierNames}
          onToggle={(value) => go({ suppliers: toggle(params.suppliers, value) })}
          onClear={() => go({ suppliers: [] })}
          empty="No suppliers on your products yet."
          searchable
        />
        <MultiSelect
          label="Manufacturer"
          values={params.makers}
          choices={options.makers.map((row) => row.id)}
          labels={makerNames}
          onToggle={(value) => go({ makers: toggle(params.makers, value) })}
          onClear={() => go({ makers: [] })}
          empty="No manufacturers on your products yet."
          searchable
        />
        <MultiSelect
          label="Tag"
          values={params.tags}
          choices={[...LINE_ITEM_TAGS]}
          labels={TAG_LABELS}
          onToggle={(value) => go({ tags: toggle(params.tags, value as LineItemTagValue) })}
          onClear={() => go({ tags: [] })}
          empty="No tags."
        />
        <MultiSelect
          label="Service type"
          values={params.services}
          choices={options.services}
          onToggle={(value) => go({ services: toggle(params.services, value) })}
          onClear={() => go({ services: [] })}
          empty="No service types yet."
          searchable
        />
        <MultiSelect
          label="Status"
          values={params.statuses}
          choices={[...PRODUCT_STATUSES]}
          labels={PRODUCT_STATUS_LABELS}
          onToggle={(value) => go({ statuses: toggle(params.statuses, value as ProductStatusValue) })}
          onClear={() => go({ statuses: [] })}
          empty="No statuses."
        />

        <label className="ml-auto flex items-center gap-1.5 text-xs">
          <span className="faint">Per page</span>
          <select
            value={params.per}
            onChange={(event) => go({ per: Number(event.target.value) })}
            aria-label="Rows per page"
            className="select input-sm w-[4.75rem] py-1 pr-7"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(active > 0 || params.q) && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="active-filters">
          {params.q && <Chip onRemove={() => go({ q: "" })}>“{params.q}”</Chip>}
          {params.suppliers.map((id) => (
            <Chip key={`s-${id}`} onRemove={() => go({ suppliers: toggle(params.suppliers, id) })}>
              Supplier: {supplierNames[id] ?? "…"}
            </Chip>
          ))}
          {params.makers.map((id) => (
            <Chip key={`m-${id}`} onRemove={() => go({ makers: toggle(params.makers, id) })}>
              Manufacturer: {makerNames[id] ?? "…"}
            </Chip>
          ))}
          {params.tags.map((tag) => (
            <Chip key={`t-${tag}`} onRemove={() => go({ tags: toggle(params.tags, tag) })}>
              Tag: {TAG_LABELS[tag]}
            </Chip>
          ))}
          {params.services.map((service) => (
            <Chip key={`v-${service}`} onRemove={() => go({ services: toggle(params.services, service) })}>
              Service: {service}
            </Chip>
          ))}
          {params.statuses.map((status) => (
            <Chip key={`st-${status}`} onRemove={() => go({ statuses: toggle(params.statuses, status) })}>
              {PRODUCT_STATUS_LABELS[status]}
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => go({ q: "", suppliers: [], makers: [], tags: [], services: [], statuses: [] })}
            className="btn btn-ghost btn-sm"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
