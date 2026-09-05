import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { StageSelect } from "./stage-select";

const STAGES = ["NEW", "CONTACTED", "WON", "LOST"] as const;

const stageLabels: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  WON: "Won",
  LOST: "Lost",
};

function formatCents(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

export default async function DealsPage() {
  const { organizationId } = await requireSession();

  const deals = await prisma.deal.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: { contact: { select: { id: true, name: true } } },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Deals</h1>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage) => {
          const stageDeals = deals.filter((deal) => deal.stage === stage);
          return (
            <div key={stage} className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-3 py-2">
                <h2 className="text-sm font-semibold text-gray-700">
                  {stageLabels[stage]}{" "}
                  <span className="text-gray-400">({stageDeals.length})</span>
                </h2>
              </div>
              <div className="space-y-2 p-3">
                {stageDeals.length === 0 && (
                  <p className="text-xs text-gray-400">No deals</p>
                )}
                {stageDeals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-md border border-gray-200 p-2"
                  >
                    <p className="text-sm font-medium text-gray-900">{deal.title}</p>
                    <Link
                      href={`/dashboard/contacts/${deal.contact.id}`}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      {deal.contact.name}
                    </Link>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        {formatCents(deal.valueCents)}
                      </span>
                      <StageSelect dealId={deal.id} stage={deal.stage} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
