import { prisma } from "@/lib/prisma";

// Reps on contacts and companies (Nov 10, 2026, Taylor): nobody is given
// one automatically — a new or imported record is Unassigned until a
// person picks one (on its page, its form, the import's "Assign everyone
// in this file to", or the lists' bulk Assign).

export { MAX_ASSIGN } from "@/lib/list-params";

export type RepChoice = { id: string; name: string; removed: boolean };

// Everyone with a login here, current teammates first. A removed teammate
// stays on the list, labelled, so a record they own still shows them and
// a picker never falls back to its first option (CLAUDE.md, the <select>
// lesson); they can't be newly picked.
export async function loadRepChoices(organizationId: string): Promise<RepChoice[]> {
  const users = await prisma.user.findMany({
    where: { organizationId },
    orderBy: [{ removedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: { id: true, name: true, removedAt: true },
  });
  return users.map((user) => ({ id: user.id, name: user.removedAt ? `${user.name} (removed)` : user.name, removed: Boolean(user.removedAt) }));
}

// A rep someone may be given now: a current teammate in this workspace.
// "" (or null) is Unassigned. Returns undefined when the id is not one.
export async function checkedRep(organizationId: string, raw: unknown): Promise<string | null | undefined> {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 60) return undefined;
  const user = await prisma.user.findFirst({ where: { id: raw, organizationId, removedAt: null }, select: { id: true } });
  return user ? user.id : undefined;
}

// The Rep box on a contact or company form. Only a change is written: the
// form posts the rep it was opened with as `ownerOriginal`, so a save that
// never touched the box (or a form React reset after an earlier save)
// leaves whoever owns it now alone. Returns {} when nothing changes,
// { ownerId } when it does, or an error.
export async function readRepField(
  organizationId: string,
  formData: FormData,
): Promise<{ ownerId?: string | null } | { error: string }> {
  if (!formData.has("ownerId")) return {};
  const value = String(formData.get("ownerId") ?? "");
  const original = String(formData.get("ownerOriginal") ?? "");
  if (formData.has("ownerOriginal") && value === original) return {};
  const ownerId = await checkedRep(organizationId, value);
  if (ownerId === undefined) return { error: "That rep is no longer on this account. Pick another." };
  return { ownerId };
}
