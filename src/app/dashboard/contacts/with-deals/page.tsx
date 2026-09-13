import { ContactsList } from "../contacts-list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The sidebar's "Contacts with Deals": the same list, only rows a deal or
// quote carries.
export default async function ContactsWithDealsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ContactsList
      searchParams={await searchParams}
      basePath="/dashboard/contacts/with-deals"
      lock={{ deals: true }}
      title="Contacts with Deals"
    />
  );
}
