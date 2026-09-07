import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { renderPdf, baseUrlFromRequest, safeFilename } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const contract = await prisma.contract.findUnique({
    where: { publicToken: token },
    select: {
      number: true,
      title: true,
      status: true,
      organizationId: true,
      contact: { select: { company: true, name: true } },
    },
  });

  if (!contract) {
    return new Response("Not found", { status: 404 });
  }

  if (contract.status === "DRAFT") {
    const session = await auth();
    if (session?.user?.organizationId !== contract.organizationId) {
      return new Response("Not found", { status: 404 });
    }
  }

  try {
    const pdf = await renderPdf({
      url: `${baseUrlFromRequest(request)}/c/${token}`,
      cookieHeader: request.headers.get("cookie"),
    });

    const who = safeFilename(contract.contact.company || contract.contact.name);
    const filename = `CON-${contract.number}-${who || "contract"}.pdf`;

    return new Response(pdf as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[contract pdf]", error);
    return new Response("Could not generate the PDF. Try again in a moment.", {
      status: 500,
    });
  }
}
