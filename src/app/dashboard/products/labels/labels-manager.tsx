"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, FormError } from "@/components/ui";
import { IconEdit, IconPlus } from "@/components/icons";
import { UNIT_GROUPS, UNIT_LABELS, type UnitOfMeasureValue } from "@/lib/constants";
import { containsText } from "@/lib/variation-shared";
import type { GroupView, OptionView } from "@/lib/variations";
import {
  addGroup,
  addLabel,
  addUnit,
  moveGroup,
  moveOption,
  renameGroup,
  renameOption,
  setGroupRetired,
  setOptionRetired,
  setUnitContains,
} from "./actions";

type Result = { ok: true } | { error: string };

const unitLabel = (value: string | null) => (value ? (UNIT_LABELS[value as UnitOfMeasureValue] ?? value) : "");

export function LabelsManager({
  groups,
  counts,
  canManage,
}: {
  groups: GroupView[];
  counts: Record<string, number>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  // Which box is open: "rename:<id>", "add:<groupId>", "contains:<id>", "group".
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [contains, setContains] = useState("");
  const [base, setBase] = useState("");
  const [tag, setTag] = useState<"MATERIALS" | "LABOR">("MATERIALS");

  function run(action: () => Promise<Result>, after?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function openBox(key: string, initial = "") {
    setOpen(key);
    setText(initial);
    setError(undefined);
  }

  const close = () => setOpen(null);

  const box = (key: string, onSave: () => void, label: string, placeholder: string) => (
    <span className="flex flex-wrap items-center gap-1" data-testid="labels-box">
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSave();
          }
          if (event.key === "Escape") close();
        }}
        aria-label={label}
        placeholder={placeholder}
        maxLength={40}
        autoFocus
        className="input input-sm w-44"
      />
      <button type="button" onClick={onSave} disabled={pending} className="btn btn-primary btn-sm" data-testid="labels-box-save">
        Save
      </button>
      <button type="button" onClick={close} className="btn btn-ghost btn-sm">
        Cancel
      </button>
    </span>
  );

  const used = (id: string) => {
    const n = counts[id] ?? 0;
    return n ? `on ${n} ${n === 1 ? "product" : "products"}` : "not on a product yet";
  };

  function optionRow(group: GroupView, option: OptionView, index: number, live: OptionView[]) {
    const custom = !option.builtInUnit;
    const containsLine =
      group.kind === "UNIT" && custom ? containsText(option.contains, unitLabel(option.baseUnit)) : null;
    const movable = canManage && custom && !option.archived;
    const siblings = live.filter((item) => !item.builtInUnit);
    const place = siblings.findIndex((item) => item.id === option.id);
    return (
      <li
        key={option.id}
        className="flex flex-wrap items-center justify-between gap-2 py-2"
        data-testid="labels-option"
        data-name={option.name}
      >
        <div className="min-w-0">
          {open === `rename:${option.id}` ? (
            box(`rename:${option.id}`, () => run(() => renameOption(option.id, text), close), `Rename ${option.name}`, option.name)
          ) : (
            <p className="text-sm">
              <span className="font-medium">{option.name}</span>
              {group.kind === "UNIT" && option.tag && (
                <span className="faint text-xs"> · {option.tag === "LABOR" ? "Labor" : option.tag === "MATERIALS" ? "Materials" : "Software"}</span>
              )}
              {containsLine && <span className="faint text-xs"> · {containsLine}</span>}
            </p>
          )}
          {open === `contains:${option.id}` && (
            <span className="mt-1 flex flex-wrap items-center gap-1 text-xs">
              Contains
              <input
                value={contains}
                onChange={(event) => setContains(event.target.value)}
                inputMode="decimal"
                aria-label={`What ${option.name} contains`}
                className="input input-sm num w-16"
              />
              <select value={base} onChange={(event) => setBase(event.target.value)} aria-label="Of which unit" className="select input-sm w-auto">
                {(UNIT_GROUPS[(option.tag === "LABOR" ? "LABOR" : "MATERIALS") as "LABOR" | "MATERIALS"] as readonly string[]).map((value) => (
                  <option key={value} value={value}>
                    {unitLabel(value)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => run(() => setUnitContains(option.id, contains, base), close)}
                className="btn btn-primary btn-sm"
              >
                Save
              </button>
              <button type="button" onClick={close} className="btn btn-ghost btn-sm">
                Cancel
              </button>
            </span>
          )}
          <p className="faint text-[0.7rem]">{used(option.id)}</p>
        </div>
        {canManage && open !== `rename:${option.id}` && (
          <div className="flex flex-wrap items-center gap-1">
            {option.archived ? (
              <button
                type="button"
                onClick={() => run(() => setOptionRetired(option.id, false))}
                className="btn btn-ghost btn-sm"
                data-testid="labels-restore"
              >
                Restore
              </button>
            ) : (
              <>
                {movable && place > 0 && (
                  <button type="button" onClick={() => run(() => moveOption(option.id, "up"))} className="btn btn-ghost btn-sm" aria-label={`Move ${option.name} up`}>
                    ↑
                  </button>
                )}
                {movable && place >= 0 && place < siblings.length - 1 && (
                  <button type="button" onClick={() => run(() => moveOption(option.id, "down"))} className="btn btn-ghost btn-sm" aria-label={`Move ${option.name} down`}>
                    ↓
                  </button>
                )}
                {custom && group.kind === "UNIT" && (
                  <button
                    type="button"
                    onClick={() => {
                      openBox(`contains:${option.id}`);
                      setContains(option.contains ? String(option.contains) : "");
                      setBase(option.baseUnit ?? (option.tag === "LABOR" ? "PER_HOUR" : "EACH"));
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    Contains…
                  </button>
                )}
                {custom && (
                  <button
                    type="button"
                    onClick={() => openBox(`rename:${option.id}`, option.name)}
                    className="btn btn-ghost btn-sm"
                    data-testid="labels-rename"
                  >
                    <IconEdit size={12} /> Rename
                  </button>
                )}
                {custom && (
                  <button
                    type="button"
                    onClick={() => run(() => setOptionRetired(option.id, true))}
                    className="btn btn-ghost btn-sm"
                    data-testid="labels-retire"
                  >
                    Retire
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </li>
    );
  }

  const customGroups = groups.filter((group) => group.kind === "CUSTOM" && !group.archived);

  return (
    <div className="space-y-5">
      {!canManage && (
        <p className="faint text-xs" data-testid="labels-member-note">
          You can add labels, groups and units. An Owner or Admin renames, retires or reorders them.
        </p>
      )}
      <FormError message={error} />
      {groups.map((group) => {
        const live = group.options.filter((option) => !option.archived);
        const retired = group.options.filter((option) => option.archived);
        const builtInUnits = live.filter((option) => option.builtInUnit);
        const ownUnits = live.filter((option) => !option.builtInUnit);
        const groupPlace = customGroups.findIndex((item) => item.id === group.id);
        return (
          <Card lit key={group.id}>
            <div data-testid="labels-group" data-group={group.name}>
              <CardHeader
                title={group.kind === "UNIT" ? "Units" : group.name}
                subtitle={
                  group.archived
                    ? "Retired: off every picker, kept on what already has it."
                    : group.kind === "UNIT"
                      ? "The built-in units, then your own. Your own work on Labor and Materials products."
                      : group.builtIn
                        ? "Built in."
                        : "One of your own groups."
                }
                actions={
                  canManage && group.kind === "CUSTOM" ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {group.archived ? (
                        <button type="button" onClick={() => run(() => setGroupRetired(group.id, false))} className="btn btn-ghost btn-sm">
                          Restore
                        </button>
                      ) : (
                        <>
                          {groupPlace > 0 && (
                            <button type="button" onClick={() => run(() => moveGroup(group.id, "up"))} className="btn btn-ghost btn-sm" aria-label={`Move ${group.name} up`}>
                              ↑
                            </button>
                          )}
                          {groupPlace >= 0 && groupPlace < customGroups.length - 1 && (
                            <button type="button" onClick={() => run(() => moveGroup(group.id, "down"))} className="btn btn-ghost btn-sm" aria-label={`Move ${group.name} down`}>
                              ↓
                            </button>
                          )}
                          {open === `group-rename:${group.id}` ? (
                            box(`group-rename:${group.id}`, () => run(() => renameGroup(group.id, text), close), `Rename ${group.name}`, group.name)
                          ) : (
                            <button type="button" onClick={() => openBox(`group-rename:${group.id}`, group.name)} className="btn btn-ghost btn-sm">
                              <IconEdit size={12} /> Rename
                            </button>
                          )}
                          <button type="button" onClick={() => run(() => setGroupRetired(group.id, true))} className="btn btn-ghost btn-sm">
                            Retire
                          </button>
                        </>
                      )}
                    </div>
                  ) : undefined
                }
              />
              <div className="px-5 pb-4">
                {group.kind === "UNIT" ? (
                  <>
                    <details className="mb-2">
                      <summary className="faint cursor-pointer py-2 text-xs">The {builtInUnits.length} built-in units</summary>
                      <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
                        {builtInUnits.map((option, index) => optionRow(group, option, index, live))}
                      </ul>
                    </details>
                    <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
                      {ownUnits.map((option, index) => optionRow(group, option, index, live))}
                    </ul>
                    {ownUnits.length === 0 && <p className="faint py-2 text-xs">None of your own yet, like Box of 12 or Case of 6.</p>}
                  </>
                ) : (
                  <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
                    {live.map((option, index) => optionRow(group, option, index, live))}
                    {live.length === 0 && <li className="faint py-2 text-xs">No labels yet.</li>}
                  </ul>
                )}
                {!group.archived && (
                  <div className="mt-2">
                    {group.kind === "UNIT" ? (
                      open === "unit" ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="labels-unit-box">
                          <input
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            placeholder="Box of 12"
                            aria-label="New unit name"
                            maxLength={40}
                            autoFocus
                            className="input input-sm w-36"
                          />
                          <select
                            value={tag}
                            onChange={(event) => {
                              setTag(event.target.value as "MATERIALS" | "LABOR");
                              setBase("");
                            }}
                            aria-label="Which list"
                            className="select input-sm w-auto"
                          >
                            <option value="MATERIALS">Materials</option>
                            <option value="LABOR">Labor</option>
                          </select>
                          contains
                          <input
                            value={contains}
                            onChange={(event) => setContains(event.target.value)}
                            inputMode="decimal"
                            placeholder="12"
                            aria-label="How many it contains"
                            className="input input-sm num w-16"
                          />
                          <select value={base} onChange={(event) => setBase(event.target.value)} aria-label="Of which unit" className="select input-sm w-auto">
                            <option value="">of…</option>
                            {(UNIT_GROUPS[tag] as readonly string[]).map((value) => (
                              <option key={value} value={value}>
                                {unitLabel(value)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => run(() => addUnit({ name: text, contains, baseUnit: base, tag }), close)}
                            disabled={pending}
                            className="btn btn-primary btn-sm"
                            data-testid="labels-unit-save"
                          >
                            Add
                          </button>
                          <button type="button" onClick={close} className="btn btn-ghost btn-sm">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            openBox("unit");
                            setContains("");
                            setBase("");
                          }}
                          className="btn btn-ghost btn-sm"
                          data-testid="labels-add-unit"
                        >
                          <IconPlus size={12} /> Add unit
                        </button>
                      )
                    ) : open === `add:${group.id}` ? (
                      box(`add:${group.id}`, () => run(() => addLabel(group.id, text), () => setText("")), `New ${group.name} label`, `New ${group.name.toLowerCase()}`)
                    ) : (
                      <button type="button" onClick={() => openBox(`add:${group.id}`)} className="btn btn-ghost btn-sm" data-testid="labels-add">
                        <IconPlus size={12} /> Add label
                      </button>
                    )}
                  </div>
                )}
                {retired.length > 0 && (
                  <div className="mt-3 border-t border-[rgb(255_255_255/0.06)] pt-2" data-testid="labels-retired">
                    <p className="eyebrow">Retired</p>
                    <ul className="divide-y divide-[rgb(255_255_255/0.045)] opacity-75">
                      {retired.map((option, index) => optionRow(group, option, index, live))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
      <div>
        {open === "group" ? (
          box("group", () => run(() => addGroup(text), close), "New group name", "Sleeve, Print location…")
        ) : (
          <button type="button" onClick={() => openBox("group")} className="btn btn-ghost btn-sm" data-testid="labels-add-group">
            <IconPlus size={12} /> Add a group
          </button>
        )}
      </div>
    </div>
  );
}
