// The budget behind a won job. Four numbers per scope of work, summed
// into the project's:
//
//   Awarded    what the customer agreed to pay, from the signed
//              agreement and any signed change order since
//   Billed     the part of that which is on a payment table
//   Received   what has actually come in against those rows
//   Committed  purchase orders that are out but not yet paid
//   Spent      payments already made out on those purchase orders
//   Left       awarded − spent − committed
//
// Nothing here is typed by hand: every figure comes from paperwork the
// business already produced. Integer cents throughout, rounded per line
// then summed as integers, which is what keeps a scope's numbers adding
// up to the project's.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { lineTotalCents } from "@/lib/quote-math";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { paidCentsOf } from "@/lib/money";

export const DEFAULT_SCOPE_NAME = "Whole job";

/* ------------------------------ Numbering ------------------------------ */

// PRJ-n, allocated the same atomic way quote and contract numbers are.
async function nextProjectNumber(tx: Prisma.TransactionClient, organizationId: string) {
  const organization = await tx.organization.update({
    where: { id: organizationId },
    data: { nextProjectNumber: { increment: 1 } },
    select: { nextProjectNumber: true },
  });
  return organization.nextProjectNumber - 1;
}

/* ----------------------------- Apportioning ----------------------------- */

type ApportionLine = { scopeId: string | null; quantity: number; unitPriceCents: number };

// Splits one amount across the scopes a contract's rows belong to, in
// proportion to what each scope's rows are worth. Rows with no scope (and
// a contract with no rows at all) fall to the default scope, so no money
// ever goes missing. The largest remainder takes the odd cent, so the
// parts always add back up to the whole.
export function apportion(
  lines: ApportionLine[],
  amountCents: number,
  defaultScopeId: string,
): Map<string, number> {
  const byScope = new Map<string, number>();
  let total = 0;
  for (const line of lines) {
    const value = lineTotalCents(line.quantity, line.unitPriceCents);
    const key = line.scopeId ?? defaultScopeId;
    byScope.set(key, (byScope.get(key) ?? 0) + value);
    total += value;
  }

  const shares = new Map<string, number>();
  if (amountCents === 0) return shares;
  if (total === 0) {
    // Nothing priced to go by: the whole amount sits on the default scope.
    shares.set(defaultScopeId, amountCents);
    return shares;
  }

  let assigned = 0;
  const remainders: { scopeId: string; remainder: number }[] = [];
  for (const [scopeId, value] of byScope) {
    const exact = (amountCents * value) / total;
    const whole = Math.floor(exact);
    shares.set(scopeId, whole);
    assigned += whole;
    remainders.push({ scopeId, remainder: exact - whole });
  }
  remainders.sort((a, b) => b.remainder - a.remainder);
  let left = amountCents - assigned;
  for (const entry of remainders) {
    if (left === 0) break;
    shares.set(entry.scopeId, (shares.get(entry.scopeId) ?? 0) + 1);
    left -= 1;
  }
  return shares;
}

/* ------------------------------- Awarding ------------------------------- */

const CONTRACT_FOR_AWARD = {
  id: true,
  organizationId: true,
  number: true,
  title: true,
  type: true,
  status: true,
  payable: true,
  signedAt: true,
  signedOffline: true,
  projectId: true,
  companyId: true,
  contactId: true,
  dealId: true,
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true, companyId: true, company: { select: { id: true, name: true } } } },
  deal: { select: { id: true, title: true, valueCents: true, quotes: QUOTES_FOR_VALUE } },
  lineItems: {
    select: { id: true, quantity: true, unitPriceCents: true, serviceType: true, scopeId: true },
  },
} satisfies Prisma.ContractSelect;

type ContractForAward = Prisma.ContractGetPayload<{ select: typeof CONTRACT_FOR_AWARD }>;

