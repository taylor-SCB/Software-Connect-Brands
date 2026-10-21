import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { publicToken } from "@/lib/tokens";
import { resolvePhotoTags } from "@/lib/photo-tags";
import {
  MAX_MEDIA_BYTES,
  isMediaType,
  mediaKey,
  readUploadTicket,
  statObject,
  storageDriver,
  uploadTicket,
  type StorageDriver,
} from "@/lib/storage";

// Photos and videos on a job (Oct 17, 2026; tags, mini folders and Grant
// Access Oct 21, 2026). Three kinds of people touch them, and everything
// they may do is decided here:
//
//   staff  — logged in to the workspace that owns the job. Everything,
//            and the only ones who delete, move, clone or grant.
//   grant  — one outsider let into one folder. VIEW looks; EDIT also
//            adds photos to that folder and changes tags. Never deletes.
//   crew   — the job's crew photo link. Sends to the main folder and tags
//            what it sends; sees nothing.

export type PhotoActor =
  | { kind: "staff"; organizationId: string; projectId: string; userId: string; role: string }
  | {
      kind: "grant";
      organizationId: string;
      projectId: string;
      grantId: string;
      folderId: string | null;
      role: "VIEW" | "EDIT";
      name: string;
    }
  | { kind: "crew"; organizationId: string; projectId: string; linkId: string };

// How a server action names the job it is acting on: a project id with a
// login, or the token of a crew or grant link without one.
export type PhotoAccess = { projectId: string } | { token: string };

export async function resolvePhotoActor(access: PhotoAccess): Promise<PhotoActor | null> {
  if ("token" in access) {
    const link = await findPhotoLink(access.token);
    if (!link?.usable) return null;
    if (link.kind === "CREW") {
      return { kind: "crew", organizationId: link.organizationId, projectId: link.project.id, linkId: link.id };
    }
    return {
      kind: "grant",
      organizationId: link.organizationId,
      projectId: link.project.id,
      grantId: link.id,
      folderId: link.folder?.id ?? null,
      role: link.role,
      name: link.label,
    };
  }

  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, organizationId: true, role: true, removedAt: true, organization: { select: { status: true } } },
  });
  if (!user || user.removedAt || user.organization.status !== "ACTIVE") return null;
  const project = await prisma.project.findFirst({
    where: { id: String(access.projectId), organizationId: user.organizationId },
    select: { id: true },
  });
  if (!project) return null;
  return { kind: "staff", organizationId: user.organizationId, projectId: project.id, userId: user.id, role: user.role };
}

export function canUpload(actor: PhotoActor) {
  return actor.kind !== "grant" || actor.role === "EDIT";
}

export function canTag(actor: PhotoActor) {
  return actor.kind === "staff" || (actor.kind === "grant" && actor.role === "EDIT") || actor.kind === "crew";
}

// Which photos an actor may touch: staff any on the job, a grant only the
// ones in its own folder. Returns the where-clause to add.
export function photoScope(actor: PhotoActor) {
  return {
    organizationId: actor.organizationId,
    projectId: actor.projectId,
    kind: "PROJECT_FILE" as const,
    ...(actor.kind === "grant" ? { photoFolderId: actor.folderId } : {}),
  };
}

/* -------------------------------- Uploads -------------------------------- */

export type StartedUpload =
  | { error: string }
  | { driver: StorageDriver; key: string; ticket: string };

export type FileMeta = { name: string; type: string; size: number };

const metaSchema = z.object({
  name: z.string().trim().min(1).max(300),
  type: z.string().max(100),
  size: z.number().int().positive(),
});

