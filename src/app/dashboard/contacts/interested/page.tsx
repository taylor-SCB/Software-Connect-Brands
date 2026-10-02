import { ContactsList } from "../contacts-list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The sidebar's "Interested Contacts": the same list held at the Interested
// status — warm, a touch logged, no meeting set yet.
export default async function InterestedContactsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ContactsList
      searchParams={await searchParams}
      basePath="/dashboard/contacts/interested"
      lock={{ interested: true }}
      title="Interested Contacts"
    />
  );
}
