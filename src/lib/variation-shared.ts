// Release 3b: the parts of variation labels and custom units that both the
// browser and the server use. No database here, so client components can
// import it.

export const MAX_LABEL_LENGTH = 40;
export const MAX_OPTIONS_PER_GROUP = 300;
export const MAX_CUSTOM_GROUPS = 20;
export const MAX_PICKS_PER_LINE = 10;
export const MAX_UNIT_CONTAINS = 1_000_000;

export const BUILT_IN_GROUP_NAMES = { UNIT: "Unit", COLOR: "Color", SIZE: "Size" } as const;

export type VariationKindValue = "UNIT" | "COLOR" | "SIZE" | "CUSTOM";

// One label as a quote line keeps it: the group's and the option's names as
// they were when it was picked, so a rename never rewrites a sent quote.
export type VariationEntry = { groupId: string; group: string; optionId: string; label: string };

// A product's labels as the quote line's pickers need them.
export type LineGroup = {
  id: string;
  name: string;
  kind: VariationKindValue;
  options: { id: string; name: string }[];
};

export function cleanLabel(raw: string) {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, MAX_LABEL_LENGTH);
}

// The stored JSON, read defensively: anything that isn't a well-formed entry
// is skipped rather than trusted.
export function readSnapshot(json: unknown): VariationEntry[] {
  if (!Array.isArray(json)) return [];
  const out: VariationEntry[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.groupId === "string" &&
      typeof entry.group === "string" &&
      typeof entry.optionId === "string" &&
      typeof entry.label === "string"
    ) {
      out.push({ groupId: entry.groupId, group: entry.group, optionId: entry.optionId, label: entry.label });
    }
  }
  return out;
}

export function variationTextOf(entries: VariationEntry[]): string | null {
  const text = entries.map((entry) => entry.label).join(" · ");
  return text ? text : null;
}

export type PickableOption = {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  groupKind: VariationKindValue;
  groupOrder: number;
};

// A line's labels after a save. Entries the line already had are kept as
// written and where they were; a new pick in a group the line already had
// takes that group's place; picks in new groups go after, in the groups'
// current order. Units are never labels (the unit select is the one place
// a unit is picked), and a group gets one pick.
export function mergeSnapshot(
  saved: VariationEntry[],
  pickedIds: string[],
  options: Map<string, PickableOption>,
): VariationEntry[] {
  const picked = new Set(pickedIds);
  const fresh = new Map<string, PickableOption>();
  for (const id of pickedIds) {
    if (saved.some((entry) => entry.optionId === id)) continue;
    const option = options.get(id);
    if (!option || option.groupKind === "UNIT") continue;
    if (!fresh.has(option.groupId)) fresh.set(option.groupId, option);
  }

  const out: VariationEntry[] = [];
  const used = new Set<string>();
  for (const entry of saved) {
    if (used.has(entry.groupId)) continue;
    if (picked.has(entry.optionId)) {
      out.push(entry);
      used.add(entry.groupId);
      fresh.delete(entry.groupId);
      continue;
    }
    const replacement = fresh.get(entry.groupId);
    if (replacement) {
      out.push(entryOf(replacement));
      used.add(entry.groupId);
      fresh.delete(entry.groupId);
    }
  }
  const rest = [...fresh.values()]
    .filter((option) => !used.has(option.groupId))
    .sort((a, b) => a.groupOrder - b.groupOrder);
  for (const option of rest) out.push(entryOf(option));
  return out;
}

function entryOf(option: PickableOption): VariationEntry {
  return { groupId: option.groupId, group: option.groupName, optionId: option.id, label: option.name };
}

export function sameIdSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

// What a document prints as a line's unit. Built-in units have never been
// printed on what a customer gets, and still aren't; a workspace's own unit
// ("Box of 12") is, because it changes what the quantity means. An enum unit
// set beside it (code from before 3b) wins, so then nothing prints.
export function customUnitLabel(line: { unitOfMeasure?: string | null; unitLabel?: string | null }) {
  if (line.unitOfMeasure) return null;
  return line.unitLabel?.trim() ? line.unitLabel : null;
}

// "Box of 12 · contains 12 Each"
export function containsText(contains: number | null | undefined, baseLabel: string | null | undefined) {
  if (!contains || !baseLabel) return null;
  const n = Number.isInteger(contains) ? String(contains) : String(Math.round(contains * 1000) / 1000);
  return `contains ${n} ${baseLabel}`;
}

// The unit select's value for a workspace unit. Built-in units keep their
// enum value, so a form posted before the JavaScript loads still works.
export const CUSTOM_UNIT_PREFIX = "cu:";
export function customUnitValue(id: string) {
  return `${CUSTOM_UNIT_PREFIX}${id}`;
}
export function customUnitIdOf(value: string | null | undefined) {
  return value && value.startsWith(CUSTOM_UNIT_PREFIX) ? value.slice(CUSTOM_UNIT_PREFIX.length) : null;
}

// A picture as the quote line's editor needs it, main first.
export type LinePicture = { id: string; token: string; colorOptionId: string | null };

// A product's labels and pictures for a quote line's pickers.
export type LineProductLabels = { groups: LineGroup[]; pictures: LinePicture[] };

// The product's picture for a line with these labels: the one tagged with
// a Color it picked, else the main one.
export function pickLivePicture(pictures: LinePicture[] | undefined, optionIds: string[]) {
  if (!pictures?.length) return null;
  const picked = new Set(optionIds);
  return pictures.find((picture) => picture.colorOptionId && picked.has(picture.colorOptionId)) ?? pictures[0];
}
