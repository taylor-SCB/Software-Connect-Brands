import { requireSession } from "@/lib/session";
import { TEMPLATE_HEADERS } from "@/lib/contacts-csv";

// The starter CSV for "Import CSV" on Contacts and Companies: the exact
// field names the system uses, contact fields first, then the company's,
// one row per contact. Three sample rows show the shape; only Name (or
// Company Name) is required.
const TEMPLATE = [
  TEMPLATE_HEADERS.join(","),
  'Jane Sample,Owner,jane@samplehvac.com,555-201-1000,,Austin,TX,1984-03-09,Lead,Sample HVAC,555-201-1001,office@samplehvac.com,samplehvac.com,Austin,TX,Lead,Service Provider,Integrator',
  'Mike Example,,mike@example.com,555-201-2000,,,,,Customer,Example Plumbing,,,,,,,Small Business,General',
  "Sara Onlyname,,,,,,,,,,,,,,,,,",
  "",
].join("\r\n");

export async function GET() {
  await requireSession();
  return new Response(TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="contacts-and-companies-template.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
