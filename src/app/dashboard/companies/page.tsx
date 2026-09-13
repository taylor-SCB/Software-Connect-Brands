import { CompaniesList } from "./companies-list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  return <CompaniesList searchParams={await searchParams} basePath="/dashboard/companies" title="Companies" />;
}
