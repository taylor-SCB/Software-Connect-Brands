import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PUBLIC_IMAGE_KINDS } from "@/lib/uploads";

// Streams an uploaded file. Images (logos, avatars) are served to anyone
// with the link, because they are drawn on the quote or contract a
// customer opens without logging in — the token is the only address they
// have and it is unguessable. Documents (W-9, COI, brochures) are only
// ever sent back to the workspace that uploaded them.
//
// This is the one place Upload.data is read (see the omit in
// src/lib/prisma.ts).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 10) return new Response("Not found", { status: 404 });

  const file = await prisma.upload.findUnique({
    where: { publicToken: token },
    select: {
      data: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      kind: true,
      organizationId: true,
    },
  });
  if (!file) return new Response("Not found", { status: 404 });

  const isImage = PUBLIC_IMAGE_KINDS.includes(file.kind);
  if (!isImage) {
    const session = await auth();
    if (session?.user?.organizationId !== file.organizationId) {
      return new Response("Not found", { status: 404 });
    }
  }

  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(file.fileName);

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Length": String(file.sizeBytes),
      // Images render inline; documents download. Never sniffed, so a
      // file that claims to be a PNG is treated as one and nothing else.
      "Content-Disposition": `${isImage ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
      // A replaced logo gets a new token, so the old address can be
      // cached hard; documents never are.
      "Cache-Control": isImage ? "public, max-age=31536000, immutable" : "private, no-store",
    },
  });
}
