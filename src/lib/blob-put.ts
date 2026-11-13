import { upload } from "@vercel/blob/client";

// Sends one file straight to the store with a ticket signed by the server
// (product pictures, artwork, proofs). The local driver takes a PUT here.
export async function putStoredFile(driver: "local" | "vercel-blob", key: string, ticket: string, body: Blob, type: string) {
  if (driver === "local") {
    const response = await fetch(`/api/storage/local?t=${encodeURIComponent(ticket)}`, {
      method: "PUT",
      headers: { "Content-Type": type },
      body,
    });
    if (!response.ok) throw new Error("The file didn't arrive. Try again.");
    return;
  }
  await upload(key, body, { access: "private", handleUploadUrl: "/api/storage/upload", clientPayload: ticket, contentType: type });
}
