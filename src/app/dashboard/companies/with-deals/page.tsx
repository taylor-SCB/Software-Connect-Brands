import { CompaniesList } from "../companies-list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The sidebar's "Companies with Deals": the same list, only rows a deal or
// quote carries.
export default async function CompaniesWithDealsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <CompaniesList
      searchParams={await searchParams}
      basePath="/dashboard/companies/with-deals"
      lock={{ deals: true }}
      title="Companies with Deals"
    />
  );
}
