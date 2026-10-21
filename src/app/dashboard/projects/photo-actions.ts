"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { publicToken } from "@/lib/tokens";
import { absoluteUrl } from "@/lib/app-url";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { deleteObject } from "@/lib/storage";
import { cleanName } from "@/lib/industries";
import { ensurePhotoTag, resolvePhotoTags, type PhotoTagOption } from "@/lib/photo-tags";
import {
  canTag,
  finishMediaUpload,
  photoScope,
  resolvePhotoActor,
  startMediaUpload,
  type FileMeta,
  type PhotoAccess,
  type StartedUpload,
} from "@/lib/job-photos";

// Everything a job's photos can have done to them (Oct 17, 2026; tags,
// mini folders and Grant Access Oct 21, 2026). Each action names its job
// with a login or a link token, and src/lib/job-photos.ts decides what
// that person may do.

const idSchema = z.string().trim().min(1, "Missing record reference");
const OFF = "This link has been turned off. Ask the office for a new one.";

function filesPath(projectId: string) {
  return `/dashboard/projects/${projectId}/files`;
}

async function staff(projectId: string) {
  const actor = await resolvePhotoActor({ projectId });
  return actor?.kind === "staff" ? actor : null;
}

/* -------------------------------- Uploads -------------------------------- */

export async function startPhotoUpload(
  access: PhotoAccess,
  meta: FileMeta,
  folderId: string | null,
): Promise<StartedUpload> {
  const actor = await resolvePhotoActor(access);
  if (!actor) return { error: OFF };
  return startMediaUpload(actor, meta, folderId);
}

export async function finishPhotoUpload(
  access: PhotoAccess,
  ticket: string,
  input: { fileName: string; uploadedByName?: string; tagIds?: string[] },
): Promise<{ error?: string; ok?: true }> {
  const actor = await resolvePhotoActor(access);
  if (!actor) return { error: OFF };
  if (actor.kind === "crew" && !input.uploadedByName?.trim()) {
    return { error: "Put your name in first so the office knows who sent them." };
  }
  const result = await finishMediaUpload(actor, ticket, input);
  if (result.ok) {
    if (actor.kind === "crew") {
      await prisma.projectPhotoLink.update({ where: { id: actor.linkId }, data: { lastUsedAt: new Date() } });
    }
    revalidatePath(filesPath(actor.projectId));
  }
  return result;
}

/* ---------------------------------- Tags --------------------------------- */

// "+ Add new" on a tag row, from the Files tab, an editor's link or an
// installer's phone.
export async function addPhotoTag(
  access: PhotoAccess,
  kind: "TYPE" | "LOCATION",
  name: string,
): Promise<PhotoTagOption | { error: string }> {
  const actor = await resolvePhotoActor(access);
  if (!actor || !canTag(actor)) return { error: OFF };
  if (kind !== "TYPE" && kind !== "LOCATION") return { error: "Unknown tag list" };
  return ensurePhotoTag(actor.organizationId, kind, name);
}

export async function setPhotoTags(
  access: PhotoAccess,
  uploadId: string,
  tagIds: string[],
): Promise<{ error?: string; ok?: true }> {
  const actor = await resolvePhotoActor(access);
  if (!actor || !canTag(actor) || actor.kind === "crew") return { error: "You can't change tags here." };
  const upload = await prisma.upload.findFirst({ where: { id: String(uploadId), ...photoScope(actor) }, select: { id: true } });
  if (!upload) return { error: "That photo is gone. Reload the page." };

  const ids = await resolvePhotoTags(actor.organizationId, tagIds);
  await prisma.$transaction([
    prisma.uploadTag.deleteMany({ where: { uploadId: upload.id } }),
    prisma.uploadTag.createMany({ data: ids.map((tagId) => ({ uploadId: upload.id, tagId })), skipDuplicates: true }),
  ]);
  revalidatePath(filesPath(actor.projectId));
  return { ok: true };
}

/* -------------------------------- Folders -------------------------------- */

