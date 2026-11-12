import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// A customer's marked-up copy kept on a contract (Release B, the redline
// reader), for anyone signed in to the workspace. The one place
// ContractFile.data is read besides the reader itself.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { organizationId } = await requireSession();
  const { id, fileId } = await params;
  const file = await prisma.contractFile.findFirst({
    where: { id: fileId, contractId: id, organizationId, complete: true },
    select: { data: true, fileName: true, mimeType: true, sizeBytes: true },
  });
  if (!file) return new Response("Not found", { status: 404 });

  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(file.fileName);
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
