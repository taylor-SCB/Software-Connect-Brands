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

// The status ladder on contacts and companies (Sept 30, 2026), in the
// order a relationship moves through it. Not Actioned is where every new
// record starts; the first logged touch makes it Contacted; Not
// Interested and Interested are set by hand; Meeting Set onwards is the
// pipeline. Archived sits outside the ladder and hides the record from
// the pickers.
export const CONTACT_STATUSES = [
  "NOT_ACTIONED",
  "CONTACTED",
  "NOT_INTERESTED",
  "INTERESTED",
  "MEETING_SET",
  "MEETING_COMPLETED",
  "QUOTE_SENT",
  "CONTRACT_SENT",
  "WON",
  "LOST",
  "ARCHIVED",
] as const;
export type ContactStatusValue = (typeof CONTACT_STATUSES)[number];

export const CONTACT_STATUS_LABELS: Record<ContactStatusValue, string> = {
  NOT_ACTIONED: "Not Actioned",
  CONTACTED: "Contacted",
  NOT_INTERESTED: "Not Interested",
  INTERESTED: "Interested",
  MEETING_SET: "Meeting Set",
  MEETING_COMPLETED: "Meeting Completed",
  QUOTE_SENT: "Quote Sent",
  CONTRACT_SENT: "Contract Sent",
  WON: "Signed / Won",
  LOST: "Lost",
  ARCHIVED: "Archived",
};

// What a brand-new record can start at, typed in by hand.
export const START_STATUSES = ["NOT_ACTIONED", "CONTACTED", "NOT_INTERESTED", "INTERESTED"] as const;

// The pipeline part of the ladder, where each step has a date that Stats
// measures from. Skipping one by hand asks for the day it happened.
export const PIPELINE_STEPS = ["MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON"] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

// How far along a status is, for "only ever moves forward on its own".
// Not Interested sits level with Interested: both come after a touch and
// before a meeting. Lost and Archived rank below everything, so nothing
// automatic lifts a record out of them except a new meeting or paperwork.
export function statusRank(status: string): number {
  switch (status) {
    case "NOT_ACTIONED":
      return 0;
    case "CONTACTED":
      return 1;
    case "NOT_INTERESTED":
    case "INTERESTED":
      return 2;
    case "MEETING_SET":
      return 3;
    case "MEETING_COMPLETED":
      return 4;
    case "QUOTE_SENT":
      return 5;
    case "CONTRACT_SENT":
      return 6;
    case "WON":
      return 7;
    default:
      return -1;
  }
}

// The Personal / Work tag on a contact's emails and phone numbers.
export const CHANNEL_LABELS = ["WORK", "PERSONAL"] as const;
export type ChannelLabelValue = (typeof CHANNEL_LABELS)[number];
export const CHANNEL_LABEL_NAMES: Record<ChannelLabelValue, string> = { WORK: "Work", PERSONAL: "Personal" };

// Pipeline stages, in the order a deal moves through them. Sending a
// quote or a contract advances a deal on its own; Won and Lost are the
// two ways out.
export const DEAL_STAGES = ["LEAD", "CONTACTED", "QUOTE_SENT", "CONTRACT_SENT", "WON", "LOST", "ARCHIVED"] as const;
export type DealStageValue = (typeof DEAL_STAGES)[number];

// The Pipeline's columns, left to right (Sept 30, 2026). The first two
// are contacts at that status — a meeting is not a deal; deals are for
// quotes and contracts and join the board at Quote Sent. Lead and
// Contacted deals (a quote not sent yet) and Archived ones (a contract
// unanswered for 90 days) are not on the board.
export const PIPELINE_COLUMNS = ["MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON", "LOST"] as const;
export type PipelineColumn = (typeof PIPELINE_COLUMNS)[number];
export const CONTACT_COLUMNS = ["MEETING_SET", "MEETING_COMPLETED"] as const;
// The stages a deal can be moved to from its tile.
export const BOARD_DEAL_STAGES = ["QUOTE_SENT", "CONTRACT_SENT", "WON", "LOST"] as const;

export const PIPELINE_COLUMN_LABELS: Record<PipelineColumn, string> = {
  MEETING_SET: "Meeting Set",
  MEETING_COMPLETED: "Meeting Completed",
  QUOTE_SENT: "Quote Sent",
  CONTRACT_SENT: "Contract Sent",
  WON: "Signed / Won",
  LOST: "Lost",
};

export const PIPELINE_COLUMN_COLORS: Record<PipelineColumn, string> = {
  MEETING_SET: "#38bdf8",
  MEETING_COMPLETED: "#22d3ee",
  QUOTE_SENT: "#a78bfa",
  CONTRACT_SENT: "#f97316",
  WON: "#34d399",
  LOST: "#fb7185",
};

export const DEAL_STAGE_LABELS: Record<DealStageValue, string> = {
  LEAD: "Quote not sent",
  CONTACTED: "Quote not sent",
  QUOTE_SENT: "Quote Sent",
  CONTRACT_SENT: "Contract Sent",
  WON: "Won",
  LOST: "Lost",
  ARCHIVED: "Archived",
};

export const DEAL_STAGE_COLORS: Record<DealStageValue, string> = {
  LEAD: "#64748b",
  CONTACTED: "#64748b",
  QUOTE_SENT: "#a78bfa",
  CONTRACT_SENT: "#f97316",
  WON: "#34d399",
  LOST: "#fb7185",
  ARCHIVED: "#64748b",
};

// A deal still in play. Everything the dashboard calls "open pipeline".
export const OPEN_DEAL_STAGES = ["LEAD", "CONTACTED", "QUOTE_SENT", "CONTRACT_SENT"] as const;