// Writes (or rewrites) the award rows one contract is responsible for.
// Keyed on the contract and the kind, so signing twice — or re-running
// after a row moves between scopes — leaves the same total rather than
// doubling it.
async function writeAwardRows(
  tx: Prisma.TransactionClient,
  contract: ContractForAward,
  scopeIds: { defaultScopeId: string },
  kind: "CONTRACT" | "CHANGE_ORDER",
) {
  await tx.scopeAward.deleteMany({ where: { contractId: contract.id, kind } });

  const byScope = new Map<string, number>();
  for (const line of contract.lineItems) {
    const key = line.scopeId ?? scopeIds.defaultScopeId;
    byScope.set(key, (byScope.get(key) ?? 0) + lineTotalCents(line.quantity, line.unitPriceCents));
  }

  if (byScope.size === 0) {
    // An agreement written the classic way carries no priced rows, so the
    // quote it came from is the best statement of what was agreed. Said so
    // on screen, rather than quietly showing a budget of nothing.
    const fromQuote = contract.deal ? dealValueCents(contract.deal) : 0;
    await tx.scopeAward.create({
      data: {
        scopeId: scopeIds.defaultScopeId,
        kind: "QUOTE",
        deltaCents: fromQuote,
        contractId: contract.id,
        note: contract.deal
          ? `From the quote — CON-${contract.number} has no priced rows`
          : `CON-${contract.number} has no priced rows and no quote behind it`,
      },
    });
    return;
  }

  for (const [scopeId, deltaCents] of byScope) {
    if (deltaCents === 0) continue;
    await tx.scopeAward.create({
      data: {
        scopeId,
        kind,
        deltaCents,
        contractId: contract.id,
        note: kind === "CHANGE_ORDER" ? `Change order CON-${contract.number}` : `CON-${contract.number}`,
      },
    });
  }
}

// Gives the job a scope for every kind of work on it, and files every
// unfiled row under the right one. It looks at all the job's paperwork,
// not just the agreement being signed, so a supplier's purchase order
// for the locks counts against the locks rather than the whole job.
// Rows someone has moved by hand stay where they are.
export async function syncProjectScopes(
  tx: Prisma.TransactionClient,
  args: { organizationId: string; projectId: string; contractId?: string; dealId?: string | null },
) {
  const onThisJob = {
    organizationId: args.organizationId,
    OR: [
      { projectId: args.projectId },
      ...(args.contractId ? [{ id: args.contractId }] : []),
      ...(args.dealId ? [{ dealId: args.dealId }] : []),
    ],
  } satisfies Prisma.ContractWhereInput;

  const scopes = await tx.projectScope.findMany({
    where: { projectId: args.projectId },
    select: { id: true, serviceType: true, isDefault: true, position: true },
  });
  let defaultScope = scopes.find((scope) => scope.isDefault);
  if (!defaultScope) {
    defaultScope = await tx.projectScope.create({
      data: { projectId: args.projectId, name: DEFAULT_SCOPE_NAME, isDefault: true, position: 0 },
      select: { id: true, serviceType: true, isDefault: true, position: true },
    });
    scopes.push(defaultScope);
  }

  const byServiceType = new Map<string, string>();
  for (const scope of scopes) {
    if (scope.serviceType) byServiceType.set(scope.serviceType, scope.id);
  }

  const lines = await tx.contractLineItem.findMany({
    where: { contract: onThisJob },
    select: { id: true, serviceType: true, scopeId: true },
  });

  let position = scopes.reduce((max, scope) => Math.max(max, scope.position), 0);
  for (const line of lines) {
    const serviceType = line.serviceType;
    if (!serviceType || byServiceType.has(serviceType)) continue;
    position += 1;
    const created = await tx.projectScope.create({
      data: { projectId: args.projectId, name: serviceType, serviceType, position },
      select: { id: true },
    });
    byServiceType.set(serviceType, created.id);
  }

  // One update per scope rather than per row.
  const byScope = new Map<string, string[]>();
  for (const line of lines) {
    if (line.scopeId) continue;
    const scopeId = (line.serviceType ? byServiceType.get(line.serviceType) : undefined) ?? defaultScope.id;
    byScope.set(scopeId, [...(byScope.get(scopeId) ?? []), line.id]);
  }
  for (const [scopeId, ids] of byScope) {
    await tx.contractLineItem.updateMany({ where: { id: { in: ids } }, data: { scopeId } });
  }

  return { defaultScopeId: defaultScope.id, byServiceType };
}

