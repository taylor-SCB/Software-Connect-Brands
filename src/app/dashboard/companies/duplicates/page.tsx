import { requireSession } from "@/lib/session";
import { DuplicatesView } from "@/components/duplicates-view";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CompaniesDuplicatesPage({ searchParams }: { searchParams: SearchParams }) {
  const { organizationId } = await requireSession();
  return <DuplicatesView organizationId={organizationId} kind="companies" searchParams={await searchParams} />;
}
