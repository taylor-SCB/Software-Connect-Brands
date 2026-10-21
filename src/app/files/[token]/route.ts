import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PUBLIC_IMAGE_KINDS } from "@/lib/uploads";
import { streamObject, viewUrl } from "@/lib/storage";
import { findPhotoLink, isMediaMime } from "@/lib/job-photos";

// Streams an uploaded file. Images (logos, avatars) are served to anyone
// with the link, because they are drawn on the quote or contract a
// customer opens without logging in — the token is the only address they
// have and it is unguessable. Documents (W-9, COI, brochures) are only
// ever sent back to the workspace that uploaded them.
//
// A job's photos and videos (Oct 17, 2026) are also open to whoever holds
// a working look-only link to that job, passed as ?v=<link token>. Those
// kept in object storage are never streamed from here when it can be
// helped: the check is made, then the browser is sent to an address that
// works for ten minutes.
//
// This is the one place Upload.data is read (see the omit in
// src/lib/prisma.ts).
export async function GET(
  request: Request,
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
      projectId: true,
      storageKey: true,
      storageDriver: true,
    },
  });
  if (!file) return new Response("Not found", { status: 404 });

  const isImage = PUBLIC_IMAGE_KINDS.includes(file.kind);
  if (!isImage && !(await viaViewLink(request, file))) {
    const session = await auth();
    if (session?.user?.organizationId !== file.organizationId) {
      return new Response("Not found", { status: 404 });
    }
  }

  if (file.storageKey) {
    const target = await viewUrl(file.storageDriver, file.storageKey, file.mimeType);
    if (target) {
      return new Response(null, {
        status: 302,
        headers: { Location: new URL(target, request.url).toString(), "Cache-Control": "private, no-store" },
      });
    }
    const streamed = file.storageDriver === "vercel-blob" ? await streamObject(file.storageKey) : null;
    if (!streamed) return new Response("Not found", { status: 404 });
    return new Response(streamed.stream, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(streamed.blob.size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (!file.data) return new Response("Not found", { status: 404 });

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

// A look-only link opens the photos and videos of its own job, nothing
// else: not that job's documents, not another job's anything.
async function viaViewLink(
  request: Request,
  file: { projectId: string | null; organizationId: string; mimeType: string },
) {
  const token = new URL(request.url).searchParams.get("v");
  if (!token || !file.projectId || !isMediaMime(file.mimeType)) return false;
  const link = await findPhotoLink(token);
  return Boolean(
    link?.usable &&
      link.kind === "VIEW" &&
      link.project.id === file.projectId &&
      link.organizationId === file.organizationId,
  );
}
