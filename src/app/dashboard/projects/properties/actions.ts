"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, type ActionState } from "@/lib/forms";

const idSchema = z.string().trim().min(1, "Missing record reference");

function revalidateProperties(propertyId?: string) {
  revalidatePath("/dashboard/projects/properties");
  revalidatePath("/dashboard/projects");
  if (propertyId) revalidatePath(`/dashboard/projects/properties/${propertyId}`);
}

const propertySchema = z.object({
  propertyId: z.string().trim().optional(),
  name: z.string().trim().min(1, "Give the property a name").max(160),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(40).optional(),
  companyId: z.string().trim().optional(),
  contactId: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function saveProperty(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { propertyId?: string }> {
  const { organizationId } = await requireSession();
  const parsed = parseForm(propertySchema, {
    propertyId: formData.get("propertyId") ?? undefined,
    name: formData.get("name"),
    address: formData.get("address") ?? undefined,
    city: formData.get("city") ?? undefined,
    state: formData.get("state") ?? undefined,
    companyId: formData.get("companyId") ?? undefined,
    contactId: formData.get("contactId") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error };

  const company = parsed.data.companyId
    ? await prisma.company.findFirst({
        where: { id: parsed.data.companyId, organizationId },
        select: { id: true },
      })
    : null;
  const contact = parsed.data.contactId
    ? await prisma.contact.findFirst({
        where: { id: parsed.data.contactId, organizationId },
        select: { id: true },
      })
    : null;

  const data = {
    name: parsed.data.name,
    address: parsed.data.address || null,
    city: parsed.data.city || null,
    state: parsed.data.state || null,
    companyId: company?.id ?? null,
    contactId: contact?.id ?? null,
    notes: parsed.data.notes ?? "",
  };

  if (parsed.data.propertyId) {
    const result = await prisma.property.updateMany({
      where: { id: parsed.data.propertyId, organizationId },
      data,
    });
    if (result.count === 0) return { error: "Property not found" };
    revalidateProperties(parsed.data.propertyId);
    return { success: `${data.name} saved`, propertyId: parsed.data.propertyId };
  }

  const property = await prisma.property.create({
    data: { organizationId, ...data },
    select: { id: true },
  });
  revalidateProperties(property.id);
  return { success: `${data.name} added`, propertyId: property.id };
}

// Deleting a property never touches its jobs: they go back to belonging
// to nothing, which is what they were before. Nothing about a property is
// money of its own, so there is nothing here to refuse.
export async function deleteProperty(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("propertyId"));
  if (!id.success) return { error: "Missing property reference" };

  const property = await prisma.property.findFirst({
    where: { id: id.data, organizationId },
    select: { id: true, name: true },
  });
  if (!property) return { error: "Property not found" };

  await prisma.property.deleteMany({ where: { id: property.id, organizationId } });
  revalidateProperties();
  redirect("/dashboard/projects/properties");
}

// Which jobs are at this property. A job belongs to at most one, so
// adding it here takes it off whatever it was on before — which is what
// keeps two buildings from claiming the same money.
export async function setPropertyProjects(
  propertyId: string,
  projectIds: string[],
): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(propertyId);
  if (!id.success) return { error: "Missing property reference" };

  const property = await prisma.property.findFirst({
    where: { id: id.data, organizationId },
    select: { id: true },
  });
  if (!property) return { error: "Property not found" };

  const wanted = await prisma.project.findMany({
    where: { id: { in: projectIds }, organizationId },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // Off the ones no longer picked, on to the ones that are.
    await tx.project.updateMany({
      where: { organizationId, propertyId: property.id, id: { notIn: wanted.map((row) => row.id) } },
      data: { propertyId: null },
    });
    if (wanted.length > 0) {
      await tx.project.updateMany({
        where: { organizationId, id: { in: wanted.map((row) => row.id) } },
        data: { propertyId: property.id },
      });
    }
  });

  revalidateProperties(property.id);
  return { success: `${wanted.length} ${wanted.length === 1 ? "job" : "jobs"} at this property` };
}

// The picker on a job's own page, which is the other way in.
export async function setProjectProperty(projectId: string, propertyId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true },
  });
  if (!project) return { error: "Project not found" };

  if (propertyId) {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId },
      select: { id: true },
    });
    if (!property) return { error: "Property not found" };
  }

  await prisma.project.updateMany({
    where: { id: project.id, organizationId },
    data: { propertyId: propertyId || null },
  });
  revalidateProperties(propertyId || undefined);
  revalidatePath(`/dashboard/projects/${project.id}`);
  return { success: "Saved" };
}
