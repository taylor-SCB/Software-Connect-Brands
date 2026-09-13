import { ContactsList } from "../contacts-list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The sidebar's "Favorite Contacts": the same list with the star held on.
export default async function FavoriteContactsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ContactsList
      searchParams={await searchParams}
      basePath="/dashboard/contacts/favorites"
      lock={{ fav: true }}
      title="Favorite Contacts"
    />
  );
}
