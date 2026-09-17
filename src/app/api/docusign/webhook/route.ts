import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSignedDocument } from "@/lib/docusign";
import { revalidatePath } from "next/cache";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // HelloSign sends events with this structure:
    // { "event": { "event_type": "signature_request_signed", "data": { "signature_request": { "signature_request_id": "xxx" } } } }
    const event = body.event;
    if (!event || !event.event_type) {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const eventType = event.event_type;
    const signatureRequestId = event.data?.signature_request?.signature_request_id;

    if (!signatureRequestId) {
      return NextResponse.json({ error: "No signature request ID found" }, { status: 400 });
    }

    // Find the contract with this signature request ID (stored in docusignEnvelopeId field)
    const contract = await prisma.contract.findFirst({
      where: { docusignEnvelopeId: signatureRequestId },
      select: { id: true, organizationId: true, contact: { select: { email: true, name: true } } },
    });

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Get organization to fetch HelloSign API key
    const organization = await prisma.organization.findUnique({
      where: { id: contract.organizationId },
      select: { hellosignApiKey: true },
    });

    if (!organization?.hellosignApiKey) {
      return NextResponse.json({ error: "Organization not configured for HelloSign" }, { status: 400 });
    }

    // Update contract status based on HelloSign event type
    if (eventType === "signature_request_signed") {
      // Contract is signed
      try {
        const signedPdf = await getSignedDocument(signatureRequestId, organization.hellosignApiKey);

        // Convert to base64 for storage (or you could upload to cloud storage)
        const pdfBase64 = signedPdf.toString("base64");
        const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

        await prisma.contract.updateMany({
          where: { id: contract.id },
          data: {
            status: "SIGNED",
            signedAt: new Date(),
            docusignStatus: "completed",
            docusignSignedPdfUrl: pdfDataUrl,
            signerEmail: contract.contact.email,
            signerName: contract.contact.name,
          },
        });

        revalidatePath(`/dashboard/contracts/${contract.id}`);
        revalidatePath("/dashboard/contracts");
      } catch (error) {
        console.error("Failed to get signed document:", error);
        // Still mark as completed even if PDF retrieval fails
        await prisma.contract.updateMany({
          where: { id: contract.id },
          data: {
            status: "SIGNED",
            signedAt: new Date(),
            docusignStatus: "completed",
          },
        });
      }
    } else if (eventType === "signature_request_declined") {
      // Contract was declined
      await prisma.contract.updateMany({
        where: { id: contract.id },
        data: {
          status: "DECLINED",
          declinedAt: new Date(),
          docusignStatus: "declined",
        },
      });

      revalidatePath(`/dashboard/contracts/${contract.id}`);
      revalidatePath("/dashboard/contracts");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
