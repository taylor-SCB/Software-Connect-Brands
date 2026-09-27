import type { Metadata } from "next";
import { findUnsubscribe } from "@/lib/unsubscribe";
import { confirmUnsubscribe } from "./actions";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Where the footer of a marketing email lands. Opening the page does not
// unsubscribe anybody — link scanners in company mail systems open every
// link — so it takes one button press. Named for the sender's business,
// never ours: the reader only knows who emailed them.
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findUnsubscribe(token);

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
      <div className="fade-up w-full max-w-sm">
        <div className="card card-lit p-6">
          {!found ? (
            <>
              <h1 className="page-title !text-2xl">Link not found</h1>
              <p className="muted mt-2 text-sm">This unsubscribe link doesn&apos;t lead anywhere. Reply to the email and ask to be taken off the list.</p>
            </>
          ) : found.contact?.emailOptOutAt ? (
            <>
              <h1 className="page-title !text-2xl">You&apos;re unsubscribed</h1>
              <p className="muted mt-2 text-sm" data-testid="unsubscribed">
                {found.toEmail} won&apos;t get marketing email from {found.organization.name} again.
              </p>
            </>
          ) : (
            <>
              <h1 className="page-title !text-2xl">Unsubscribe</h1>
              <p className="muted mt-2 text-sm">
                Stop emails from {found.organization.name} to {found.toEmail}?
              </p>
              <form action={confirmUnsubscribe} className="mt-5">
                <input type="hidden" name="token" value={token} />
                <button type="submit" className="btn btn-primary w-full">
                  Unsubscribe
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
