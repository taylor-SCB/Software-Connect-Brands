import { prisma } from "@/lib/prisma";
import { streamStoredFile } from "@/lib/storage";
import { cleanPairs } from "@/lib/photo-report";

// One photo of a shared close-out report (Release C, Nov 12, 2026), served
// the way /files/<token> serves a picture but only when it is in this
// report, and only while the report is shared. Streamed through the
// server, so no storage address ever reaches the customer.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; uploadId: string }> }) {
  const { token, uploadId } = await params;
  if (!token || token.length < 20 || !uploadId) return new Response("Not found", { status: 404 });
  const report = await prisma.photoReport.findUnique({
    where: { token },
    select: { shared: true, pairs: true, projectId: true, organizationId: true, organization: { select: { status: true } } },
  });
  if (!report?.shared || report.organization.status !== "ACTIVE") return new Response("Not found", { status: 404 });
  const photo = await prisma.upload.findFirst({
    where: { id: uploadId, organizationId: report.organizationId, projectId: report.projectId, kind: "PROJECT_FILE", mimeType: { startsWith: "image/" } },
    select: { id: true, mimeType: true, storageKey: true, storageDriver: true },
  });
  if (!photo?.storageKey) return new Response("Not found", { status: 404 });
  const inReport = cleanPairs(report.pairs, new Set([photo.id, ...pairIds(report.pairs)])).some(
    (pair) => pair.beforeId === photo.id || pair.afterId === photo.id,
  );
  if (!inReport) return new Response("Not found", { status: 404 });
  const streamed = await streamStoredFile(photo.storageDriver, photo.storageKey);
  if (!streamed) return new Response("Not found", { status: 404 });
  return new Response(streamed.body, {
    headers: {
      "Content-Type": photo.mimeType,
      ...(streamed.size !== null ? { "Content-Length": String(streamed.size) } : {}),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      // Turned off means off: never kept by a shared cache.
      "Cache-Control": "private, max-age=300",
    },
  });
}

function pairIds(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : []).flatMap((pair) =>
    pair && typeof pair === "object" ? [String((pair as Record<string, unknown>).beforeId), String((pair as Record<string, unknown>).afterId)] : [],
  );
}
