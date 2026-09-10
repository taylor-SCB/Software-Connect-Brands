// Small shared rules for the contracts module that both server actions and
// client components need. Kept out of actions.ts because a "use server"
// file may only export async functions.

// The value the Type dropdown sends when "+ Add new type" is picked; the
// typed name then arrives in `newType`.
export const NEW_TYPE_VALUE = "__new__";

// Whether this user may send a contract made from this template. Everyone
// may unless the template names its senders; a contract whose template
// was deleted has no restriction left to apply.
export function canUserSend(
  template: { allUsersCanSend: boolean; senderUserIds: string[] } | null | undefined,
  userId: string,
) {
  if (!template || template.allUsersCanSend) return true;
  return template.senderUserIds.includes(userId);
}

// "123 Main St, Suite 4, Austin, TX 78701" from the pieces on Company
// Information, skipping whatever is blank. Null when nothing is filled in
// so a merge field shows as missing rather than as an empty line.
export function formatAddress(input: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): string | null {
  const cityState = [input.city, input.state].filter(Boolean).join(", ");
  const locality = [cityState, input.postalCode].filter(Boolean).join(" ");
  const parts = [input.addressLine1, input.addressLine2, locality].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// What a contract is worth: the sum of its own rows. A contract made the
// classic way (whole template, no split) has no rows and no total of its
// own — its numbers come from the quote.
export function contractTotalCents(
  lineItems: { quantity: number; unitPriceCents: number }[],
): number {
  return lineItems.reduce(
    (sum, item) => sum + Math.round(item.quantity * item.unitPriceCents),
    0,
  );
}

// Statuses under which a contract still "holds" its rows on the deal
// tracker. A cancelled or declined one lets them go back to open.
export function contractHoldsRows(status: string) {
  return status === "DRAFT" || status === "SENT" || status === "SIGNED";
}

// How many contracts the tracker can build in one go.
export const MAX_TRACKER_COLUMNS = 5;
