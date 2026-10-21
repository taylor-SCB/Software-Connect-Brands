import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { del, get, head, issueSignedToken, presignUrl, type IssuedSignedToken } from "@vercel/blob";

// Where big files live: job photos and videos, which are far past what a
// Postgres row should hold (Oct 17, 2026). Everything that touches the
// store goes through here, so a customer's own Google Drive or OneDrive
// can become another driver later without the pages changing.
//
// The browser never sends the bytes through our server. It asks for a
// ticket (a short-lived, signed permission for one path), sends the file
// straight to the store, then hands the ticket back so the row can be
// written. Reading works the same way: /files/<token> checks who is
// asking, then redirects to an address that works for a few minutes.

export type StorageDriver = "vercel-blob" | "local";

// Vercel Blob when its token is set. A laptop without one keeps files on
// disk so the whole flow can be tested — under `next dev`, or a built
// app started with STORAGE_DRIVER=local for the browser suites. The live
// site never does: a serverless disk is wiped between requests.
export function storageDriver(): StorageDriver | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "vercel-blob";
  if (process.env.STORAGE_DRIVER === "local" || process.env.NODE_ENV !== "production") return "local";
  return null;
}

export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;

// Photos and video only. HEIC is what an iPhone shoots; browsers other
// than Safari can't draw it, so it lands as a download tile instead.
export function isMediaType(type: string) {
  return /^(image\/(jpeg|png|gif|webp|heic|heif)|video\/(mp4|quicktime|webm|3gpp|x-m4v))$/.test(type);
}

// org/<org>/projects/<job>/<random>-<name>: unguessable, and grouped so a
// workspace's files can be found in the store's own browser.
export function mediaKey(organizationId: string, projectId: string, fileName: string) {
  const safe =
    fileName
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(-80) || "file";
  return `org/${organizationId}/projects/${projectId}/${randomBytes(9).toString("base64url")}-${safe}`;
}

/* -------------------------------- Tickets -------------------------------- */

export type UploadTicket = {
  op: "put";
  key: string;
  type: string;
  maxBytes: number;
  organizationId: string;
  projectId: string;
  photoLinkId?: string;
  photoGrantId?: string;
  photoFolderId?: string;
  userId?: string;
  exp: number;
};

type ReadTicket = { op: "get"; key: string; type: string; exp: number };

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(`storage:${body}`).digest("base64url");
}

function encode(ticket: UploadTicket | ReadTicket) {
  const body = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode<T extends UploadTicket | ReadTicket>(raw: unknown, op: T["op"]): T | null {
  if (typeof raw !== "string") return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const ticket = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    if (ticket.op !== op || ticket.exp < Date.now()) return null;
    return ticket;
  } catch {
    return null;
  }
}

// An hour: a phone on one bar of signal can take a while over a video.
export function uploadTicket(input: Omit<UploadTicket, "op" | "exp">) {
  return encode({ ...input, op: "put", exp: Date.now() + 60 * 60 * 1000 });
}

export function readUploadTicket(raw: unknown) {
  return decode<UploadTicket>(raw, "put");
}

/* ------------------------------ Local driver ----------------------------- */

const LOCAL_ROOT = path.join(process.cwd(), ".local-storage");

export function localPath(key: string) {
  const full = path.resolve(LOCAL_ROOT, key);
  if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Bad storage key");
  return full;
}

export async function ensureLocalDir(key: string) {
  await mkdir(path.dirname(localPath(key)), { recursive: true });
}

export function readLocalTicket(raw: unknown) {
  return decode<ReadTicket>(raw, "get");
}

/* ------------------------------- Operations ------------------------------ */

// What actually arrived, read back from the store rather than trusted
// from the browser. Null when nothing is there.
export async function statObject(driver: StorageDriver, key: string): Promise<{ size: number } | null> {
  try {
    if (driver === "local") return { size: (await stat(localPath(key))).size };
    const blob = await head(key);
    return { size: blob.size };
  } catch {
    return null;
  }
}

export async function deleteObject(driver: string | null, key: string | null) {
  if (!key) return;
  try {
    if (driver === "local") await unlink(localPath(key));
    else if (driver === "vercel-blob") await del(key);
  } catch (error) {
    // The row goes regardless; an orphaned object costs pennies and a
    // photo the contractor deleted must not keep showing up.
    console.error("[storage] delete failed", key, error);
  }
}

// One read permission for the whole store, kept for most of its hour, so
// a gallery of forty photos asks Vercel once rather than forty times. It
// never leaves the server: each address handed out is signed for one
// path only.
let readToken: { token: IssuedSignedToken; reuseUntil: number } | null = null;

async function storeReadToken() {
  if (readToken && readToken.reuseUntil > Date.now()) return readToken.token;
  const token = await issueSignedToken({ pathname: "*", operations: ["get"], validUntil: Date.now() + 60 * 60 * 1000 });
  readToken = { token, reuseUntil: Date.now() + 45 * 60 * 1000 };
  return token;
}

// A short-lived address the browser can load the file from directly.
// Null when the store can't sign one — the caller streams it instead.
export async function viewUrl(driver: string | null, key: string, type: string): Promise<string | null> {
  const validUntil = Date.now() + 10 * 60 * 1000;
  if (driver === "local") {
    return `/api/storage/local?t=${encodeURIComponent(encode({ op: "get", key, type, exp: validUntil }))}`;
  }
  if (driver !== "vercel-blob") return null;
  try {
    const token = await storeReadToken();
    const { presignedUrl } = await presignUrl(token, { operation: "get", pathname: key, access: "private", validUntil });
    return presignedUrl;
  } catch (error) {
    readToken = null;
    console.error("[storage] presign failed, streaming instead", error);
    return null;
  }
}

// The fallback when a signed address can't be had: the file comes through
// the server. Slower and billed twice, but the photo still shows.
export async function streamObject(key: string) {
  const result = await get(key, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return result;
}
