import { CompaniesList } from "../companies-list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The sidebar's "Favorite Companies": the same list with the star held on.
export default async function FavoriteCompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <CompaniesList
      searchParams={await searchParams}
      basePath="/dashboard/companies/favorites"
      lock={{ fav: true }}
      title="Favorite Companies"
    />
  );
}
