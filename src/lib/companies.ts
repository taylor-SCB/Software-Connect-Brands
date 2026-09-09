import { prisma } from "@/lib/prisma";

// The Company box on a contact form is free text backed by a search, so
// saving a contact resolves the name here: an existing company (matched
// without caring about case or stray spaces) or a brand new one.
export async function findOrCreateCompany(rawName: string, organizationId: string) {
  const name = rawName.trim().replace(/\s+/g, " ");
  const existing = await prisma.company.findFirst({
    where: { organizationId, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (existing) return existing;
  return prisma.company.create({
    data: { organizationId, name },
    select: { id: true, name: true },
  });
}

// Accepts "acme.com" as well as a full URL — people type the bare domain.
export function normalizeWebsite(value: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

export function locationLabel(record: { city: string | null; state: string | null }) {
  return [record.city, record.state].filter(Boolean).join(", ");
}
