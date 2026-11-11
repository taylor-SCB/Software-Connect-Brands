// The extra columns a person can bring back on the Contacts and Companies
// lists (BDR redesign, Nov 11, 2026). Browser-safe: the Columns menu and
// the server's reading of User.uiPrefs share it.
export type ListKind = "contacts" | "companies";

// "activity" (the four count chips) and "lastContacted" (Last Contacted
// By) came back in round 2, Nov 11, 2026, as the plan's hiddenNotRemoved
// says: folded into Pulse by default, one tick away here.
export const CONTACT_COLUMNS = ["activity", "lastContacted", "email", "phone2", "location", "industry", "notes", "marketing", "added", "addedBy", "status"] as const;
export const COMPANY_COLUMNS = ["phone", "website", "industry", "people", "marketing", "pipeline", "status", "added"] as const;

export const COLUMN_LABELS: Record<string, string> = {
  activity: "Activity",
  lastContacted: "Last Contacted By",
  email: "Email",
  phone2: "Phone 2",
  location: "Location",
  industry: "Industry · Type",
  notes: "Notes",
  marketing: "Marketing",
  added: "Added",
  addedBy: "Added by",
  status: "Status",
  phone: "Phone",
  website: "Website",
  people: "People",
  pipeline: "Open pipeline",
};

// Nothing extra until a person picks.
export const DEFAULT_COLUMNS: Record<ListKind, readonly string[]> = { contacts: [], companies: [] };

export function columnsFor(kind: ListKind): readonly string[] {
  return kind === "contacts" ? CONTACT_COLUMNS : COMPANY_COLUMNS;
}