// The 90 / 180-day rule on an unanswered contract (Taylor, Sept 30, 2026).
export const CONTRACT_ARCHIVE_DAYS = 90;
export const CONTRACT_LOST_DAYS = 180;

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

// How the same three rates are worded on a quote line, where the question
// is how the customer pays rather than how the catalog prices it. Separate
// from SOFTWARE_RATE_LABELS on purpose: that one is printed on the Products
// page and on partner ratesheets, so renaming it changes what partners see.
export const SOFTWARE_BILLING_LABELS: Record<SoftwareRateValue, string> = {
  PER_MONTH: "Monthly",
  PER_YEAR: "Yearly",
  PER_TERM: "Pay in Full",
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

// Industry and Company Type: the two pick lists a company (and its people)
// are tagged with. Seeded per workspace on first use and grown with "+ Add
// new…" on the company and contact forms; a workspace can rename or add
// anything, so these are starting points, not rules. "General" is the
// type every industry gets when it has nothing more specific yet.
export const GENERAL_COMPANY_TYPE = "General";
export const DEFAULT_INDUSTRIES: { name: string; types: string[] }[] = [
  { name: "MDU", types: ["Owner", "Capital Group", "Developer", "Property Management"] },
  { name: "Student", types: ["Owner", "Capital Group", "Developer", "Property Management"] },
  { name: "Commercial", types: [GENERAL_COMPANY_TYPE] },
  { name: "Construction", types: [GENERAL_COMPANY_TYPE] },
  { name: "Small Business", types: [GENERAL_COMPANY_TYPE] },
  {
    name: "Service Provider",
    types: ["Integrator", "Electrician", "Networks/ISP", "Access Control", "Door Hardware", "Gates", "Distributor"],
  },
];

// The kinds of work a new workspace can sell, in the order they appear on
// a form. The trades first, then the connected-device work Taylor's own
// market lives in. A workspace edits this list with "+ Add new service
// type"; nothing here is fixed.
export const SERVICE_TYPE_DEFAULTS = [
  "Painting",
  "Roofing",
  "Siding",
  "Gutters",
  "Windows & Doors",
  "Flooring",
  "Drywall",
  "Carpentry",
  "Plumbing",
  "Electrical",
  "HVAC",
  "Insulation",
  "Concrete",
  "Hardscapes",
  "Landscaping",
  "Lawn Care",
  "Snow Removal",
  "Fencing",
  "Garage Doors",
  "Cleaning",
  "Pest Control",
  "Locks & Hardware",
  "Smart Locks",
  "Access Control",
  "Intercoms",
  "Cameras",
  "Smart Thermostats",
  "Smart Leak Sensors",
  "Internet Infrastructure / ISP",
  "Software as a Service",
  "General",
] as const;

// How a project's stages read on screen. "Delayed" is Taylor's word for
// a job that is on hold.
export const PROJECT_STAGES = ["AWARDED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export type ProjectStageValue = (typeof PROJECT_STAGES)[number];
export const PROJECT_STAGE_LABELS: Record<ProjectStageValue, string> = {
  AWARDED: "Awarded",
  ACTIVE: "Active",
  ON_HOLD: "Delayed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
// The stages a job is still live in, which is what the list shows first.
export const OPEN_PROJECT_STAGES = ["AWARDED", "ACTIVE", "ON_HOLD"] as const;

// What a file on a job is for. "Signed contract" is the one that matters
// beyond record-keeping: when the other party's paper was the paper that
// got signed, this is where their copy lives.
export const PROJECT_FILE_CATEGORIES = [
  "Signed contract",
  "Photo",
  "Receipt",
  "Permit",
  "Plan or drawing",
  "Other",
] as const;

// A contact with no company at all — a homeowner wanting a window quote —
// reads as this company type on the list and in the filter. It is not a
// pick-list row: it means "no company", so it can't be picked on a form.
export const INDIVIDUAL_COMPANY_TYPE = "Individual / Personal";

// The three list pages' page sizes; 50 is the one you get without asking.
export const PAGE_SIZES = [10, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

// The event types a workspace starts with. Install and Site walk are the
// two a service business books every week; the rest cover the meetings
// and deliveries around them. A workspace adds its own with
// "+ Add new event type", and none of these is special to the code.
// Activities the calendar records alongside days of work (Sept 27, 2026,
// Calendar v2). The first four are what a logged call, email, text or
// meeting lands as; the paperwork ones are written by the app when a
// quote or contract goes out, comes due or is answered. A workspace can
// still add its own with "+ Add new activity" on the form.
export const ACTIVITY_EVENT_TYPES = [
  "Call",
  "Meeting",
  "Email",
  "Text",
  "Quote sent",
  "Quote due",
  "Quote follow up",
  "Contract sent",
  "Contract follow up",
  "Contract closed",
] as const;

// The event type each logged touchpoint becomes.
export const ACTIVITY_EVENT_TYPE: Record<ActivityTypeValue, (typeof ACTIVITY_EVENT_TYPES)[number]> = {
  PHONE_CALL: "Call",
  MEETING: "Meeting",
  EMAIL: "Email",
  TEXT: "Text",
};

// How long after a quote or contract goes out its follow-up is put on the
// calendar. One number for the whole app for now; a per-workspace
// setting is the next step if anyone wants a different rhythm.
export const FOLLOW_UP_DAYS = 3;

export const EVENT_TYPE_DEFAULTS = [
  "Install",
  "Site walk",
  "Project meeting",
  "Service call",
  "Delivery",
  "Inspection",
  "Punch list",
  ...ACTIVITY_EVENT_TYPES,
  "Other",
] as const;

// The type that gets created when a scope's install days are scheduled
// from a job, and the one the calendar colours as work on site.
export const INSTALL_EVENT_TYPE = "Install";