// "Harbor Property Group · Dana Ruiz", kept as text on the project so the
// row still reads after a company or contact is deleted.
function customerLabel(contract: ContractForAward) {
  const company = contract.company ?? contract.contact?.company ?? null;
  const parts = [company?.name, contract.contact?.name].filter(Boolean);
  return parts.join(" · ") || "Customer";
}

// Turns a signed agreement into an awarded job: finds or creates the
// project, gives it one scope per service type on the contract's rows,
// files every row under its scope, and writes the award history. Safe to
// run again on the same contract.
export async function awardFromContract(organizationId: string, contractId: string) {
  return prisma.$transaction(async (tx) => {
    const contract = (await tx.contract.findFirst({
      where: { id: contractId, organizationId },
      select: CONTRACT_FOR_AWARD,
    })) as ContractForAward | null;
    if (!contract) return null;
    // Only the customer's own signed agreement awards a job. A supplier
    // accepting a purchase order is a cost, not a win.
    if (contract.payable || contract.status !== "SIGNED") return null;

    const isChangeOrder = contract.type === "Change Order";

    let project = await tx.project.findFirst({
      where: {
        organizationId,
        OR: [
          { id: contract.projectId ?? "__none__" },
          ...(contract.dealId ? [{ dealId: contract.dealId }] : []),
        ],
      },
      select: { id: true },
    });

    if (!project) {
      // A change order with nothing to amend is treated as its own job
      // rather than refused, so no signature is ever silently dropped.
      const number = await nextProjectNumber(tx, organizationId);
      const company = contract.company ?? contract.contact?.company ?? null;
      project = await tx.project.create({
        data: {
          organizationId,
          number,
          name: contract.deal?.title || contract.title,
          dealId: contract.dealId ?? null,
          companyId: company?.id ?? null,
          contactId: contract.contactId,
          customerName: customerLabel(contract),
          awardedAt: contract.signedAt ?? new Date(),
          awardedOffline: contract.signedOffline,
        },
        select: { id: true },
      });
    }

    const { defaultScopeId } = await syncProjectScopes(tx, {
      organizationId,
      projectId: project.id,
      contractId: contract.id,
      dealId: contract.dealId,
    });

    const refreshed = (await tx.contract.findFirst({
      where: { id: contract.id },
      select: CONTRACT_FOR_AWARD,
    })) as ContractForAward;
    await writeAwardRows(tx, refreshed, { defaultScopeId }, isChangeOrder ? "CHANGE_ORDER" : "CONTRACT");

    // Every other piece of paperwork on the deal belongs to this job too:
    // the purchase orders split off the same quote are its costs.
    if (contract.dealId) {
      await tx.contract.updateMany({
        where: { organizationId, dealId: contract.dealId, projectId: null },
        data: { projectId: project.id },
      });
    } else {
      await tx.contract.updateMany({
        where: { id: contract.id, organizationId },
        data: { projectId: project.id },
      });
    }

    await refreshTotals(tx, organizationId, project.id);
    return project.id;
  });
}

// The reversal: signed paperwork that is deleted takes its award back out
// rather than leaving a budget nobody agreed to.
export async function reverseAward(
  tx: Prisma.TransactionClient,
  organizationId: string,
  contractId: string,
) {
  const rows = await tx.scopeAward.findMany({
    where: { contractId, kind: { in: ["CONTRACT", "CHANGE_ORDER", "QUOTE"] } },
    select: { scopeId: true, deltaCents: true, scope: { select: { projectId: true } } },
  });
  if (rows.length === 0) return;
  const projectIds = new Set<string>();
  for (const row of rows) {
    await tx.scopeAward.create({
      data: {
        scopeId: row.scopeId,
        kind: "CONTRACT_REMOVED",
        deltaCents: -row.deltaCents,
        contractId,
        note: "The paperwork behind this was deleted",
      },
    });
    projectIds.add(row.scope.projectId);
  }
  for (const projectId of projectIds) {
    await refreshTotals(tx, organizationId, projectId);
  }
}

/* ------------------------------- The totals ------------------------------- */

