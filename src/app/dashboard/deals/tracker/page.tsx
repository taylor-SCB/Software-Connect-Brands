import { DealTrackerPage, type TrackerSearchParams } from "./tracker-page";

export default function PipelineDealTracker({ searchParams }: { searchParams: TrackerSearchParams }) {
  return <DealTrackerPage searchParams={searchParams} basePath="/dashboard/deals/tracker" />;
}
