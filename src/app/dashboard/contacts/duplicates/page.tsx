import { requireSession } from "@/lib/session";
import { DuplicatesView } from "@/components/duplicates-view";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ContactsDuplicatesPage({ searchParams }: { searchParams: SearchParams }) {
  const { organizationId } = await requireSession();
  return <DuplicatesView organizationId={organizationId} kind="contacts" searchParams={await searchParams} />;
}
