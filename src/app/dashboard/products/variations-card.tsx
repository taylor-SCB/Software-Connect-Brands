"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import { TAG_LABELS, UNIT_LABELS } from "@/lib/constants";
import { cleanLabel, containsText, type VariationKindValue } from "@/lib/variation-shared";
import type { ActionState } from "@/lib/forms";

export type CardOption = {
  id: string;
  name: string;
  retired: boolean;
  tag: string | null;
  builtInUnit: string | null;
  contains: number | null;
  baseUnit: string | null;
};

export type CardGroup = {
  id: string;
  kind: VariationKindValue;
  name: string;
  builtIn: boolean;
  retired: boolean;
  options: CardOption[];
};

type NewLabel = { key: string; groupId?: string; groupName?: string; name: string };

let keyCounter = 0;
const nextKey = () => `label-${(keyCounter += 1)}`;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The labels a product comes in (Release 3b): one row per group, a chip per
// label, ticked when the product has it. Only what changed on this card is
// posted, and only once it was touched, so saving the price can never take
// off a label another tab added or one retired since the page opened.
export function VariationsCard({
  groups,
  savedIds,
  tag,
  saveState,
}: {
  groups: CardGroup[];
  savedIds: string[];
  tag: string;
  saveState: ActionState;
}) {
  // What was clicked on this card, never the whole set: labels ticked
  // here (`on`) and saved ones unticked here (`off`). A label another tab
  // adds or takes off, brought in by a refresh, is left as it now is.
  const [on, setOn] = useState<Set<string>>(() => new Set());
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [newLabels, setNewLabels] = useState<NewLabel[]>([]);
  const [newGroups, setNewGroups] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  // After a save the card is what was stored.
  const [seenState, setSeenState] = useState(saveState);
  if (saveState !== seenState) {
    setSeenState(saveState);
    if (saveState?.success) {
      setOn(new Set());
      setOff(new Set());
      setNewLabels([]);
      setNewGroups([]);
      setAdding(null);
      setDraft("");
      setProblem(null);
    }
  }

  const saved = new Set(savedIds);
  const isTicked = (id: string) => (saved.has(id) && !off.has(id)) || on.has(id);
  const ticked = { has: isTicked };
  const touched = on.size > 0 || off.size > 0 || newLabels.length > 0 || newGroups.length > 0;

  // A unit belongs to its tag's list: units ticked from another list are
  // taken off when the product is saved (the server does it), and said so
  // here. Nothing is unticked on the card, so changing the tag back loses
  // nothing.
  const unitGroup = groups.find((group) => group.kind === "UNIT");
  const otherListUnits = (unitGroup?.options ?? []).filter((option) => isTicked(option.id) && option.tag !== tag);
  const unitNote = otherListUnits.length
    ? `${otherListUnits.map((option) => option.name).join(", ")} will be taken off when you save: units follow the Default tag.`
    : null;

  function toggle(id: string) {
    const nextOn = new Set(on);
    const nextOff = new Set(off);
    if (isTicked(id)) {
      if (nextOn.has(id)) nextOn.delete(id);
      else nextOff.add(id);
    } else if (nextOff.has(id)) nextOff.delete(id);
    else nextOn.add(id);
    setOn(nextOn);
    setOff(nextOff);
    setProblem(null);
  }

  function startAdding(key: string) {
    setAdding(key);
    setDraft("");
    setProblem(null);
  }

  // A label typed under a group: one already in the group is ticked
  // instead; a retired one is for an Owner or Admin to bring back.
  function addLabel(group: { id?: string; name: string; options: CardOption[] }) {
    const name = cleanLabel(draft);
    if (!name) return setProblem("Type a name for the label.");
    const existing = group.options.find((option) => same(option.name, name));
    if (existing) {
      if (existing.retired && !ticked.has(existing.id)) {
        return setProblem(`${existing.name} was retired. An Owner or Admin can bring it back on Labels & Units.`);
      }
      if (!ticked.has(existing.id)) toggle(existing.id);
    } else if (!newLabels.some((label) => same(label.name, name) && (label.groupId ?? label.groupName) === (group.id ?? group.name))) {
      setNewLabels([...newLabels, { key: nextKey(), ...(group.id ? { groupId: group.id } : { groupName: group.name }), name }]);
    }
    setDraft("");
    setProblem(null);
  }

  function addGroup() {
    const name = cleanLabel(draft);
    if (!name) return setProblem("Type a name for the group, like Sleeve or Print location.");
    const existing = groups.find((group) => same(group.name, name));
    if (existing) {
      if (existing.kind === "UNIT") return setProblem("Units have their own row.");
      if (existing.retired) return setProblem(`${existing.name} was retired. An Owner or Admin can bring it back on Labels & Units.`);
      setAdding(existing.id);
      setDraft("");
      return;
    }
    if (!newGroups.some((group) => same(group, name))) setNewGroups([...newGroups, name]);
    setAdding(`new:${name}`);
    setDraft("");
    setProblem(null);
  }

  const payload = JSON.stringify({
    added: [...on],
    removed: [...off],
    newLabels: newLabels.map(({ groupId, groupName, name }) => ({ groupId, groupName, name })),
    newGroups,
  });

  const unitList = unitGroup
    ? unitGroup.options.filter((option) => option.tag === tag && (!option.retired || ticked.has(option.id)))
    : [];
  // A retired group shows only while the product has one of its labels.
  const otherGroups = groups.filter(
    (group) => group.kind !== "UNIT" && (!group.retired || group.options.some((option) => ticked.has(option.id))),
  );

  const chip = (option: CardOption, groupName: string) => {
    const on = ticked.has(option.id);
    const contains = option.builtInUnit ? null : containsText(option.contains, option.baseUnit ? UNIT_LABELS[option.baseUnit as keyof typeof UNIT_LABELS] : null);
    return (
      <button
        key={option.id}
        type="button"
        onClick={() => toggle(option.id)}
        disabled={option.retired && !on}
        aria-pressed={on}
        data-testid="label-chip"
        data-group={groupName}
        title={contains ?? undefined}
        className={`rounded-full border px-2.5 py-1 text-xs transition ${
          on
            ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_18%,transparent)] font-medium"
            : "border-[var(--border)] opacity-80 hover:opacity-100"
        }`}
      >
        {on ? "✓ " : ""}
        {option.name}
        {option.retired && <span className="faint"> (retired)</span>}
      </button>
    );
  };

  const addBox = (key: string, onAdd: () => void, placeholder: string, label: string) => (
    <span className="flex items-center gap-1">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onAdd();
          }
          if (event.key === "Escape") setAdding(null);
        }}
        placeholder={placeholder}
        aria-label={label}
        maxLength={40}
        autoFocus
        data-testid="label-add-input"
        className="input input-sm w-36"
      />
      <button type="button" onClick={onAdd} className="btn btn-ghost btn-sm" data-testid="label-add-button">
        Add
      </button>
      <button type="button" onClick={() => setAdding(null)} className="btn btn-ghost btn-sm">
        Cancel
      </button>
    </span>
  );

  return (
    <Card lit>
      <CardHeader
        title="Variations"
        subtitle="The labels it comes in. A quote line picks one of each, and they print under the name."
      />
      {touched && <input type="hidden" name="variationsPresent" value="1" />}
      {touched && <input type="hidden" name="variations" value={payload} />}
      <div className="space-y-3 p-5" data-testid="product-variations">
        {unitGroup && unitList.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="variation-group" data-group={unitGroup.name}>
            <span className="label !mb-0 w-24 shrink-0">{unitGroup.name}s</span>
            {unitList.map((option) => chip(option, unitGroup.name))}
          </div>
        )}
        {unitNote && (
          <p className="text-xs text-[var(--warn)]" data-testid="unit-note">
            {unitNote}
          </p>
        )}
        {unitGroup && unitList.length === 0 && (
          <p className="faint text-xs">No units for {TAG_LABELS[tag as keyof typeof TAG_LABELS] ?? "this tag"}.</p>
        )}
        {otherGroups.map((group) => {
          const pending = newLabels.filter((label) => label.groupId === group.id);
          const visible = group.options.filter((option) => !option.retired || ticked.has(option.id));
          return (
            <div key={group.id} className="flex flex-wrap items-center gap-1.5" data-testid="variation-group" data-group={group.name}>
              <span className="label !mb-0 w-24 shrink-0">
                {group.name}
                {group.retired && <span className="faint font-normal"> (retired)</span>}
              </span>
              {visible.map((option) => chip(option, group.name))}
              {pending.map((label) => (
                <span key={label.key} className="rounded-full border border-[var(--brand)] px-2.5 py-1 text-xs font-medium" data-testid="label-chip-new">
                  ✓ {label.name} <span className="faint">(new)</span>
                  <button
                    type="button"
                    onClick={() => setNewLabels(newLabels.filter((item) => item.key !== label.key))}
                    aria-label={`Don't add ${label.name}`}
                    className="ml-1 opacity-70 hover:opacity-100"
                  >
                    ×
                  </button>
                </span>
              ))}
              {!group.retired &&
                (adding === group.id ? (
                  addBox(group.id, () => addLabel(group), `New ${group.name.toLowerCase()}`, `New ${group.name} label`)
                ) : (
                  <button type="button" onClick={() => startAdding(group.id)} className="btn btn-ghost btn-sm" data-testid="label-add">
                    <IconPlus size={12} /> Add
                  </button>
                ))}
            </div>
          );
        })}
        {newGroups.map((name) => {
          const pending = newLabels.filter((label) => label.groupName && same(label.groupName, name));
          return (
            <div key={name} className="flex flex-wrap items-center gap-1.5" data-testid="variation-group" data-group={name}>
              <span className="label !mb-0 w-24 shrink-0">
                {name} <span className="faint font-normal">(new)</span>
              </span>
              {pending.map((label) => (
                <span key={label.key} className="rounded-full border border-[var(--brand)] px-2.5 py-1 text-xs font-medium" data-testid="label-chip-new">
                  ✓ {label.name} <span className="faint">(new)</span>
                </span>
              ))}
              {adding === `new:${name}` ? (
                addBox(`new:${name}`, () => addLabel({ name, options: [] }), `New ${name.toLowerCase()}`, `New ${name} label`)
              ) : (
                <button type="button" onClick={() => startAdding(`new:${name}`)} className="btn btn-ghost btn-sm" data-testid="label-add">
                  <IconPlus size={12} /> Add
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setNewGroups(newGroups.filter((group) => group !== name));
                  setNewLabels(newLabels.filter((label) => !(label.groupName && same(label.groupName, name))));
                }}
                className="btn btn-ghost btn-sm"
              >
                Don&apos;t add
              </button>
            </div>
          );
        })}
        <div>
          {adding === "__group__" ? (
            addBox("__group__", addGroup, "Sleeve, Print location…", "New group name")
          ) : (
            <button type="button" onClick={() => startAdding("__group__")} className="btn btn-ghost btn-sm" data-testid="group-add">
              <IconPlus size={12} /> Add a group
            </button>
          )}
        </div>
        {problem && (
          <p role="alert" className="text-xs text-[var(--warn)]" data-testid="label-problem">
            {problem}
          </p>
        )}
        <p className="faint text-[0.7rem]">
          New labels join your list when you save. Rename or retire them on Labels &amp; Units.
        </p>
      </div>
    </Card>
  );
}
