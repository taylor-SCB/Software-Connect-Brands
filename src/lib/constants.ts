// Shared display metadata for the enums in schema.prisma. Keeping the
// labels here means the pipeline board, quote builder and contact list
// can't drift apart from each other.

export const LINE_ITEM_TAGS = [
  "LABOR",
  "MATERIALS",
  "SOFTWARE",
  "PROJECT_SERVICES",
  "SHIPPING",
  "TAXES",
] as const;

export type LineItemTagValue = (typeof LINE_ITEM_TAGS)[number];

export const TAG_LABELS: Record<LineItemTagValue, string> = {
  LABOR: "Labor",
  MATERIALS: "Materials",
  SOFTWARE: "Software",
  PROJECT_SERVICES: "Project Services",
  SHIPPING: "Shipping",
  TAXES: "Taxes",
};

// Each tag gets its own hue so the totals grid is scannable at a glance.
export const TAG_COLORS: Record<LineItemTagValue, string> = {
  LABOR: "#f59e0b",
  MATERIALS: "#38bdf8",
  SOFTWARE: "#a78bfa",
  PROJECT_SERVICES: "#34d399",
  SHIPPING: "#fb7185",
  TAXES: "#94a3b8",
};

export const ACTIVITY_TYPES = ["TEXT", "EMAIL", "PHONE_CALL", "MEETING"] as const;
export type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABELS: Record<ActivityTypeValue, string> = {
  TEXT: "Text",
  EMAIL: "Email",
  PHONE_CALL: "Phone Call",
  MEETING: "Meeting",
};

export const CONTACT_STATUSES = ["LEAD", "CUSTOMER", "ARCHIVED"] as const;
export type ContactStatusValue = (typeof CONTACT_STATUSES)[number];

// Pipeline stages, in the order a deal moves through them. Sending a
// quote or a contract advances a deal on its own; Won and Lost are the
// two ways out.
export const DEAL_STAGES = [
  "LEAD",
  "CONTACTED",
  "QUOTE_SENT",
  "CONTRACT_SENT",
  "WON",
  "LOST",
] as const;
export type DealStageValue = (typeof DEAL_STAGES)[number];

export const DEAL_STAGE_LABELS: Record<DealStageValue, string> = {
  LEAD: "Lead",
  CONTACTED: "Contacted",
  QUOTE_SENT: "Quote Sent",
  CONTRACT_SENT: "Contract Sent",
  WON: "Won",
  LOST: "Lost",
};

export const DEAL_STAGE_COLORS: Record<DealStageValue, string> = {
  LEAD: "#38bdf8",
  CONTACTED: "#fbbf24",
  QUOTE_SENT: "#a78bfa",
  CONTRACT_SENT: "#f97316",
  WON: "#34d399",
  LOST: "#fb7185",
};

// A deal still in play. Everything the dashboard calls "open pipeline".
export const OPEN_DEAL_STAGES = ["LEAD", "CONTACTED", "QUOTE_SENT", "CONTRACT_SENT"] as const;

// Labels a note can wear. Everything except General counts as personal
// and is gathered into the contact's relationship view.
export const NOTE_LABELS = ["GENERAL", "PERSONAL", "BIRTHDAY", "HOBBIES", "FAMILY"] as const;
export type NoteLabelValue = (typeof NOTE_LABELS)[number];

export const NOTE_LABEL_NAMES: Record<NoteLabelValue, string> = {
  GENERAL: "General",
  PERSONAL: "Personal",
  BIRTHDAY: "Birthday",
  HOBBIES: "Hobbies",
  FAMILY: "Family",
};

export const NOTE_LABEL_COLORS: Record<NoteLabelValue, string> = {
  GENERAL: "#94a3b8",
  PERSONAL: "#f472b6",
  BIRTHDAY: "#fbbf24",
  HOBBIES: "#34d399",
  FAMILY: "#a78bfa",
};

export const PERSONAL_NOTE_LABELS = ["PERSONAL", "BIRTHDAY", "HOBBIES", "FAMILY"] as const;

export function isPersonalLabel(label: string | null | undefined) {
  return (PERSONAL_NOTE_LABELS as readonly string[]).includes(label ?? "");
}

export const QUOTE_TEMPLATES = ["SIMPLE", "MODERN"] as const;
export type QuoteTemplateValue = (typeof QUOTE_TEMPLATES)[number];

export const QUOTE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED"] as const;

// The three types every new workspace starts with. Types are a per-workspace
// pick list (ContractTypeOption) that "+ Add new type" on the template form
// extends — a Commission Agreement or an mNDA is one click away, not a
// code change. A template stores the type's name, so "Custom" is a label,
// not an enum.
export const DEFAULT_CONTRACT_TYPES = [
  "Service Agreement",
  "Change Order",
  "Purchase Order",
  "Sales Order",
  "Invoice",
  "Compliance",
  "Custom",
] as const;

export const CONTRACT_STATUSES = ["DRAFT", "SENT", "SIGNED", "DECLINED", "CANCELLED"] as const;

