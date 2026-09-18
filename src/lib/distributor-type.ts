// A company we buy from. Two things in this app answer to "distributor":
// the Distributor record that drives the Products page and purchase
// orders, and a Company carrying this type, which is the CRM side. They
// are bridged by Distributor.companyId — see src/lib/distributors.ts.
//
// Kept in its own file, like TAG_SEPARATOR, so a client component can
// import the name without pulling Prisma into the browser bundle.
export const DISTRIBUTOR_COMPANY_TYPE = "Distributor";
