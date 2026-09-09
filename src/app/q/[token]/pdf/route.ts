import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { renderPdf, baseUrlFromRequest, safeFilename } from "@/lib/pdf";

// Headless Chrome needs the Node runtime and more than the default budget.
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const quote = await prisma.quote.findUnique({
    where: { publicToken: token },
    select: {
      number: true,
      title: true,
      status: true,
      organizationId: true,
      contact: { select: { company: { select: { name: true } }, name: true } },
    },
  });

  if (!quote) {
    return new Response("Not found", { status: 404 });
  }

  // Same visibility rule as the page itself: drafts are owner-only.
  if (quote.status === "DRAFT") {
    const session = await auth();
    if (session?.user?.organizationId !== quote.organizationId) {
      return new Response("Not found", { status: 404 });
    }
  }

  try {
    const pdf = await renderPdf({
      url: `${baseUrlFromRequest(request)}/q/${token}`,
      cookieHeader: request.headers.get("cookie"),
    });

    const who = safeFilename(quote.contact.company?.name || quote.contact.name);
    const filename = `QUO-${quote.number}-${who || "quote"}.pdf`;

    return new Response(pdf as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[quote pdf]", error);
    return new Response("Could not generate the PDF. Try again in a moment.", {
      status: 500,
    });
  }
}
