import type { PhotoTagOption } from "@/lib/photo-tags";

// What a stored photo tag suggestion (Release C, C1) still offers, read
// against today's lists and the photo's own tags: a tag deleted since, or
// already on the photo, isn't offered.
export type TagSuggestionView = {
  type: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  newLabel: { kind: "TYPE" | "LOCATION"; name: string } | null;
  failed: boolean;
};

// What a stored suggestion still offers, read against today's lists and
// the photo's own tags (a tag deleted or already on the photo isn't
// offered).
export function viewSuggestion(
  row: { typeTagId: string | null; locationTagId: string | null; newKind: "TYPE" | "LOCATION" | null; newName: string | null; failed: boolean },
  tags: PhotoTagOption[],
  has: string[],
): TagSuggestionView {
  const find = (id: string | null, kind: "TYPE" | "LOCATION") => {
    const tag = id ? tags.find((each) => each.id === id && each.kind === kind) : null;
    return tag && !has.includes(tag.id) ? { id: tag.id, name: tag.name } : null;
  };
  const taken = row.newName ? tags.some((tag) => tag.kind === row.newKind && tag.name.toLowerCase() === row.newName!.toLowerCase()) : true;
  return {
    type: find(row.typeTagId, "TYPE"),
    location: find(row.locationTagId, "LOCATION"),
    newLabel: row.newKind && row.newName && !taken ? { kind: row.newKind, name: row.newName } : null,
    failed: row.failed,
  };
}