async function ensureFolder(organizationId: string, projectId: string, raw: string, userId: string) {
  const name = cleanName(raw);
  if (!name) return null;
  const existing = await prisma.photoFolder.findFirst({
    where: { projectId, organizationId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.photoFolder.upsert({
    where: { projectId_name: { projectId, name } },
    create: { organizationId, projectId, name, createdById: userId },
    update: {},
    select: { id: true },
  });
  return created.id;
}

export async function createPhotoFolder(projectId: string, name: string): Promise<{ error?: string; id?: string }> {
  const actor = await staff(projectId);
  if (!actor) return { error: "Project not found" };
  const id = await ensureFolder(actor.organizationId, actor.projectId, name, actor.userId);
  if (!id) return { error: "Name the folder" };
  revalidatePath(filesPath(actor.projectId));
  return { id };
}

// Move takes a photo out of where it is; Clone leaves it and puts a copy
// in each folder picked. A copy is its own row on the same stored file,
// so its tags and folder are its own and deleting one leaves the others.
// Moving to several folders moves it to the first and copies it to the
// rest. "main" is the job's main folder.
export async function placePhoto(
  projectId: string,
  uploadId: string,
  mode: "move" | "clone",
  targets: string[],
  newFolderName?: string,
): Promise<{ error?: string; success?: string }> {
  const actor = await staff(projectId);
  if (!actor) return { error: "Project not found" };
  const upload = await prisma.upload.findFirst({
    where: { id: String(uploadId), ...photoScope(actor) },
    select: {
      id: true,
      name: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      storageKey: true,
      storageDriver: true,
      uploadedById: true,
      uploadedByName: true,
      photoLinkId: true,
      photoGrantId: true,
      photoFolderId: true,
      createdAt: true,
      tags: { select: { tagId: true } },
    },
  });
  if (!upload) return { error: "That photo is gone. Reload the page." };
  if (!upload.storageKey) return { error: "Only photos sent here can go into folders." };

  const folders = await prisma.photoFolder.findMany({
    where: { projectId: actor.projectId, organizationId: actor.organizationId, id: { in: targets.filter((t) => t !== "main") } },
    select: { id: true },
  });
  const wanted: (string | null)[] = [
    ...(targets.includes("main") ? [null] : []),
    ...folders.map((folder) => folder.id),
  ];
  if (newFolderName?.trim()) {
    const id = await ensureFolder(actor.organizationId, actor.projectId, newFolderName, actor.userId);
    if (id && !wanted.includes(id)) wanted.push(id);
  }
  const destinations = wanted.filter((folder) => folder !== upload.photoFolderId);
  if (!destinations.length) return { error: "Pick a folder, or name a new one." };

  const copies = mode === "move" ? destinations.slice(1) : destinations;
  await prisma.$transaction([
    ...(mode === "move"
      ? [prisma.upload.update({ where: { id: upload.id }, data: { photoFolderId: destinations[0] } })]
      : []),
    ...copies.map((folderId) =>
      prisma.upload.create({
        data: {
          organizationId: actor.organizationId,
          projectId: actor.projectId,
          kind: "PROJECT_FILE",
          name: upload.name,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          storageKey: upload.storageKey,
          storageDriver: upload.storageDriver,
          publicToken: publicToken(),
          photoFolderId: folderId,
          uploadedById: upload.uploadedById,
          uploadedByName: upload.uploadedByName,
          photoLinkId: upload.photoLinkId,
          photoGrantId: upload.photoGrantId,
          createdAt: upload.createdAt,
          tags: { create: upload.tags.map(({ tagId }) => ({ tagId })) },
        },
      }),
    ),
  ]);
  revalidatePath(filesPath(actor.projectId));
  const count = destinations.length;
  return { success: `${mode === "move" ? "Moved" : "Copied"} to ${count} ${count === 1 ? "folder" : "folders"}` };
}

// Only the workspace that owns the job deletes. The stored file goes
// when no copy is left pointing at it.
export async function deletePhoto(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("uploadId"));
  if (!id.success) return;
  const upload = await prisma.upload.findFirst({
    where: { id: id.data, organizationId, kind: "PROJECT_FILE" },
    select: { projectId: true, storageDriver: true, storageKey: true },
  });
  if (!upload) return;
  await prisma.upload.deleteMany({ where: { id: id.data, organizationId } });
  if (upload.storageKey) {
    const others = await prisma.upload.count({ where: { storageKey: upload.storageKey } });
    if (others === 0) await deleteObject(upload.storageDriver, upload.storageKey);
  }
  if (upload.projectId) revalidatePath(filesPath(upload.projectId));
}

/* ------------------------------ Crew link ------------------------------- */

// One crew link per job. "New link" retires the old one first, so a link
// texted to someone who has left stops working the moment it is replaced.
export async function makeCrewLink(formData: FormData) {
  const { organizationId, userId } = await requireSession();
  const actor = await staff(String(formData.get("projectId") ?? ""));
  if (!actor || actor.organizationId !== organizationId) return;

  await prisma.$transaction([
    prisma.projectPhotoLink.updateMany({
      where: { organizationId, projectId: actor.projectId, kind: "CREW", active: true },
      data: { active: false, revokedAt: new Date() },
    }),
    prisma.projectPhotoLink.create({
      data: { organizationId, projectId: actor.projectId, kind: "CREW", token: publicToken(), label: "Crew", createdById: userId },
    }),
  ]);
  revalidatePath(filesPath(actor.projectId));
}

export async function turnOffCrewLink(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("linkId"));
  if (!id.success) return;
  const link = await prisma.projectPhotoLink.findFirst({ where: { id: id.data, organizationId }, select: { projectId: true } });
  if (!link) return;
  await prisma.projectPhotoLink.updateMany({
    where: { id: id.data, organizationId },
    data: { active: false, revokedAt: new Date() },
  });
  revalidatePath(filesPath(link.projectId));
}

/* ------------------------------ Grant Access ----------------------------- */

const personSchema = z.union([
  z.object({ contactId: z.string().min(1) }),
  z.object({
    name: z.string().trim().max(120).optional(),
    email: z.string().trim().toLowerCase().email("That email doesn't look right").max(200),
  }),
]);

const grantSchema = z.object({
  folderId: z.string().nullable(),
  role: z.enum(["VIEW", "EDIT"]),
  sendEmail: z.boolean(),
  people: z.array(personSchema).min(1, "Pick at least one person").max(100),
});

// Owners and admins let people outside the company into one folder of a
// job's photos. Each person gets their own link; someone typed in by
// email is added to the CRM so they are on record. Granting someone who
// already has access to this folder changes their level instead of
// making a second link.
export async function grantPhotoAccess(
  projectId: string,
  input: z.input<typeof grantSchema>,
): Promise<{ error?: string; success?: string }> {
  const session = await requireSession();
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return { error: "Only an owner or admin can grant access to a job's photos." };
  }
  const actor = await staff(projectId);
  if (!actor) return { error: "Project not found" };
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const { role, sendEmail: wantsEmail, people } = parsed.data;

  let folder: { id: string; name: string } | null = null;
  if (parsed.data.folderId) {
    folder = await prisma.photoFolder.findFirst({
      where: { id: parsed.data.folderId, projectId: actor.projectId, organizationId: actor.organizationId },
      select: { id: true, name: true },
    });
    if (!folder) return { error: "That folder is gone. Reload the page." };
  }

  // Everyone as a CRM contact with a name and, where known, an email.
  const resolved: { contactId: string; name: string; email: string | null }[] = [];
  for (const person of people) {
    if ("contactId" in person) {
      const contact = await prisma.contact.findFirst({
        where: { id: person.contactId, organizationId: actor.organizationId },
        select: { id: true, name: true, email: true },
      });
      if (contact) resolved.push({ contactId: contact.id, name: contact.name, email: contact.email });
      continue;
    }
    const known = await prisma.contact.findFirst({
      where: { organizationId: actor.organizationId, email: { equals: person.email, mode: "insensitive" } },
      select: { id: true, name: true, email: true },
    });
    const contact =
      known ??
      (await prisma.contact.create({
        data: {
          organizationId: actor.organizationId,
          name: person.name?.trim() || person.email.split("@")[0],
          email: person.email,
        },
        select: { id: true, name: true, email: true },
      }));
    resolved.push({ contactId: contact.id, name: contact.name, email: contact.email });
  }
  const unique = resolved.filter((person, index) => resolved.findIndex((p) => p.contactId === person.contactId) === index);
  if (!unique.length) return { error: "Pick at least one person" };

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: actor.projectId },
    select: { name: true, organization: { select: { name: true } } },
  });
  const emailOn = isEmailConfigured();
  let emailed = 0;

  for (const person of unique) {
    const existing = await prisma.photoGrant.findFirst({
      where: { projectId: actor.projectId, folderId: folder?.id ?? null, contactId: person.contactId, active: true },
      select: { id: true, token: true },
    });
    const grant = existing
      ? await prisma.photoGrant.update({ where: { id: existing.id }, data: { role }, select: { id: true, token: true } })
      : await prisma.photoGrant.create({
          data: {
            organizationId: actor.organizationId,
            projectId: actor.projectId,
            folderId: folder?.id ?? null,
            contactId: person.contactId,
            name: person.name,
            email: person.email,
            role,
            token: publicToken(),
            createdById: actor.userId,
          },
          select: { id: true, token: true },
        });

    if (wantsEmail && emailOn && person.email) {
      const sent = await sendGrantEmail({
        to: person.email,
        name: person.name,
        organizationName: project.organization.name,
        jobName: project.name,
        folderName: folder?.name ?? null,
        role,
        url: await absoluteUrl(`/p/${grant.token}`),
        replyTo: session.email,
      });
      if (sent) {
        emailed += 1;
        await prisma.photoGrant.update({ where: { id: grant.id }, data: { emailedAt: new Date() } });
      }
    }
  }

  revalidatePath(filesPath(actor.projectId));
  const who = `${unique.length} ${unique.length === 1 ? "person" : "people"}`;
  const mail = !wantsEmail
    ? " Copy their links below to send them yourself."
    : !emailOn
      ? " Email isn't switched on, so copy their links below to send them."
      : emailed < unique.length
        ? ` ${emailed} emailed; copy the others' links below.`
        : " Each was emailed their link.";
  return { success: `Access granted to ${who}.${mail}` };
}

