import { auth } from "@/lib/auth";
import { readArtworkPicture } from "@/lib/artwork";

// The apparel pack: an artwork's picture, for the workspace's own people
// only (the artwork tiles and the proof sheet's canvas, same origin). The
// customer and the printer see proofs, never this. ?v=thumb or ?v=check.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session?.user?.organizationId;
  if (!organizationId || !id || id.length > 60) return new Response("Not found", { status: 404 });
  const variant = new URL(request.url).searchParams.get("v");
  const picture = await readArtworkPicture(organizationId, id, variant === "thumb" || variant === "check" ? variant : null);
  if (!picture) return new Response("Not found", { status: 404 });
  return new Response(picture.body, {
    headers: {
      "Content-Type": picture.type,
      ...(picture.size !== null ? { "Content-Length": String(picture.size) } : {}),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
      // An artwork's files never change: a replacement is a new row.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
