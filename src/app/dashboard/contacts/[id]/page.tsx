import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { AddNoteForm, AddDealForm } from "./forms";

const stageStyles: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-800",
  CONTACTED: "bg-yellow-100 text-yellow-800",
  WON: "bg-green-100 text-green-800",
  LOST: "bg-red-100 text-red-800",
};

function formatCents(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const contact = await prisma.contact.findFirst({
    where: { id, organizationId },
    include: {
      deals: { orderBy: { createdAt: "desc" } },
      notes: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { name: true } } },
      },
    },
  });

  if (!contact) {
    notFound();
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{contact.name}</h1>
        <p className="text-sm text-gray-500">
          {[contact.company, contact.email, contact.phone].filter(Boolean).join(" · ") ||
            "No additional details"}
        </p>
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">Deals</h2>
        </div>
        <div className="mt-3 space-y-2">
          {contact.deals.length === 0 && (
            <p className="text-sm text-gray-500">No deals yet.</p>
          )}
          {contact.deals.map((deal) => (
            <div
              key={deal.id}
              className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3"
            >
              <div>
                <p className="font-medium text-gray-900">{deal.title}</p>
                <p className="text-sm text-gray-500">{formatCents(deal.valueCents)}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageStyles[deal.stage]}`}
              >
                {deal.stage}
              </span>
            </div>
          ))}
        </div>
        <AddDealForm contactId={contact.id} />
      </section>

      <section>
        <h2 className="text-lg font-medium text-gray-900">Notes</h2>
        <AddNoteForm contactId={contact.id} />
        <div className="mt-4 space-y-3">
          {contact.notes.length === 0 && (
            <p className="text-sm text-gray-500">No notes yet.</p>
          )}
          {contact.notes.map((note) => (
            <div key={note.id} className="rounded-md border border-gray-200 bg-white p-3">
              <p className="text-sm text-gray-800">{note.body}</p>
              <p className="mt-1 text-xs text-gray-400">
                {note.author.name} · {note.createdAt.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
