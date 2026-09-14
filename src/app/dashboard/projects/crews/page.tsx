import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getServiceTypes } from "@/lib/service-types";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { IconHardHat } from "@/components/icons";
import { CrewCard, NewCrewButton, type CrewView } from "./crew-card";

// The people who do the work: your own crews, and the subcontractors who
// bill you. Built once here, then assigned to scopes of work on any job.
export default async function CrewsPage() {
  const { organizationId } = await requireSession();

  const [crews, companies, contacts, serviceTypes] = await Promise.all([
    prisma.crew.findMany({
      where: { organizationId },
      orderBy: [{ active: "desc" }, { kind: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        kind: true,
        companyId: true,
        contactId: true,
        serviceTypes: true,
        hourlyRateCents: true,
        dailyRateCents: true,
        phone: true,
        email: true,
        notes: true,
        active: true,
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
        workers: {
          orderBy: [{ active: "desc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            role: true,
            hourlyRateCents: true,
            dailyRateCents: true,
            phone: true,
            email: true,
            active: true,
          },
        },
        _count: { select: { timeEntries: true } },
      },
    }),
    // The pickers stay short on purpose: a workspace with a big imported
    // CRM does not need every company in a crew dropdown, and the ones
    // you subcontract to are the ones you have dealt with recently.
    prisma.company.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, name: true },
    }),
    prisma.contact.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, name: true },
    }),
    getServiceTypes(organizationId),
  ]);

  const views: CrewView[] = crews.map((crew) => ({
    id: crew.id,
    name: crew.name,
    kind: crew.kind,
    companyId: crew.companyId,
    contactId: crew.contactId,
    serviceTypes: crew.serviceTypes,
    hourlyRateCents: crew.hourlyRateCents,
    dailyRateCents: crew.dailyRateCents,
    phone: crew.phone,
    email: crew.email,
    notes: crew.notes,
    active: crew.active,
    company: crew.company,
    contact: crew.contact,
    workers: crew.workers,
    daysLogged: crew._count.timeEntries,
  }));

  const own = views.filter((crew) => crew.kind === "OWN");
  const subs = views.filter((crew) => crew.kind === "SUBCONTRACTOR");

  return (
    <div>
      <BackLink href="/dashboard/projects" label="Projects" />

      <PageHeader
        eyebrow="Projects"
        title="Crews"
        subtitle="Who does the work, and what an hour or a day of it costs."
      />

      <div className="mb-5">
        <NewCrewButton companies={companies} contacts={contacts} serviceTypes={serviceTypes} />
      </div>

      {views.length === 0 ? (
        <Card lit>
          <EmptyState
            icon={<IconHardHat size={20} />}
            title="No crews yet"
            body="Build a crew for your own people and one for each subcontractor you use. Then time on a job is two taps, and the cost lands on the budget on its own."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {own.length > 0 && (
            <section className="space-y-3">
              <h2 className="eyebrow">Your own people</h2>
              {own.map((crew) => (
                <CrewCard
                  key={crew.id}
                  crew={crew}
                  companies={companies}
                  contacts={contacts}
                  serviceTypes={serviceTypes}
                />
              ))}
            </section>
          )}
          {subs.length > 0 && (
            <section className="space-y-3">
              <h2 className="eyebrow">Subcontractors</h2>
              <p className="muted text-xs">
                They bill you, so their money comes from their purchase order. Hours logged for them are tracked so
                you can check that bill — never added to the budget on top of the order.
              </p>
              {subs.map((crew) => (
                <CrewCard
                  key={crew.id}
                  crew={crew}
                  companies={companies}
                  contacts={contacts}
                  serviceTypes={serviceTypes}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
