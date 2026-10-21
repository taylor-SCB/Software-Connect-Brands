import { requireSession } from "@/lib/session";

// The example layout behind Import Ratesheet: what a supplier's sheet
// usually looks like. The price column is your cost, MSRP is theirs; the
// importer reads most other layouts too, this is just the plain one.
const TEMPLATE = [
  "Mfr Part #,Description,Your Cost,MSRP,Manufacturer,Unit,Tag",
  '"HID-5355AGN00","HID ProxPro card reader",112.50,189.99,HID,Each,Materials',
  '"CAT6-1000","Cat6 cable, 1000 ft box",189.00,265.00,Belden,Each,Materials',
  '"LIC-VMS-1","Video management license, 1 camera",85.00,120.00,Genetec,Per Device,Software',
  "",
].join("\r\n");

export async function GET() {
  await requireSession();
  return new Response(TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ratesheet-example.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
