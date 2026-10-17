"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireSession } from "@/lib/session";
import { publicToken } from "@/lib/tokens";
import { keepFields, type ActionState } from "@/lib/forms";
import { finishMediaUpload, startMediaUpload, type FileMeta, type StartedUpload } from "@/lib/job-photos";

// The Files tab's photos and videos, and the two kinds of link that open
// a job's photos without a login (Oct 17, 2026).

const idSchema = z.string().trim().min(1, "Missing record reference");

function filesPath(projectId: string) {
  return `/dashboard/projects/${projectId}/files`;
}

async function ownProject(organizationId: string, projectId: string) {
  const id = idSchema.safeParse(projectId);
  if (!id.success) return null;
  return prisma.project.findFirst({ where: { id: id.data, organizationId }, select: { id: true } });
}

export async function startStaffUpload(projectId: string, meta: FileMeta): Promise<StartedUpload> {
  const { organizationId, userId } = await requireSession();
  const project = await ownProject(organizationId, projectId);
  if (!project) return { error: "Project not found" };
  return startMediaUpload({ organizationId, projectId: project.id, userId }, meta);
}

export async function finishStaffUpload(
  projectId: string,
  ticket: string,
  input: { category: string; fileName: string },
): Promise<{ error?: string; ok?: true }> {
  const { organizationId } = await requireSession();
  const project = await ownProject(organizationId, projectId);
  if (!project) return { error: "Project not found" };
  const result = await finishMediaUpload(ticket, input);
  revalidatePath(filesPath(project.id));
  return result;
}

/* ------------------------------ Crew link ------------------------------- */

// One crew link per job. "New link" retires the old one first, so a link
// texted to someone who has left stops working the moment it is replaced.
export async function makeCrewLink(formData: FormData) {
  const { organizationId, userId } = await requireSession();
  const project = await ownProject(organizationId, String(formData.get("projectId") ?? ""));
  if (!project) return;

  await prisma.$transaction([
    prisma.projectPhotoLink.updateMany({
      where: { organizationId, projectId: project.id, kind: "CREW", active: true },
      data: { active: false, revokedAt: new Date() },
    }),
    prisma.projectPhotoLink.create({
      data: {
        organizationId,
        projectId: project.id,
        kind: "CREW",
        token: publicToken(),
        label: "Crew",
        createdById: userId,
      },
    }),
  ]);
  revalidatePath(filesPath(project.id));
}

/* ------------------------------ View links ------------------------------ */

// Look-only access for anyone, inside the company or out. Owners and
// admins hand these out: it is the business's photos leaving the
// building, like re-skinning the product is theirs to decide.
export async function makeViewLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only an owner or admin can share a job's photos." };
  const project = await ownProject(session.organizationId, String(formData.get("projectId") ?? ""));
  if (!project) return { error: "Project not found" };

  const label = z.string().trim().min(1, "Say who this link is for").max(120).safeParse(formData.get("label"));
  if (!label.success) return { error: label.error.issues[0]?.message, kept: keepFields(formData, ["label"]) };

  await prisma.projectPhotoLink.create({
    data: {
      organizationId: session.organizationId,
      projectId: project.id,
      kind: "VIEW",
      token: publicToken(),
      label: label.data,
      createdById: session.userId,
    },
  });
  revalidatePath(filesPath(project.id));
  return { success: `Link made for ${label.data}. Copy it below.` };
}

// Either kind can be turned off; it stays on the list so there is a
// record of who had access.
export async function turnOffPhotoLink(formData: FormData) {
  const { organizationId, role } = await requireSession();
  const id = idSchema.safeParse(formData.get("linkId"));
  if (!id.success) return;
  const link = await prisma.projectPhotoLink.findFirst({
    where: { id: id.data, organizationId },
    select: { projectId: true, kind: true },
  });
  if (!link) return;
  if (link.kind === "VIEW" && role !== "OWNER" && role !== "ADMIN") return;

  await prisma.projectPhotoLink.updateMany({
    where: { id: id.data, organizationId },
    data: { active: false, revokedAt: new Date() },
  });
  revalidatePath(filesPath(link.projectId));
}
