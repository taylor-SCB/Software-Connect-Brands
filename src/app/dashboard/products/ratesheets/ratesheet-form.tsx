"use client";

import { useActionState, useMemo, useState } from "react";
import { Field, FormError, FormSuccess, Card, CardHeader, TagBadge } from "@/components/ui";
import { IconSearch } from "@/components/icons";
import { formatCents } from "@/lib/format";
import {
  RATESHEET_VISIBILITIES,
  RATESHEET_VISIBILITY_LABELS,
  type RatesheetVisibilityValue,
  type LineItemTagValue,
} from "@/lib/constants";
import type { ActionState } from "@/lib/forms";

export type PickerProduct = {
  id: string;
  name: string;
  sku: string | null;
  unitPriceCents: number;
  defaultTag: string;
  active: boolean;
};

export type RatesheetFormDefaults = {
  id?: string;
  name?: string;
  visibility?: string;
  expiresOn?: string;
  respondWithinDays?: number | null;
  productIds?: string[];
};

const VISIBILITY_BLURBS: Record<RatesheetVisibilityValue, string> = {
  PUBLIC: "Anyone in the system can search it and link it until it expires.",
  INVITE_APPROVE: "Searchable, but linking it sends you a request to approve or decline.",
  PARTNER_SPECIFIC: "Sent to one email address, which approves or declines it.",
};

const VISIBILITY_NOTES: Partial<Record<RatesheetVisibilityValue, string>> = {
  PUBLIC: "Searching other workspaces' sheets isn't live yet — share the link from the sheet's page meanwhile.",
  INVITE_APPROVE: "Searching other workspaces' sheets isn't live yet — send links from the sheet's page meanwhile.",
  PARTNER_SPECIFIC: "Nothing is emailed yet: you get a link to copy and send yourself.",
};

export function RatesheetForm({
  action,
  products,
  defaults,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  products: PickerProduct[];
  defaults?: RatesheetFormDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const editing = !!defaults?.id;

  const [visibility, setVisibility] = useState<RatesheetVisibilityValue>(
    (defaults?.visibility as RatesheetVisibilityValue | undefined) ?? "PARTNER_SPECIFIC",
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaults?.productIds ?? []));

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        (product.sku ?? "").toLowerCase().includes(needle),
    );
  }, [products, query]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible(on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const product of filtered) {
        if (on) next.add(product.id);
        else next.delete(product.id);
      }
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-5">
      {defaults?.id && <input type="hidden" name="ratesheetId" value={defaults.id} />}
      <input type="hidden" name="visibility" value={visibility} />
      {/* Ticked products travel as repeated fields, whatever the search box
          is currently hiding. */}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="productIds" value={id} />
      ))}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card lit className="lg:col-span-3">
          <CardHeader title="Ratesheet details" />
          <div className="space-y-5 p-5">
            <Field
              label="Ratesheet name"
              name="name"
              placeholder="2026 contractor pricing"
              defaultValue={defaults?.name ?? ""}
              required
            />

            <div>
              <span className="label">Who can use it</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {RATESHEET_VISIBILITIES.map((option) => {
                  const on = visibility === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setVisibility(option)}
                      aria-pressed={on}
                      className="card card-hover p-3 text-left"
                      style={
                        on
                          ? {
                              borderColor: "color-mix(in srgb, var(--brand) 55%, transparent)",
                              background: "color-mix(in srgb, var(--brand) 10%, transparent)",
                            }
                          : undefined
                      }
                    >
                      <p className="text-sm font-semibold">{RATESHEET_VISIBILITY_LABELS[option]}</p>
                      <p className="faint mt-1 text-xs leading-relaxed">{VISIBILITY_BLURBS[option]}</p>
                    </button>
                  );
                })}
              </div>
              {VISIBILITY_NOTES[visibility] && (
                <p className="muted mt-2 text-xs">{VISIBILITY_NOTES[visibility]}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Expires On"
                name="expiresOn"
                type="date"
                defaultValue={defaults?.expiresOn ?? ""}
                hint="After this date nobody can select or answer it."
              />
              {visibility !== "PUBLIC" && (
                <Field
                  label="Approved/Decline Within"
                  name="respondWithinDays"
                  type="number"
                  placeholder="14"
                  defaultValue={defaults?.respondWithinDays ?? ""}
                  hint="Days a partner has to answer once sent. Leave blank for no limit."
                />
              )}
            </div>

            {visibility === "PARTNER_SPECIFIC" && !editing && (
              <div className="rounded-xl border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4">
                <p className="text-sm font-semibold">Send to</p>
                <p className="faint mt-0.5 mb-3 text-xs">
                  We don&apos;t email this yet — you&apos;ll get a link to copy and text or email yourself.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Partner email"
                    name="partnerEmail"
                    type="email"
                    placeholder="buyer@partner.com"
                    required
                  />
                  <Field
                    label="Partner / company name"
                    name="partnerName"
                    placeholder="Acme Supply"
                  />
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card lit className="lg:col-span-2">
          <CardHeader
            title="Products on this sheet"
            subtitle={`${selected.size} of ${products.length} selected · inactive products stay hidden from partners`}
          />
          <div className="space-y-3 p-4">
            <div className="relative">
              <IconSearch
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products…"
                aria-label="Search products"
                className="input input-sm pl-8"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => selectAllVisible(true)} className="btn btn-ghost btn-sm">
                Select all{query ? " shown" : ""}
              </button>
              <button type="button" onClick={() => selectAllVisible(false)} className="btn btn-ghost btn-sm">
                Clear{query ? " shown" : ""}
              </button>
            </div>

            {products.length === 0 ? (
              <p className="faint py-6 text-center text-xs">
                No products in your catalog yet. Add some first, then build the sheet.
              </p>
            ) : filtered.length === 0 ? (
              <p className="faint py-6 text-center text-xs">Nothing matches that search.</p>
            ) : (
              <ul className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
                {filtered.map((product) => {
                  const on = selected.has(product.id);
                  return (
                    <li key={product.id}>
                      <label
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2"
                        style={{
                          borderColor: on ? "color-mix(in srgb, var(--brand) 45%, transparent)" : "var(--border)",
                          background: on ? "color-mix(in srgb, var(--brand) 8%, transparent)" : "transparent",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(product.id)}
                          aria-label={`Include ${product.name}`}
                          className="h-4 w-4 shrink-0 accent-[var(--brand)]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {product.name}
                            {!product.active && <span className="faint ml-1.5 text-xs font-normal">(inactive)</span>}
                          </p>
                          <p className="faint num text-xs">{product.sku ?? "—"}</p>
                        </div>
                        <TagBadge tag={product.defaultTag as LineItemTagValue} />
                        <span className="num shrink-0 text-sm font-medium">
                          {formatCents(product.unitPriceCents)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
