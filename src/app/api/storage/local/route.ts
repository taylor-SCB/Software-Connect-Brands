import { createReadStream, createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { ensureLocalDir, localPath, readLocalTicket, readUploadTicket, storageDriver } from "@/lib/storage";

// The laptop's stand-in for Vercel Blob: the same signed tickets, the
// file on disk under .local-storage/. Switched off wherever Blob is set
// up, which is always the case on the live site.
function enabled() {
  return storageDriver() === "local";
}

export async function PUT(request: Request) {
  if (!enabled()) return new Response("Not found", { status: 404 });
  const ticket = readUploadTicket(new URL(request.url).searchParams.get("t"));
  if (!ticket) return new Response("This upload link has expired. Try again.", { status: 403 });
  if ((request.headers.get("content-type") ?? "").split(";")[0] !== ticket.type) {
    return new Response("That file type isn't allowed", { status: 415 });
  }
  if (!request.body) return new Response("No file", { status: 400 });

  await ensureLocalDir(ticket.key);
  const target = localPath(ticket.key);
  let seen = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      done(seen > ticket.maxBytes ? new Error("too big") : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(request.body as NodeReadableStream), limit, createWriteStream(target, { flags: "wx" }));
  } catch {
    await unlink(target).catch(() => {});
    return new Response("Upload failed", { status: 400 });
  }
  return Response.json({ ok: true });
}

// Ranges, so a video can be scrubbed the way it can from Blob.
export async function GET(request: Request) {
  if (!enabled()) return new Response("Not found", { status: 404 });
  const ticket = readLocalTicket(new URL(request.url).searchParams.get("t"));
  if (!ticket) return new Response("Not found", { status: 404 });

  const file = localPath(ticket.key);
  const size = await stat(file).then((s) => s.size).catch(() => null);
  if (size === null) return new Response("Not found", { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": ticket.type,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=600",
  };
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (match && size > 0) {
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
}
