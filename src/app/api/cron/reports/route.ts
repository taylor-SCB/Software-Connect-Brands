import { timingSafeEqual } from "node:crypto";
import { runReportEmails } from "@/lib/reports/cron";

// The hourly clock for report emails (Nov 10, 2026; vercel.json "crons").
// Vercel calls this at the top of every hour with
// `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set on the
// project. Anything without that header — or every request at all while
// CRON_SECRET is unset — is refused, so nobody outside can make the app
// send email. See src/lib/reports/cron.ts for what one run does.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Stop starting new emails after this, leaving the rest to the next hour.
const BUDGET_MS = 240_000;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

// A test clock for the browser suite ("a Monday at 6am"), honoured only off
// the live site, only when the server was started with
// REPORTS_TEST_CLOCK=1, and only on a request that already carries the
// secret. `next start` runs with NODE_ENV=production, which is why the
// switch is its own setting rather than NODE_ENV alone.
function clock(request: Request): Date {
  const testing =
    process.env.VERCEL_ENV !== "production" &&
    (process.env.NODE_ENV !== "production" || process.env.REPORTS_TEST_CLOCK === "1");
  if (testing) {
    const raw = new URL(request.url).searchParams.get("now") ?? request.headers.get("x-report-now");
    const at = raw ? new Date(raw) : null;
    if (at && !Number.isNaN(at.getTime())) return at;
  }
  return new Date();
}

function siteUrl(request: Request) {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  const result = await runReportEmails({ now: clock(request), baseUrl: siteUrl(request), budgetMs: BUDGET_MS });
  return Response.json(result);
}
