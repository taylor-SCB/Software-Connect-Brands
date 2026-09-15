"use client";

import { useState, useTransition } from "react";
import { addDistributorCompany } from "../distributor-actions";

export type SupplierOption = {
  id: string;
  name: string;
  // False for a company still linked to a line but no longer carrying the
  // Distributor type (or past the picker's cap). Offered back anyway.
  stillADistributor: boolean;
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
export function SupplierCell({
  value,
  options,
  onChange,
  onOptionAdded,
  label,
  disabled = false,
}: {
  value: string | null;
  options: SupplierOption[];
  onChange: (companyId: string | null) => void;
  onOptionAdded: (option: SupplierOption) => void;
  label: string;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
        <div className="mt-1 flex gap-1">
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
        </div>
        {error && <p className="mt-1 text-[0.68rem] text-[var(--danger)]">{error}</p>}
      </div>
    );
  }

  return (
    <select
      value={value ?? ""}
      onChange={(event) => {
        if (event.target.value === NEW) {
          setAdding(true);
          return;
        }
        onChange(event.target.value || null);
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
        </option>
      ))}
      {!disabled && <option value={NEW}>+ Add new distributor…</option>}
    </select>
  );
}
