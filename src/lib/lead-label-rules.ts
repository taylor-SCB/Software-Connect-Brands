// The Lead Label a tile with none would most likely get (Nov 10, 2026),
// worked out from what is already on file before any AI is asked. Pure,
// so the board, the panel and the suite read the same rules. Only ever a
// faint chip to accept: nothing is labelled on its own.

// Free mailbox domains: a person on one with no company is a homeowner far
// more often than a business.
export const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "comcast.net",
  "att.net",
  "verizon.net",
  "sbcglobal.net",
  "proton.me",
  "protonmail.com",
];

export type LabelRulePerson = {
  hasCompany: boolean;
  companyTypes: string[];
  emails: (string | null)[];
  // A WON deal on file under this person, other than this opportunity's own.
  hasWonDeal: boolean;
};

export type RuleSuggestion = { label: string; reason: string };

export function isPersonalEmail(email: string | null | undefined) {
  const domain = (email ?? "").trim().toLowerCase().split("@")[1];
  return Boolean(domain && PERSONAL_EMAIL_DOMAINS.includes(domain));
}

// In Taylor's order: a supplier first, then a homeowner, then a returning
// customer. Null when the rules have nothing to say.
export function ruleLeadLabel(people: LabelRulePerson[]): RuleSuggestion | null {
  if (people.length === 0) return null;
  const supplier = people.some((person) =>
    person.companyTypes.some((type) => ["distributor", "manufacturer"].includes(type.trim().toLowerCase())),
  );
  if (supplier) return { label: "Vendor", reason: "Their company is a Distributor or Manufacturer" };
  const homeowner =
    people.every((person) => !person.hasCompany) && people.some((person) => person.emails.some((email) => isPersonalEmail(email)));
  if (homeowner) return { label: "Residential", reason: "No company, and a personal email address" };
  if (people.some((person) => person.hasWonDeal)) return { label: "Client", reason: "Already won a deal with them" };
  return null;
}
