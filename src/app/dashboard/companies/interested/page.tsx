import { CompaniesList } from "../companies-list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The sidebar's "Interested Companies": the same list held at the Interested
// status — warm, a touch logged, no meeting set yet.
export default async function InterestedCompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <CompaniesList
      searchParams={await searchParams}
      basePath="/dashboard/companies/interested"
      lock={{ interested: true }}
      title="Interested Companies"
    />
  );
}
