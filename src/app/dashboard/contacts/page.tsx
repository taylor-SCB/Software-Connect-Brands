import { ContactsList } from "./contacts-list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ContactsPage({ searchParams }: { searchParams: SearchParams }) {
  return <ContactsList searchParams={await searchParams} basePath="/dashboard/contacts" title="Contacts" />;
}
