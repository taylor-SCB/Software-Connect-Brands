import { randomBytes } from "node:crypto";

// URL-safe, unguessable identifier for public quote/contract links. These
// links are the only auth on a customer-facing document, so they need
// real entropy — 24 bytes, not a sequential id.
export function publicToken() {
  return randomBytes(24).toString("base64url");
}
