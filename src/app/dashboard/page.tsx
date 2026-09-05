import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const { organizationId } = await requireSession();

  const [contactCount, leadCount, openDeals, wonDeals] = await Promise.all([
    prisma.contact.count({ where: { organizationId } }),
    prisma.contact.count({ where: { organizationId, status: "LEAD" } }),
    prisma.deal.count({
      where: { organizationId, stage: { in: ["NEW", "CONTACTED"] } },
    }),
    prisma.deal.count({ where: { organizationId, stage: "WON" } }),
  ]);

  const stats = [
    { label: "Total contacts", value: contactCount },
    { label: "Open leads", value: leadCount },
    { label: "Open deals", value: openDeals },
    { label: "Deals won", value: wonDeals },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Overview</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
