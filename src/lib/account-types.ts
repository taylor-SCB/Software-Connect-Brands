// What kind of company an account is (Release 2, Oct 25, 2026). The
// display side of the AccountType enum in schema.prisma, safe for the
// browser: no Prisma import.
//
// The type turns no feature on or off — every account can do everything
// (Taylor, Oct 25, 2026). It is what lets other workspaces find a
// supplier: approved accounts of the three supplier types are listed in
// every supplier picker as "On Software Connect Brands", and a Business /
// Vendor never is (src/lib/platform-suppliers.ts).

export const ACCOUNT_TYPES = ["BUSINESS", "DISTRIBUTOR", "HARDWARE_OEM", "SOFTWARE_PROVIDER"] as const;
export type AccountTypeValue = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountTypeValue, string> = {
  BUSINESS: "Business / Vendor",
  DISTRIBUTOR: "Distributor",
  HARDWARE_OEM: "Hardware / OEM",
  SOFTWARE_PROVIDER: "Software Provider",
};

// One line under each choice at signup and on Settings → General.
export const ACCOUNT_TYPE_BLURBS: Record<AccountTypeValue, string> = {
  BUSINESS: "You sell to and do the work for your own customers.",
  DISTRIBUTOR: "You resell other companies' products to businesses.",
  HARDWARE_OEM: "You make the equipment businesses sell and install.",
  SOFTWARE_PROVIDER: "You make software that businesses resell or use.",
};

// The types other workspaces can pick as a supplier.
export const SUPPLIER_ACCOUNT_TYPES = ["DISTRIBUTOR", "HARDWARE_OEM", "SOFTWARE_PROVIDER"] as const satisfies readonly AccountTypeValue[];

export function isSupplierAccountType(type: AccountTypeValue): boolean {
  return (SUPPLIER_ACCOUNT_TYPES as readonly string[]).includes(type);
}

// Whether a linked supplier's account is still listed: approved and a
// supplier type. A link outlives a pause or a change of type, but the
// "· on Software Connect Brands" mark doesn't.
export function stillListed(account: { status: string; accountType: string } | null | undefined): boolean {
  return (
    Boolean(account) &&
    account!.status === "ACTIVE" &&
    (SUPPLIER_ACCOUNT_TYPES as readonly string[]).includes(account!.accountType)
  );
}

export function isAccountType(value: unknown): value is AccountTypeValue {
  return typeof value === "string" && (ACCOUNT_TYPES as readonly string[]).includes(value);
}

// The value a supplier picker posts for an account picked from "On
// Software Connect Brands": the prefix and the account's organization id.
// The server resolves it to the workspace's own supplier record
// (linkPlatformSupplier in src/lib/platform-suppliers.ts).
export const PLATFORM_SUPPLIER_PREFIX = "platform:";

export type PlatformSupplier = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  accountType: AccountTypeValue;
};

export const PLATFORM_SECTION_LABEL = "On Software Connect Brands";

// "ADI Global — Distributor · Omaha, NE"
export function platformSupplierLabel(supplier: PlatformSupplier): string {
  const place = [supplier.city, supplier.state].filter(Boolean).join(", ");
  return `${supplier.name} — ${ACCOUNT_TYPE_LABELS[supplier.accountType]}${place ? ` · ${place}` : ""}`;
}

// A workspace's own supplier that is linked to an account on the platform.
export const LINKED_SUPPLIER_SUFFIX = " · on Software Connect Brands";

// The one platform supplier a typed "+ Add new" name is, if exactly one
// carries that name; offered as "Use <name> (on Software Connect Brands)"
// rather than linked silently, because two businesses can share a name.
export function platformSupplierNamed(typed: string, suppliers: PlatformSupplier[]): PlatformSupplier | null {
  const wanted = typed.trim().replace(/\s+/g, " ").toLowerCase();
  if (!wanted) return null;
  const matches = suppliers.filter((supplier) => supplier.name.trim().replace(/\s+/g, " ").toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : null;
}

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

// The workspace's own supplier a platform account will be linked onto:
// one of the same name not yet linked to any account. Picking the account
// then means that supplier — its people, its remembered columns and
// pricing — the same way linkPlatformSupplier resolves it on the server.
export function platformTwin<T extends { name: string; linked?: boolean }>(
  platform: PlatformSupplier | null,
  suppliers: T[],
): T | null {
  if (!platform) return null;
  return suppliers.find((supplier) => !supplier.linked && sameName(supplier.name, platform.name)) ?? null;
}