// Unit of measurement on a product. Each list belongs to the tag it is
// named after: a Labor product picks from the Labor list, and so on.
// Project services, shipping and taxes have no unit at all. A Software
// unit is what reveals the rate/term box.
export const UNIT_GROUPS = {
  LABOR: [
    "PER_HOUR",
    "PER_DAY",
    "PER_PERSON_PER_HOUR",
    "PER_PERSON_PER_DAY",
    "PER_ROOM",
    "PER_BUILDING",
    "PER_PROPERTY",
  ],
  MATERIALS: [
    "EACH",
    "PER_PIECE",
    "PER_SQFT",
    "PER_LINEAR_FT",
    "PER_CUBIC_YARD",
    "PER_ITEM",
    "PER_GALLON",
    "PER_POUND",
  ],
  SOFTWARE: ["PER_UNIT", "PER_BED", "PER_LOCATION", "PER_DEVICE"],
} as const;

export type UnitGroup = keyof typeof UNIT_GROUPS;

export const UNITS_OF_MEASURE = [
  ...UNIT_GROUPS.LABOR,
  ...UNIT_GROUPS.MATERIALS,
  ...UNIT_GROUPS.SOFTWARE,
] as const;

export type UnitOfMeasureValue = (typeof UNITS_OF_MEASURE)[number];

export const UNIT_LABELS: Record<UnitOfMeasureValue, string> = {
  PER_HOUR: "Per Hour",
  PER_DAY: "Per Day",
  PER_PERSON_PER_HOUR: "Per Person Per Hour",
  PER_PERSON_PER_DAY: "Per Person Per Day",
  PER_ROOM: "Per Room",
  PER_BUILDING: "Per Building",
  PER_PROPERTY: "Per Property",
  EACH: "Each",
  PER_PIECE: "Per Piece",
  PER_SQFT: "Per SqFt",
  PER_LINEAR_FT: "Per LinearFt",
  PER_CUBIC_YARD: "Per Cubic Yard",
  PER_ITEM: "Per Item",
  PER_GALLON: "Per Gallon",
  PER_POUND: "Per Pound",
  PER_UNIT: "Per Unit",
  PER_BED: "Per Bed",
  PER_LOCATION: "Per Location",
  PER_DEVICE: "Per Device",
};

export function unitGroupFor(unit: string | null | undefined): UnitGroup | null {
  if (!unit) return null;
  for (const group of Object.keys(UNIT_GROUPS) as UnitGroup[]) {
    if ((UNIT_GROUPS[group] as readonly string[]).includes(unit)) return group;
  }
  return null;
}

export function isSoftwareUnit(unit: string | null | undefined) {
  return unitGroupFor(unit) === "SOFTWARE";
}

// Which unit list a product with a given default tag picks from. Project
// services, shipping and taxes carry no unit at all.
export function unitGroupsForTag(tag: string): UnitGroup[] {
  if (tag === "LABOR" || tag === "MATERIALS" || tag === "SOFTWARE") return [tag];
  return [];
}

export function tagHasUnits(tag: string) {
  return unitGroupsForTag(tag).length > 0;
}

export function unitAllowedForTag(unit: string | null | undefined, tag: string) {
  if (!unit) return true;
  const group = unitGroupFor(unit);
  return group !== null && unitGroupsForTag(tag).includes(group);
}

export const UNIT_GROUP_LABELS: Record<UnitGroup, string> = {
  LABOR: "Labor",
  MATERIALS: "Materials",
  SOFTWARE: "Software",
};

// Software is priced per unit *per period*. The rate is the period; the
// term is how many of them, so the product page can show the full total.
export const SOFTWARE_RATES = ["PER_MONTH", "PER_YEAR", "PER_TERM"] as const;
export type SoftwareRateValue = (typeof SOFTWARE_RATES)[number];

export const SOFTWARE_RATE_LABELS: Record<SoftwareRateValue, string> = {
  PER_MONTH: "Per Month",
  PER_YEAR: "Per Year",
  PER_TERM: "Per Term",
};

export const SOFTWARE_TERM_NOUNS: Record<SoftwareRateValue, string> = {
  PER_MONTH: "month",
  PER_YEAR: "year",
  PER_TERM: "term",
};

export const RATESHEET_VISIBILITIES = ["PUBLIC", "INVITE_APPROVE", "PARTNER_SPECIFIC"] as const;
export type RatesheetVisibilityValue = (typeof RATESHEET_VISIBILITIES)[number];

export const RATESHEET_VISIBILITY_LABELS: Record<RatesheetVisibilityValue, string> = {
  PUBLIC: "Public",
  INVITE_APPROVE: "Invite/Approve",
  PARTNER_SPECIFIC: "Partner Specific",
};

export const RATESHEET_INVITE_STATUSES = ["PENDING", "APPROVED", "DECLINED"] as const;
export type RatesheetInviteStatusValue = (typeof RATESHEET_INVITE_STATUSES)[number];

// What a compliance file is. W-9, certificate of insurance and licenses
// are what a general contractor asks a sub for before the first check.
export const COMPLIANCE_CATEGORIES = ["W-9", "COI", "License", "Other"] as const;
export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number];
