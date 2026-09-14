import { prisma } from "@/lib/prisma";
import { renderPdf, baseUrlFromRequest, safeFilename } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// The invoice as a PDF, rendered from the page the customer sees, so the
// two can never drift apart.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const row = await prisma.contractPayment.findUnique({
    where: { invoiceToken: token },
    select: {
      invoiceNumber: true,
      contract: {
        select: {
          contact: { select: { name: true, company: { select: { name: true } } } },
          company: { select: { name: true } },
          organization: { select: { status: true } },
        },
      },
    },
  });

  if (!row || row.invoiceNumber === null || row.contract.organization.status !== "ACTIVE") {
    return new Response("Not found", { status: 404 });
  }

  try {
    const pdf = await renderPdf({
      url: `${baseUrlFromRequest(request)}/i/${token}`,
      cookieHeader: request.headers.get("cookie"),
    });

    const who = safeFilename(
      row.contract.company?.name || row.contract.contact.company?.name || row.contract.contact.name,
    );
    const filename = `INV-${row.invoiceNumber}-${who || "invoice"}.pdf`;

    return new Response(pdf as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[invoice pdf]", error);
    return new Response("Could not generate the PDF. Try again in a moment.", { status: 500 });
  }
}
