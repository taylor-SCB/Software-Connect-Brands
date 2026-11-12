import { prisma } from "@/lib/prisma";
import { contractTotalCents } from "@/lib/contracts";
import { paidCentsOf } from "@/lib/money";
import { leftCents } from "@/lib/projects";
import { money } from "@/lib/job-ai";

// C6 (Release C): one job's own numbers as the facts "Ask the job a
// question" may answer from. Server only; scoped to the workspace.

// Dates as "Nov 12, 2026", the shape the number check takes out of both
// the facts and the answer (audit fix: "2026-11-12" left 11 and 12 among
// the allowed numbers, so "$11" passed). Calendar days are stored at UTC
// midnight, so they are read in UTC.
const iso = (date: Date | null | undefined) =>
  date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

// Everything the answer may use, all from paperwork, time and the
// calendar: the same figures the Budget, Money and Crew tabs show.
export async function jobFacts(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      name: true,
      stage: true,
      awardedAt: true,
      startOn: true,
      closedAt: true,
      awardedCents: true,
      spentCents: true,
      committedCents: true,
      billedCents: true,
      receivedCents: true,
      laborSpentCents: true,
      laborCommittedCents: true,
      scopes: {
        orderBy: { position: "asc" },
        select: {
          name: true,
          awardedCents: true,
          spentCents: true,
          committedCents: true,
          billedCents: true,
          receivedCents: true,
          laborSpentCents: true,
          laborCommittedCents: true,
        },
      },
      contracts: {
        where: { status: { in: ["SENT", "SIGNED"] } },
        select: {
          number: true,
          title: true,
          type: true,
          status: true,
          payable: true,
          signedAt: true,
          discountCents: true,
          company: { select: { name: true } },
          contact: { select: { name: true } },
          lineItems: { select: { quantity: true, unitPriceCents: true, discountCents: true } },
          payments: { select: { amountCents: true, payments: { select: { amountCents: true } } } },
        },
      },
      timeEntries: {
        select: { hours: true, days: true, amountCents: true, paidOn: true, countsAsCost: true, crew: { select: { name: true } } },
      },
      events: {
        orderBy: { startOn: "asc" },
        take: 30,
        select: { title: true, type: true, startOn: true, endOn: true, doneAt: true },
      },
      tasks: { where: { doneAt: null }, select: { id: true } },
    },
  });
  if (!project) return null;

  const bills = new Map<string, { supplier: string; ordered: number; paid: number }>();
  for (const contract of project.contracts.filter((each) => each.payable)) {
    const who = contract.company?.name ?? contract.contact.name;
    const entry = bills.get(who) ?? { supplier: who, ordered: 0, paid: 0 };
    entry.ordered += contract.payments.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);
    entry.paid += contract.payments.reduce((sum, row) => sum + paidCentsOf(row), 0);
    bills.set(who, entry);
  }

  const crews = new Map<string, { crew: string; hours: number; days: number; cost: number; paid: number }>();
  for (const entry of project.timeEntries) {
    const who = entry.crew?.name ?? "No crew";
    const row = crews.get(who) ?? { crew: who, hours: 0, days: 0, cost: 0, paid: 0 };
    row.hours += entry.hours;
    row.days += entry.days;
    if (entry.countsAsCost) {
      row.cost += entry.amountCents;
      if (entry.paidOn) row.paid += entry.amountCents;
    }
    crews.set(who, row);
  }

  return {
    job: project.name,
    stage: project.stage,
    awardedOn: iso(project.awardedAt),
    workStartsOn: iso(project.startOn),
    closedOn: iso(project.closedAt),
    awarded: money(project.awardedCents),
    spent: money(project.spentCents),
    committed: money(project.committedCents),
    left: money(leftCents(project)),
    billed: money(project.billedCents),
    collected: money(project.receivedCents),
    stillOwed: money(project.billedCents - project.receivedCents),
    crewTimeSpent: money(project.laborSpentCents),
    crewTimeCommitted: money(project.laborCommittedCents),
    scopes: project.scopes.map((scope) => ({
      scope: scope.name,
      awarded: money(scope.awardedCents),
      spent: money(scope.spentCents),
      committed: money(scope.committedCents),
      left: money(leftCents(scope)),
      overBy: leftCents(scope) < 0 ? money(-leftCents(scope)) : null,
      billed: money(scope.billedCents),
      collected: money(scope.receivedCents),
      crewTime: money(scope.laborSpentCents + scope.laborCommittedCents),
    })),
    billsBySupplier: [...bills.values()].map((bill) => ({
      supplier: bill.supplier,
      ordered: money(bill.ordered),
      paid: money(bill.paid),
      stillOpen: money(bill.ordered - bill.paid),
    })),
    changeOrders: project.contracts
      .filter((contract) => contract.type === "Change Order")
      .map((contract) => ({
        title: contract.title,
        status: contract.status,
        amount: money(contractTotalCents(contract.lineItems, contract.discountCents)),
        signedOn: iso(contract.signedAt),
      })),
    crewTime: [...crews.values()].map((row) => ({
      crew: row.crew,
      hours: Math.round(row.hours * 100) / 100,
      days: Math.round(row.days * 100) / 100,
      cost: money(row.cost),
      paid: money(row.paid),
    })),
    schedule: project.events.map((event) => ({
      what: event.title,
      type: event.type,
      on: iso(event.startOn),
      until: iso(event.endOn),
      done: Boolean(event.doneAt),
    })),
    openThingsToDo: project.tasks.length,
  };
}

