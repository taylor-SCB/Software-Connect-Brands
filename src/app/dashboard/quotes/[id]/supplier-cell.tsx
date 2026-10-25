"use client";

import { useState, useTransition } from "react";
import {
  LINKED_SUPPLIER_SUFFIX,
  PLATFORM_SECTION_LABEL,
  PLATFORM_SUPPLIER_PREFIX,
  platformSupplierLabel,
  platformSupplierNamed,
  type PlatformSupplier,
} from "@/lib/account-types";
import { addDistributorCompany, addPlatformSupplier } from "../distributor-actions";

export type SupplierOption = {
  id: string;
  name: string;
  // False for a company still linked to a line but no longer carrying the
  // Distributor type (or past the picker's cap). Offered back anyway.
  stillADistributor: boolean;
  // Its supplier record is linked to an account on Software Connect Brands.
  onPlatform?: boolean;
};

const NEW = "__new__";

// The Supplier / Contractor picker on a quote line. Internal to the
// workspace: nothing here reaches the customer's copy of the quote.
//
// The linked company is always among the options even when it no longer
// belongs in the list, because a <select> whose value isn't one of its
// options silently displays the first option and the next save writes
// that — which is how unrelated edits have silently re-pointed records
// before.
//
// An account picked from "On Software Connect Brands" is asked about
// first — "Link ADI Global?" — because arrow keys move a closed <select>
// through its options one change at a time, and linking writes a supplier
// and a company. Linked, it is the workspace's own supplier
// (addPlatformSupplier) and the line holds its Company id like any other.
export function SupplierCell({
  value,
  options,
  platformSuppliers = [],
  onChange,
  onOptionAdded,
  onPlatformLinked,
  label,
  disabled = false,
}: {
  value: string | null;
  options: SupplierOption[];
  // Accounts on Software Connect Brands this workspace hasn't linked yet.
  platformSuppliers?: PlatformSupplier[];
  onChange: (companyId: string | null) => void;
  onOptionAdded: (option: SupplierOption) => void;
  onPlatformLinked?: (platformOrganizationId: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<PlatformSupplier | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const typedPlatform =
    adding && !options.some((option) => option.name.trim().toLowerCase() === name.trim().toLowerCase())
      ? platformSupplierNamed(name, platformSuppliers)
      : null;

  function add() {
    const typed = name.trim();
    if (!typed) {
      setError("Type the supplier's name");
      return;
    }
    startTransition(async () => {
      const result = await addDistributorCompany(typed);
      if (result.error || !result.company) {
        setError(result.error ?? "Couldn't add that supplier");
        return;
      }
      onOptionAdded({ ...result.company, stillADistributor: true });
      onChange(result.company.id);
      setAdding(false);
      setName("");
      setError(null);
    });
  }

  function linkPlatform(platformOrganizationId: string) {
    setError(null);
    startTransition(async () => {
      const result = await addPlatformSupplier(platformOrganizationId);
      if (result.error || !result.company) {
        setError(result.error ?? "Couldn't link that supplier");
        return;
      }
      onOptionAdded({ ...result.company, stillADistributor: true, onPlatform: true });
      onPlatformLinked?.(platformOrganizationId);
      onChange(result.company.id);
      setAdding(false);
      setConfirming(null);
      setName("");
    });
  }

  if (confirming) {
    return (
      <div data-testid="line-supplier-confirm">
        <p className="text-[0.72rem]">
          Link <strong>{confirming.name}</strong> as a supplier?
        </p>
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            onClick={() => linkPlatform(confirming.id)}
            disabled={pending}
            className="btn btn-primary btn-sm !px-2 !text-[0.7rem]"
          >
            {pending ? "Linking…" : "Link"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(null);
              setError(null);
            }}
            className="btn btn-ghost btn-sm !px-2 !text-[0.7rem]"
          >
            Cancel
          </button>
        </div>
        {error && <p className="mt-1 text-[0.68rem] text-[var(--danger)]">{error}</p>}
      </div>
    );
  }

  if (adding) {
    return (
      <div>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Supplier name"
          aria-label={`${label} new name`}
          autoFocus
          className="input input-sm"
        />
        <div className="mt-1 flex flex-wrap gap-1">
          <button type="button" onClick={add} disabled={pending} className="btn btn-primary btn-sm !px-2 !text-[0.7rem]">
            {pending ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setName("");
              setError(null);
            }}
            className="btn btn-ghost btn-sm !px-2 !text-[0.7rem]"
          >
            Cancel
          </button>
          {typedPlatform && (
            <button
              type="button"
              onClick={() => linkPlatform(typedPlatform.id)}
              disabled={pending}
              className="btn btn-ghost btn-sm !px-2 !text-[0.7rem]"
            >
              Use {typedPlatform.name} (on Software Connect Brands)
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-[0.68rem] text-[var(--danger)]">{error}</p>}
      </div>
    );
  }

  return (
    <select
      value={value ?? ""}
      onChange={(event) => {
        const next = event.target.value;
        if (next === NEW) {
          setAdding(true);
          return;
        }
        if (next.startsWith(PLATFORM_SUPPLIER_PREFIX)) {
          const id = next.slice(PLATFORM_SUPPLIER_PREFIX.length);
          setConfirming(platformSuppliers.find((supplier) => supplier.id === id) ?? null);
          return;
        }
        onChange(next || null);
      }}
      aria-label={label}
      disabled={disabled}
      className="select input-sm"
      data-testid="line-supplier"
    >
      <option value="">— None —</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.stillADistributor ? option.name : `${option.name} — no longer a distributor`}
          {option.onPlatform ? LINKED_SUPPLIER_SUFFIX : ""}
        </option>
      ))}
      {!disabled && platformSuppliers.length > 0 && (
        <optgroup label={PLATFORM_SECTION_LABEL}>
          {platformSuppliers.map((supplier) => (
            <option key={supplier.id} value={`${PLATFORM_SUPPLIER_PREFIX}${supplier.id}`}>
              {platformSupplierLabel(supplier)}
            </option>
          ))}
        </optgroup>
      )}
      {!disabled && <option value={NEW}>+ Add new distributor…</option>}
    </select>
  );
}
