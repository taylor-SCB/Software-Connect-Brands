import { requireSession } from "@/lib/session";

// A starter CSV for "Link Ratesheet → Import CSV": the headers the
// importer recognises, with one row from each unit list so the shape is
// obvious when it opens in a spreadsheet.
const TEMPLATE = [
  "Name,SKU,Description,Unit price,COGS,Manufacturer,Unit,Tag",
  '"Journeyman labor",LAB-JRN,"Licensed journeyman, business hours",125.00,80.00,,Per Hour,Labor',
  '"Copper pipe 3/4in",CU-34,,4.25,3.10,Mueller,Per LinearFt,Materials',
  '"Monitoring seat",SW-MON,,10.00,4.00,Acme Software,Per Device,Software',
  '"Permit handling",SVC-PERMIT,,150.00,0,,,Project Services',
  "",
].join("\r\n");

export async function GET() {
  await requireSession();
  return new Response(TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="products-template.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
