import { formatDate } from "@/lib/format";

// Merge fields available in contract templates. Values are substituted
// once, when a contract is created, so the signed document is a frozen
// snapshot rather than something that changes if a contact is edited.
export const MERGE_FIELDS = [
  { token: "{{company_name}}", description: "Your business name" },
  { token: "{{client_name}}", description: "Contact's full name" },
  { token: "{{client_company}}", description: "Contact's company" },
  { token: "{{client_email}}", description: "Contact's email" },
  { token: "{{client_phone}}", description: "Contact's phone" },
  { token: "{{contract_number}}", description: "Document number, e.g. CON-1004" },
  { token: "{{date}}", description: "Today's date" },
] as const;

export type MergeContext = {
  company_name: string;
  client_name: string;
  client_company: string;
  client_email: string;
  client_phone: string;
  contract_number: string;
  date: string;
};

export function buildMergeContext(input: {
  organizationName: string;
  contactName: string;
  contactCompany?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contractNumber: string;
}): MergeContext {
  return {
    company_name: input.organizationName,
    client_name: input.contactName,
    client_company: input.contactCompany || input.contactName,
    client_email: input.contactEmail || "—",
    client_phone: input.contactPhone || "—",
    contract_number: input.contractNumber,
    date: formatDate(new Date()),
  };
}

// Replaces {{token}} occurrences. Unknown tokens are left visible rather
// than blanked, so a typo in a template is obvious instead of silently
// producing an empty clause in a legal document.
export function renderMergeFields(body: string, context: MergeContext) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = context[key.toLowerCase() as keyof MergeContext];
    return value ?? match;
  });
}
