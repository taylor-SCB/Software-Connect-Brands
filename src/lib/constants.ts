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

export const DEAL_STAGES = ["NEW", "CONTACTED", "WON", "LOST"] as const;
export type DealStageValue = (typeof DEAL_STAGES)[number];

export const DEAL_STAGE_LABELS: Record<DealStageValue, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  WON: "Won",
  LOST: "Lost",
};

export const QUOTE_TEMPLATES = ["SIMPLE", "MODERN"] as const;
export type QuoteTemplateValue = (typeof QUOTE_TEMPLATES)[number];

export const QUOTE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED"] as const;

export const CONTRACT_TYPES = ["SERVICE_AGREEMENT", "CHANGE_ORDER", "CUSTOM"] as const;
export type ContractTypeValue = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_TYPE_LABELS: Record<ContractTypeValue, string> = {
  SERVICE_AGREEMENT: "Service Agreement",
  CHANGE_ORDER: "Change Order",
  CUSTOM: "Custom",
};

export const CONTRACT_STATUSES = ["DRAFT", "SENT", "SIGNED", "DECLINED"] as const;
