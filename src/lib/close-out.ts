// Closing out a job.
//
// It is a button, not a process: one press marks the job Completed. What
// makes it useful is the list beside it — the things still open that
// somebody usually forgets. Nothing here blocks the button. A contractor
// closing a job with $500 still owed knows something the app does not,
// and the app has no business arguing.

import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { paidCentsOf } from "@/lib/money";

export type OpenItem = {
  // A stable key so the list can be tested and rendered without guessing.
  kind: "owed" | "unsent" | "bills" | "time" | "tasks" | "unscheduled" | "unsigned";
  text: string;
  // Where to go and do something about it.
  href: string;
};

// Everything still open on a job, in the order a person would deal with
// it: money in first, money out next, then the work itself.
export async function openItems(organizationId: string, projectId: string): Promise<OpenItem[]> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      scopes: { select: { id: true, isDefault: true } },
      contracts: {
        select: {
          id: true,
          number: true,
          payable: true,
          status: true,
          payments: {
            select: { amountCents: true, invoiceNumber: true, payments: { select: { amountCents: true } } },
          },
        },
      },
      timeEntries: {
        where: { countsAsCost: true, paidOn: null },
        select: { amountCents: true },
      },
      tasks: { where: { doneAt: null }, select: { id: true } },
      events: { where: { type: "Install" }, select: { scopeId: true } },
    },
  });
  if (!project) return [];

  const items: OpenItem[] = [];
  const money = `/dashboard/projects/${projectId}/money`;

  // What the customer still owes on paperwork they signed.
  const incoming = project.contracts.filter((contract) => !contract.payable && contract.status === "SIGNED");
  const owed = incoming.reduce(
    (sum, contract) =>
      sum + contract.payments.reduce((rows, row) => rows + row.amountCents - paidCentsOf(row), 0),
    0,
  );
  if (owed > 0) {
    items.push({ kind: "owed", text: `${formatCents(owed)} still owed by the customer`, href: money });
  }

  // Rows they owe on that have never been sent as an invoice.
  const unsent = incoming.reduce(
    (count, contract) =>
      count +
      contract.payments.filter(
        (row) => row.amountCents > 0 && row.invoiceNumber === null && paidCentsOf(row) < row.amountCents,
      ).length,
    0,
  );
  if (unsent > 0) {
    items.push({
      kind: "unsent",
      text: `${unsent} ${unsent === 1 ? "payment" : "payments"} never sent as an invoice`,
      href: money,
    });
  }

  // A customer's agreement still sitting unsigned.
  const unsigned = project.contracts.filter(
    (contract) => !contract.payable && (contract.status === "DRAFT" || contract.status === "SENT"),
  );
  if (unsigned.length > 0) {
    items.push({
      kind: "unsigned",
      text: `CON-${unsigned[0].number} has not been signed${
        unsigned.length > 1 ? ` (and ${unsigned.length - 1} more)` : ""
      }`,
      href: `/dashboard/contracts/${unsigned[0].id}`,
    });
  }

  // What is still owed to suppliers on orders that are out.
  const outgoing = project.contracts.filter(
    (contract) => contract.payable && (contract.status === "SENT" || contract.status === "SIGNED"),
  );
  const bills = outgoing.reduce(
    (sum, contract) =>
      sum +
      contract.payments.reduce((rows, row) => rows + Math.max(0, row.amountCents) - paidCentsOf(row), 0),
    0,
  );
  if (bills > 0) {
    items.push({ kind: "bills", text: `${formatCents(bills)} still owed to suppliers`, href: money });
  }

  // Crew time logged and not paid out.
  const unpaidTime = project.timeEntries.reduce((sum, entry) => sum + entry.amountCents, 0);
  if (unpaidTime > 0) {
    items.push({
      kind: "time",
      text: `${formatCents(unpaidTime)} of crew time not paid yet`,
      href: `/dashboard/projects/${projectId}/crew`,
    });
  }

  // Work that never got a day on the calendar.
  const scheduled = new Set(project.events.map((event) => event.scopeId ?? "__job__"));
  const unscheduled = project.scopes.filter(
    (scope) => !scheduled.has(scope.id) && !(scope.isDefault && scheduled.has("__job__")),
  );
  // A default scope with nothing in it is not real work, so it is not a
  // loose end. The Budget tab hides it for the same reason.
  const realUnscheduled = unscheduled.filter((scope) => !scope.isDefault || project.scopes.length === 1);
  if (realUnscheduled.length > 0) {
    items.push({
      kind: "unscheduled",
      text: `${realUnscheduled.length} ${
        realUnscheduled.length === 1 ? "scope was" : "scopes were"
      } never scheduled`,
      href: `/dashboard/projects/${projectId}/schedule`,
    });
  }

  if (project.tasks.length > 0) {
    items.push({
      kind: "tasks",
      text: `${project.tasks.length} ${project.tasks.length === 1 ? "thing" : "things"} still on the list`,
      href: `/dashboard/projects/${projectId}/schedule`,
    });
  }

  return items;
}
