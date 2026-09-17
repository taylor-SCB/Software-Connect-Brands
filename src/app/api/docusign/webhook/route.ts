import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSignedDocument } from "@/lib/docusign";
import { revalidatePath } from "next/cache";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // DocuSign sends envelope events with this structure
    const envelopeStatus = body.envelopeStatus;
    if (!envelopeStatus) {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const envelopeId = envelopeStatus.envelopeId;
    const status = envelopeStatus.status;

    // Find the contract with this envelope ID
    const contract = await prisma.contract.findFirst({
      where: { docusignEnvelopeId: envelopeId },
      select: { id: true, organizationId: true },
    });

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Update contract status based on envelope status
    if (status === "completed") {
      // Contract is signed
      try {
        const signedPdf = await getSignedDocument(envelopeId);

        // Convert to base64 for storage (or you could upload to cloud storage)
        const pdfBase64 = Buffer.from(signedPdf).toString("base64");
        const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

        await prisma.contract.updateMany({
          where: { id: contract.id },
          data: {
            status: "SIGNED",
            signedAt: new Date(),
            docusignStatus: "completed",
            docusignSignedPdfUrl: pdfDataUrl,
            // Extract signer info from the envelope if available
            signerEmail: envelopeStatus.recipients?.[0]?.email,
            signerName: envelopeStatus.recipients?.[0]?.name,
          },
        });

        // Revalidate dashboard to show updated status
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
    } else if (status === "declined" || status === "voided") {
      // Contract was declined or voided
      await prisma.contract.updateMany({
        where: { id: contract.id },
        data: {
          status: "DECLINED",
          declinedAt: new Date(),
          docusignStatus: status,
        },
      });

      revalidatePath(`/dashboard/contracts/${contract.id}`);
      revalidatePath("/dashboard/contracts");
    } else {
      // Other statuses like "sent", "delivered", etc.
      await prisma.contract.updateMany({
        where: { id: contract.id },
        data: {
          docusignStatus: status,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
