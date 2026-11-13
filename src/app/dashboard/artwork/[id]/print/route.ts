import { auth } from "@/lib/auth";
import { downloadHeaders, readPrintFile } from "@/lib/artwork";

// The apparel pack: the file the school sent, exactly as sent, for the
// workspace's own people. Always a download, never shown in a page.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session?.user?.organizationId;
  if (!organizationId || !id || id.length > 60) return new Response("Not found", { status: 404 });
  const file = await readPrintFile(organizationId, id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.body, { headers: downloadHeaders(file.name, file.size) });
}
