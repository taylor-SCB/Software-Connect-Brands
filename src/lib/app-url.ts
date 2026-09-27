import { headers } from "next/headers";

// A full address for a link that leaves the app in an email. The live
// site is the only address the app is ever reached on, but a preview
// build and a laptop both need links that point at themselves, so
// APP_URL wins when it is set and the request's own host is the fallback.
export async function absoluteUrl(path: string) {
  const configured = process.env.APP_URL;
  if (configured) return `${configured.replace(/\/+$/, "")}${path}`;
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${path}`;
}
