import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { readUploadTicket } from "@/lib/storage";

// Vercel Blob's client upload asks here for permission before a phone
// sends a photo straight to the store. The permission is the ticket the
// app already signed for one path, one type and one size, so nobody can
// use this route to put anything else in the store.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const ticket = readUploadTicket(clientPayload);
        if (!ticket || ticket.key !== pathname) throw new Error("This upload link has expired. Try again.");
        return {
          allowedContentTypes: [ticket.type],
          maximumSizeInBytes: ticket.maxBytes,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: ticket.exp,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload refused" }, { status: 400 });
  }
}