// Step one: check the file and sign a ticket for one path in the store.
// Where the photo will live and who sent it ride in the ticket, so the
// browser can't change either between here and step two.
export async function startMediaUpload(
  actor: PhotoActor,
  meta: FileMeta,
  folderId: string | null,
): Promise<StartedUpload> {
  if (!canUpload(actor)) return { error: "This link can look but not add photos." };
  const driver = storageDriver();
  if (!driver) {
    return { error: "Photo storage isn't switched on for this site yet. Ask the office to set up Vercel Blob." };
  }
  const parsed = metaSchema.safeParse(meta);
  if (!parsed.success) return { error: "That file couldn't be read. Try choosing it again." };
  const { name, type, size } = parsed.data;
  if (!isMediaType(type)) return { error: `${name} isn't a photo or video.` };
  if (size > MAX_MEDIA_BYTES) return { error: `${name} is over 1 GB. Trim the video and try again.` };

  // An editor's photos go to their folder, the crew's to the main one;
  // staff send to whichever folder they're looking at.
  let folder: string | null = null;
  if (actor.kind === "grant") folder = actor.folderId;
  else if (actor.kind === "staff" && folderId) {
    const found = await prisma.photoFolder.findFirst({
      where: { id: folderId, projectId: actor.projectId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!found) return { error: "That folder is gone. Reload the page." };
    folder = found.id;
  }

  const key = mediaKey(actor.organizationId, actor.projectId, name);
  return {
    driver,
    key,
    ticket: uploadTicket({
      organizationId: actor.organizationId,
      projectId: actor.projectId,
      key,
      type,
      maxBytes: size,
      ...(folder ? { photoFolderId: folder } : {}),
      ...(actor.kind === "staff" ? { userId: actor.userId } : {}),
      ...(actor.kind === "crew" ? { photoLinkId: actor.linkId } : {}),
      ...(actor.kind === "grant" ? { photoGrantId: actor.grantId } : {}),
    }),
  };
}

const finishSchema = z.object({
  fileName: z.string().trim().min(1).max(300),
  uploadedByName: z.string().trim().max(80).optional(),
});

// Step two: the file is in the store. Read back what arrived and write
// the row with its tags; no Photo Type means General Project.
export async function finishMediaUpload(
  actor: PhotoActor,
  rawTicket: string,
  input: { fileName: string; uploadedByName?: string; tagIds?: string[] },
): Promise<{ error?: string; ok?: true }> {
  const ticket = readUploadTicket(rawTicket);
  if (!ticket || ticket.projectId !== actor.projectId || ticket.organizationId !== actor.organizationId) {
    return { error: "This upload took too long and expired. Send it again." };
  }
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { error: "That file couldn't be read. Try choosing it again." };

  const driver = storageDriver();
  if (!driver) return { error: "Photo storage isn't switched on." };
  const stored = await statObject(driver, ticket.key);
  if (!stored) return { error: "The file didn't arrive. Send it again." };

  // Already recorded: a retry after a dropped answer, not a second photo.
  const existing = await prisma.upload.findFirst({ where: { storageKey: ticket.key }, select: { id: true } });
  if (existing) return { ok: true };

  const tagIds = await resolvePhotoTags(ticket.organizationId, input.tagIds);
  const fileName = parsed.data.fileName.slice(0, 200);
  await prisma.upload.create({
    data: {
      organizationId: ticket.organizationId,
      projectId: ticket.projectId,
      kind: "PROJECT_FILE",
      name: fileName.replace(/\.[^.]+$/, "").slice(0, 160) || fileName,
      fileName,
      mimeType: ticket.type,
      sizeBytes: stored.size,
      storageKey: ticket.key,
      storageDriver: driver,
      publicToken: publicToken(),
      photoFolderId: ticket.photoFolderId ?? null,
      photoLinkId: ticket.photoLinkId ?? null,
      photoGrantId: ticket.photoGrantId ?? null,
      uploadedById: ticket.userId ?? null,
      uploadedByName: parsed.data.uploadedByName || null,
      tags: { create: tagIds.map((tagId) => ({ tagId })) },
    },
  });
  return { ok: true };
}

/* --------------------------------- Links --------------------------------- */

type FoundLink = {
  id: string;
  kind: "CREW" | "GRANT";
  label: string;
  role: "VIEW" | "EDIT";
  usable: boolean;
  organizationId: string;
  folder: { id: string; name: string } | null;
  project: { id: string; number: number; name: string; customerName: string };
  organization: { name: string; logoUrl: string | null; primaryColor: string; timeZone: string; status: string };
};

const projectSelect = { select: { id: true, number: true, name: true, customerName: true } } as const;
const organizationSelect = {
  select: { name: true, logoUrl: true, primaryColor: true, timeZone: true, status: true },
} as const;

// A crew link or a person's grant. "usable" is switched on and the
// workspace not paused; anything else and the page says the link is off.
export async function findPhotoLink(token: string): Promise<FoundLink | null> {
  if (!token || token.length < 20) return null;
  const crew = await prisma.projectPhotoLink.findUnique({
    where: { token },
    select: {
      id: true,
      kind: true,
      active: true,
      organizationId: true,
      project: projectSelect,
      organization: organizationSelect,
    },
  });
  if (crew?.kind === "CREW") {
    return {
      ...crew,
      kind: "CREW",
      label: "Crew",
      role: "EDIT",
      folder: null,
      usable: crew.active && crew.organization.status === "ACTIVE",
    };
  }
  const grant = await prisma.photoGrant.findUnique({
    where: { token },
    select: {
      id: true,
      name: true,
      role: true,
      active: true,
      organizationId: true,
      folder: { select: { id: true, name: true } },
      project: projectSelect,
      organization: organizationSelect,
    },
  });
  if (!grant) return null;
  return {
    ...grant,
    kind: "GRANT",
    label: grant.name,
    usable: grant.active && grant.organization.status === "ACTIVE",
  };
}

export function isMediaMime(mimeType: string) {
  return mimeType.startsWith("image/") || mimeType.startsWith("video/");
}

/* ------------------------------- Accounts -------------------------------- */

export type JobAccount = {
  id: string;
  name: string;
  why: string;
  people: { id: string; name: string; email: string | null; title: string | null }[];
};

// The companies on a job, for Grant Access: the customer, anyone with
// paperwork on it (subs, suppliers), and subcontractor crews that logged
// time on it. Each with its people, including those linked to it as an
// additional account.
export async function jobAccounts(organizationId: string, projectId: string): Promise<JobAccount[]> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      companyId: true,
      contracts: { select: { companyId: true }, where: { companyId: { not: null } } },
      timeEntries: { select: { crew: { select: { companyId: true } } }, where: { crew: { companyId: { not: null } } } },
    },
  });
  if (!project) return [];

  const why = new Map<string, string>();
  if (project.companyId) why.set(project.companyId, "Customer");
  for (const contract of project.contracts) {
    if (contract.companyId && !why.has(contract.companyId)) why.set(contract.companyId, "Paperwork on this job");
  }
  for (const entry of project.timeEntries) {
    const id = entry.crew?.companyId;
    if (id && !why.has(id)) why.set(id, "Crew on this job");
  }
  const ids = [...why.keys()];
  if (!ids.length) return [];

  const [companies, links] = await Promise.all([
    prisma.company.findMany({
      where: { organizationId, id: { in: ids } },
      select: {
        id: true,
        name: true,
        contacts: {
          where: { status: { not: "ARCHIVED" } },
          orderBy: { name: "asc" },
          take: 200,
          select: { id: true, name: true, email: true, title: true },
        },
      },
    }),
    prisma.contactAccount.findMany({
      where: { organizationId, companyId: { in: ids }, contact: { status: { not: "ARCHIVED" } } },
      take: 500,
      select: { companyId: true, contact: { select: { id: true, name: true, email: true, title: true } } },
    }),
  ]);

  return ids.flatMap((id) => {
    const company = companies.find((row) => row.id === id);
    if (!company) return [];
    const people = [...company.contacts];
    for (const link of links) {
      if (link.companyId === id && !people.some((person) => person.id === link.contact.id)) people.push(link.contact);
    }
    return [{ id, name: company.name, why: why.get(id)!, people }];
  });
}
