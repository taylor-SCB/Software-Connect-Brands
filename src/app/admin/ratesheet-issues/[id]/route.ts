import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// The file behind a declined ratesheet import, for the operator only. The
// one place RatesheetImportIssue.data is read (see the global omit in
// src/lib/prisma.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const issue = await prisma.ratesheetImportIssue.findUnique({
    where: { id },
    select: { data: true, fileName: true, mimeType: true, sizeBytes: true },
  });
  if (!issue) return new Response("Not found", { status: 404 });

  const ascii = issue.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(issue.fileName);
  return new Response(new Uint8Array(issue.data), {
    headers: {
      "Content-Type": issue.mimeType || "application/octet-stream",
      "Content-Length": String(issue.sizeBytes),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
    },
  });
}
