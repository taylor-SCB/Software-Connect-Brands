import { NextResponse } from "next/server";
import { unsubscribe } from "@/lib/unsubscribe";

// The List-Unsubscribe-Post target (RFC 8058). Gmail and Apple Mail post
// here from their own Unsubscribe button; no page is involved.
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await unsubscribe(token);
  return new NextResponse(null, { status: 200 });
}

// A mail client that opens the header's address in a browser instead
// lands on the ordinary confirm page.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/u/${encodeURIComponent(token)}`, request.url));
}
