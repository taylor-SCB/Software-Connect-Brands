"use server";

import { prisma } from "@/lib/prisma";
import { finishMediaUpload, findPhotoLink, startMediaUpload, type FileMeta, type StartedUpload } from "@/lib/job-photos";

// An installer sending photos through a crew link. No login: the link is
// the permission, checked again on every file so turning it off stops a
// send that is already under way.

async function crewLink(token: string) {
  const link = await findPhotoLink(token);
  return link?.usable && link.kind === "CREW" ? link : null;
}

export async function startCrewUpload(token: string, meta: FileMeta): Promise<StartedUpload> {
  const link = await crewLink(token);
  if (!link) return { error: "This link has been turned off. Ask the office for a new one." };
  return startMediaUpload(
    { organizationId: link.organizationId, projectId: link.project.id, photoLinkId: link.id },
    meta,
  );
}

export async function finishCrewUpload(
  token: string,
  ticket: string,
  input: { category: string; fileName: string; uploadedByName?: string },
): Promise<{ error?: string; ok?: true }> {
  const link = await crewLink(token);
  if (!link) return { error: "This link has been turned off. Ask the office for a new one." };
  if (!input.uploadedByName?.trim()) return { error: "Put your name in first so the office knows who sent them." };
  const result = await finishMediaUpload(ticket, input);
  if (result.ok) {
    await prisma.projectPhotoLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
  }
  return result;
}
