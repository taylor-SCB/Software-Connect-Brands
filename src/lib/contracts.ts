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
