import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PUBLIC_IMAGE_KINDS } from "@/lib/uploads";
import { streamObject, streamStoredFile, viewUrl } from "@/lib/storage";
import { findPhotoLink, isMediaMime } from "@/lib/job-photos";
import { readPicture } from "@/lib/product-images";

// A file streamed from this site's own address can never run script.
const SANDBOXED = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";

// Streams an uploaded file. Images (logos, avatars) are served to anyone
// with the link, because they are drawn on the quote or contract a
// customer opens without logging in — the token is the only address they
// have and it is unguessable. Documents (W-9, COI, brochures) are only
// ever sent back to the workspace that uploaded them.
//
// A job's photos and videos (Oct 17, 2026) are also open to whoever holds
// a working grant to that job's folder, passed as ?v=<grant token>. Those
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
      photoFolderId: true,
    },
  });
  if (!file) return productPicture(token, new URL(request.url).searchParams.get("v"));

  const isImage = PUBLIC_IMAGE_KINDS.includes(file.kind);
  if (!isImage && !(await viaViewLink(request, file))) {
    const session = await auth();
    if (session?.user?.organizationId !== file.organizationId) {
      return new Response("Not found", { status: 404 });
    }
  }

  // ?stream=1 (Release C, Nov 12, 2026): the workspace's own people get a
  // stored photo through this server instead of a redirect to the store,
  // so the browser can draw it on a canvas to make it small for the AI.
  if (file.storageKey && new URL(request.url).searchParams.get("stream") === "1") {
    const session = await auth();
    if (session?.user?.organizationId !== file.organizationId) return new Response("Not found", { status: 404 });
    const streamed = await streamStoredFile(file.storageDriver, file.storageKey);
    if (!streamed) return new Response("Not found", { status: 404 });
    return new Response(streamed.body, {
      headers: {
        "Content-Type": file.mimeType,
        ...(streamed.size !== null ? { "Content-Length": String(streamed.size) } : {}),
        "X-Content-Type-Options": "nosniff",
        // The type is whatever the uploader's browser said, and a crew link
        // can upload. Served from this site's own address, an SVG opened
        // on its own could run script as the signed-in person; sandboxed,
        // it can't (Release C audit, Nov 12, 2026).
        "Content-Security-Policy": SANDBOXED,
        "Cache-Control": "private, no-store",
      },
    });
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

// A person's grant opens the photos and videos in its own folder of its
// own job, nothing else: not that job's documents, not another folder,
// not another job.
async function viaViewLink(
  request: Request,
  file: { projectId: string | null; organizationId: string; mimeType: string; photoFolderId: string | null },
) {
  const token = new URL(request.url).searchParams.get("v");
  if (!token || !file.projectId || !isMediaMime(file.mimeType)) return false;
  const link = await findPhotoLink(token);
  return Boolean(
    link?.usable &&
      link.kind === "GRANT" &&
      link.project.id === file.projectId &&
      link.organizationId === file.organizationId &&
      (link.folder?.id ?? null) === file.photoFolderId,
  );
}

// A product's picture (Release 3b): public, like logos, because it is drawn
// on the customer's quote, its PDF and a partner's ratesheet. ?v=thumb and
// ?v=doc are its smaller copies. The bytes behind a token never change (a
// new picture is a new row and a new token), so the CDN keeps them.
async function productPicture(token: string, variant: string | null) {
  const picture = await readPicture(token, variant === "thumb" || variant === "doc" ? variant : null);
  if (!picture) return new Response("Not found", { status: 404 });
  return new Response(picture.body, {
    headers: {
      "Content-Type": picture.type,
      ...(picture.size !== null ? { "Content-Length": String(picture.size) } : {}),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
    },
  });
}
