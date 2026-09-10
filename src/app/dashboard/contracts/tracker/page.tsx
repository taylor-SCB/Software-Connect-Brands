import { DealTrackerPage, type TrackerSearchParams } from "@/app/dashboard/deals/tracker/tracker-page";

// The same Deal Tracker, reachable from the Contracts side.
export default function ContractsDealTracker({ searchParams }: { searchParams: TrackerSearchParams }) {
  return <DealTrackerPage searchParams={searchParams} basePath="/dashboard/contracts/tracker" />;
}