// Recomputes every number on a project and its scopes from scratch. Run
// after anything that moves money, and by `npm run recompute-projects` if
// the stored numbers are ever in doubt.
export async function refreshTotals(
  tx: Prisma.TransactionClient,
  organizationId: string,
  projectId: string,
) {
  const project = await tx.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      scopes: {
        orderBy: { position: "asc" },
        select: { id: true, isDefault: true, awards: { select: { deltaCents: true } } },
      },
      contracts: {
        select: {
          status: true,
          payable: true,
          lineItems: { select: { scopeId: true, quantity: true, unitPriceCents: true, unitCostCents: true } },
          payments: { select: { amountCents: true, payments: { select: { amountCents: true } } } },
        },
      },
    },
  });
  if (!project) return;

  const defaultScopeId = project.scopes.find((scope) => scope.isDefault)?.id ?? project.scopes[0]?.id;
  if (!defaultScopeId) return;

  const zero = () => new Map<string, number>(project.scopes.map((scope) => [scope.id, 0]));
  const awarded = zero();
  const billed = zero();
  const received = zero();
  const committed = zero();
  const spent = zero();
  const plannedCost = zero();

  for (const scope of project.scopes) {
    awarded.set(scope.id, scope.awards.reduce((sum, award) => sum + award.deltaCents, 0));
  }

  const add = (target: Map<string, number>, shares: Map<string, number>) => {
    for (const [scopeId, value] of shares) {
      target.set(scopeId, (target.get(scopeId) ?? 0) + value);
    }
  };

  for (const contract of project.contracts) {
    const rowsTotal = contract.payments.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);
    const paidTotal = contract.payments.reduce((sum, row) => sum + paidCentsOf(row), 0);

    if (!contract.payable) {
      // Money coming in only counts once the customer has signed for it.
      if (contract.status !== "SIGNED") continue;
      add(billed, apportion(contract.lineItems, rowsTotal, defaultScopeId));
      add(received, apportion(contract.lineItems, paidTotal, defaultScopeId));
      for (const line of contract.lineItems) {
        if (line.unitCostCents === null) continue;
        const key = line.scopeId ?? defaultScopeId;
        const cost = Math.round(line.unitCostCents * line.quantity);
        plannedCost.set(key, (plannedCost.get(key) ?? 0) + cost);
      }
      continue;
    }

    // Money going out counts from the moment the order is out the door;
    // a draft purchase order is still just a plan.
    if (contract.status !== "SENT" && contract.status !== "SIGNED") continue;
    add(spent, apportion(contract.lineItems, paidTotal, defaultScopeId));
    add(committed, apportion(contract.lineItems, Math.max(0, rowsTotal - paidTotal), defaultScopeId));
  }

  const sum = (map: Map<string, number>) => Array.from(map.values()).reduce((a, b) => a + b, 0);

  for (const scope of project.scopes) {
    await tx.projectScope.update({
      where: { id: scope.id },
      data: {
        awardedCents: awarded.get(scope.id) ?? 0,
        billedCents: billed.get(scope.id) ?? 0,
        receivedCents: received.get(scope.id) ?? 0,
        committedCents: committed.get(scope.id) ?? 0,
        spentCents: spent.get(scope.id) ?? 0,
        plannedCostCents: plannedCost.get(scope.id) ?? 0,
      },
    });
  }

  await tx.project.update({
    where: { id: project.id },
    data: {
      awardedCents: sum(awarded),
      billedCents: sum(billed),
      receivedCents: sum(received),
      committedCents: sum(committed),
      spentCents: sum(spent),
      plannedCostCents: sum(plannedCost),
    },
  });
}

// The same thing from outside a transaction, for the places that have
// just written a payment and only know the contract.
export async function refreshProjectTotals(organizationId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  await prisma.$transaction((tx) => refreshTotals(tx, organizationId, projectId));
}

export async function refreshTotalsForContract(organizationId: string, contractId: string) {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, organizationId },
    select: { projectId: true },
  });
  await refreshProjectTotals(organizationId, contract?.projectId);
}

/* -------------------------------- Reading -------------------------------- */

// What is left of a budget: what was awarded, less what has been paid out
// and what is already committed to a supplier.
export function leftCents(row: { awardedCents: number; spentCents: number; committedCents: number }) {
  return row.awardedCents - row.spentCents - row.committedCents;
}
