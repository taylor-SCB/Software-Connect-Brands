"use client";

import { useState } from "react";
import { IconPlus, IconX } from "@/components/icons";
import { GENERAL_COMPANY_TYPE, INDIVIDUAL_COMPANY_TYPE } from "@/lib/constants";
import { TAG_SEPARATOR } from "@/lib/tag-separator";

export type IndustryPickList = { name: string; types: string[] }[];

// Industry and Company Type on the company and contact forms. Both are
// multi-select chips. The Company Type chips on offer follow the industries
// ticked: Owner / Developer / Property Management under MDU, Integrator or
// Electrician under Service Provider, "General" where nothing more
// specific exists yet. "+ Add new…" grows either list for the workspace.
//
// Posted fields: `industries` (one per pick), `companyTypes` as
// "Industry<SEP>Type" (so a new type knows its industry), `keepTypes` for
// types the company already carries under no picked industry, and
// `industryFieldsPresent=1` only once the user has changed something, so
// an untouched form never rewrites a company's tags.
export function IndustryPicker({
  pickList,
  defaultIndustries = [],
  defaultTypes = [],
  disabled = false,
  disabledReason,
}: {
  pickList: IndustryPickList;
  defaultIndustries?: string[];
  defaultTypes?: string[];
  // A contact with no company: the type reads Individual / Personal and
  // there is nothing to pick.
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [lists, setLists] = useState<IndustryPickList>(pickList);
  const [industries, setIndustries] = useState<string[]>(defaultIndustries);
  const [types, setTypes] = useState<string[]>(defaultTypes);
  const [addingIndustry, setAddingIndustry] = useState(false);
  const [newIndustry, setNewIndustry] = useState("");
  const [addingTypeFor, setAddingTypeFor] = useState<string | null>(null);
  const [newType, setNewType] = useState("");
  const [dirty, setDirty] = useState(false);

  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const picked = lists.filter((industry) => industries.some((name) => same(name, industry.name)));

  function toggleIndustry(name: string) {
    setDirty(true);
    setIndustries((prev) => (prev.some((n) => same(n, name)) ? prev.filter((n) => !same(n, name)) : [...prev, name]));
  }
  function toggleType(name: string) {
    setDirty(true);
    setTypes((prev) => (prev.some((n) => same(n, name)) ? prev.filter((n) => !same(n, name)) : [...prev, name]));
  }
  function addIndustry() {
    const name = newIndustry.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!name) return;
    setDirty(true);
    const existing = lists.find((industry) => same(industry.name, name));
    if (!existing) setLists((prev) => [...prev, { name, types: [GENERAL_COMPANY_TYPE] }]);
    if (!industries.some((n) => same(n, name))) setIndustries((prev) => [...prev, existing?.name ?? name]);
    setNewIndustry("");
    setAddingIndustry(false);
  }
  function addType(industryName: string) {
    const name = newType.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!name) return;
    setDirty(true);
    setLists((prev) =>
      prev.map((industry) =>
        same(industry.name, industryName) && !industry.types.some((t) => same(t, name))
          ? { ...industry, types: [...industry.types, name] }
          : industry,
      ),
    );
    if (!types.some((n) => same(n, name))) setTypes((prev) => [...prev, name]);
    setNewType("");
    setAddingTypeFor(null);
  }

  if (disabled) {
    return (
      <div className="sm:col-span-2">
        <p className="label">Industry &amp; company type</p>
        <p className="text-sm">
          <span className="badge border-[var(--border-strong)]">{INDIVIDUAL_COMPANY_TYPE}</span>
          <span className="faint ml-2 text-xs">{disabledReason ?? "No company on this contact."}</span>
        </p>
      </div>
    );
  }

  // The types on offer: every type of every ticked industry, tagged with
  // its industry so the server can file a new one under the right list.
  const offered = picked.flatMap((industry) => industry.types.map((type) => ({ industry: industry.name, type })));
  // Types the company carries that sit under no ticked industry (a CSV
  // gave a type with no industry, or the industry was unticked). Shown
  // under "Other" so they are never silently dropped by a save.
  const orphans = types.filter((type) => !offered.some((o) => same(o.type, type)));

  return (
    <div className="space-y-4 sm:col-span-2">
      {dirty && <input type="hidden" name="industryFieldsPresent" value="1" />}
      {industries.map((name) => (
        <input key={name} type="hidden" name="industries" value={name} />
      ))}
      {offered
        .filter(({ type }) => types.some((n) => same(n, type)))
        .map(({ industry, type }) => (
          <input key={`${industry}${TAG_SEPARATOR}${type}`} type="hidden" name="companyTypes" value={`${industry}${TAG_SEPARATOR}${type}`} />
        ))}
      {orphans.map((type) => (
        <input key={`keep-${type}`} type="hidden" name="keepTypes" value={type} />
      ))}

      <div>
        <p className="label">
          Industry<span className="faint font-normal"> · pick any that apply</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Industry">
          {lists.map((industry) => {
            const on = industries.some((n) => same(n, industry.name));
            return (
              <Chip key={industry.name} on={on} onClick={() => toggleIndustry(industry.name)}>
                {industry.name}
              </Chip>
            );
          })}
          {addingIndustry ? (
            <span className="inline-flex items-center gap-1">
              <input
                value={newIndustry}
                onChange={(event) => setNewIndustry(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addIndustry();
                  }
                  if (event.key === "Escape") setAddingIndustry(false);
                }}
                placeholder="New industry"
                aria-label="New industry name"
                autoFocus
                maxLength={60}
                className="input input-sm w-40"
              />
              <button type="button" onClick={addIndustry} className="btn btn-primary btn-sm">
                Add
              </button>
              <button type="button" onClick={() => setAddingIndustry(false)} aria-label="Cancel" className="btn btn-ghost btn-sm">
                <IconX size={12} />
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setAddingIndustry(true)} className="btn btn-ghost btn-sm">
              <IconPlus size={12} />
              Add new industry
            </button>
          )}
        </div>
      </div>

      <div>
        <p className="label">
          Company type<span className="faint font-normal"> · pick any that apply</span>
        </p>
        {picked.length === 0 && orphans.length === 0 ? (
          <p className="faint text-xs">Pick an industry first and its company types appear here.</p>
        ) : (
          <div className="space-y-2">
            {orphans.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Other company types">
                <span className="faint w-full text-[0.68rem] sm:w-auto sm:min-w-[7rem]">Other</span>
                {orphans.map((type) => (
                  <Chip key={type} on onClick={() => toggleType(type)}>
                    {type}
                  </Chip>
                ))}
              </div>
            )}
            {picked.map((industry) => (
              <div key={industry.name} className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${industry.name} company types`}>
                {picked.length > 1 && <span className="faint w-full text-[0.68rem] sm:w-auto sm:min-w-[7rem]">{industry.name}</span>}
                {industry.types.map((type) => (
                  <Chip key={type} on={types.some((n) => same(n, type))} onClick={() => toggleType(type)}>
                    {type}
                  </Chip>
                ))}
                {addingTypeFor === industry.name ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      value={newType}
                      onChange={(event) => setNewType(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addType(industry.name);
                        }
                        if (event.key === "Escape") setAddingTypeFor(null);
                      }}
                      placeholder={`New ${industry.name} type`}
                      aria-label={`New company type under ${industry.name}`}
                      autoFocus
                      maxLength={60}
                      className="input input-sm w-44"
                    />
                    <button type="button" onClick={() => addType(industry.name)} className="btn btn-primary btn-sm">
                      Add
                    </button>
                    <button type="button" onClick={() => setAddingTypeFor(null)} aria-label="Cancel" className="btn btn-ghost btn-sm">
                      <IconX size={12} />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setNewType("");
                      setAddingTypeFor(industry.name);
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    <IconPlus size={12} />
                    Add new company type
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={`badge cursor-pointer border transition-colors ${
        on
          ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_22%,transparent)] text-[var(--text)]"
          : "border-[var(--border)] text-[var(--text-faint)] hover:border-[var(--border-strong)]"
      }`}
    >
      {children}
    </button>
  );
}