async function sendGrantEmail(input: {
  to: string;
  name: string;
  organizationName: string;
  jobName: string;
  folderName: string | null;
  role: "VIEW" | "EDIT";
  url: string;
  replyTo: string;
}) {
  const what = input.folderName ? `${input.folderName} on ${input.jobName}` : input.jobName;
  const can = input.role === "EDIT" ? "look at them, add your own and tag them" : "look at them any time";
  const escape = (value: string) => value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const result = await sendEmail({
    to: input.to,
    fromName: input.organizationName,
    replyTo: input.replyTo,
    subject: `Photos: ${what}`,
    text: `Hi ${input.name},\n\n${input.organizationName} shared the photos and videos of ${what} with you. You can ${can}:\n\n${input.url}\n\nThe link is yours; no password needed.`,
    html: `<p>Hi ${escape(input.name)},</p><p>${escape(input.organizationName)} shared the photos and videos of <strong>${escape(what)}</strong> with you. You can ${can}.</p><p><a href="${escape(input.url)}">Open the photos</a></p><p style="color:#666;font-size:13px">The link is yours; no password needed.</p>`,
  });
  if (!result.ok) console.error("[photos] grant email failed", result.error);
  return result.ok;
}

export async function setGrantRole(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "OWNER" && session.role !== "ADMIN") return;
  const id = idSchema.safeParse(formData.get("grantId"));
  const role = z.enum(["VIEW", "EDIT"]).safeParse(formData.get("role"));
  if (!id.success || !role.success) return;
  const grant = await prisma.photoGrant.findFirst({
    where: { id: id.data, organizationId: session.organizationId },
    select: { projectId: true },
  });
  if (!grant) return;
  await prisma.photoGrant.update({ where: { id: id.data }, data: { role: role.data } });
  revalidatePath(filesPath(grant.projectId));
}

// Turned off, not deleted, so the list keeps a record of who had access.
export async function turnOffGrant(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "OWNER" && session.role !== "ADMIN") return;
  const id = idSchema.safeParse(formData.get("grantId"));
  if (!id.success) return;
  const grant = await prisma.photoGrant.findFirst({
    where: { id: id.data, organizationId: session.organizationId },
    select: { projectId: true },
  });
  if (!grant) return;
  await prisma.photoGrant.update({ where: { id: id.data }, data: { active: false, revokedAt: new Date() } });
  revalidatePath(filesPath(grant.projectId));
}
