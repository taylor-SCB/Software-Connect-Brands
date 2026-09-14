// Which way a contract's money goes, in the words the screens use.
// "in" = they pay us (Contract.payable false); "out" = we pay them
// (Contract.payable true). Shared by the tracker grid, the classic New
// contract page and the contract page so the wording can't drift.

export type Direction = "in" | "out";

export const DIRECTION_LABEL: Record<Direction, string> = {
  in: "Money in",
  out: "Money out",
};

// What a template's type implies: a Purchase Order is money going out to
// a supplier; everything else is the customer paying.
export function directionForType(type: string | null | undefined): Direction {
  return type === "Purchase Order" ? "out" : "in";
}
