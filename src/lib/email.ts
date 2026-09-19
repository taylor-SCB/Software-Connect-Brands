// The one place the app sends email from.
//
// Nothing was ever sent before this, which is why a forgotten password
// meant editing the database by hand. Everything else that is waiting on
// email — approval notices, invoices, ratesheet sends, the Deal Tracker's
// reminders — can go through here when its turn comes.

// Overridable so a test can point the app at a local catcher and read the
// message the customer would actually receive, rather than trusting that
// the text built somewhere up the call stack was the text that went out.
function endpoint() {
  return process.env.RESEND_ENDPOINT || "https://api.resend.com/emails";
}

/**
 * Is sending switched on?
 *
 * Both settings live in Vercel and neither exists on a laptop, so this is
 * false in local development and false on the live site until the keys are
 * added. Screens that offer to send something check this first rather than
 * promising an email that can never arrive.
 */
export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Send one message. Never throws: a caller is usually mid-form, and an
 * outage at the email provider must not turn into a crashed page.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  if (!isEmailConfigured()) {
    return { ok: false, error: "Email is not configured on this deployment." };
  }

  try {
    // 10 seconds: long enough for a slow API, short enough that a form
    // submission does not sit there looking broken.
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // The body carries the provider's reason — a domain that is not
      // verified yet, most often. Worth having in the logs verbatim.
      const detail = await response.text().catch(() => "");
      return { ok: false, error: `Resend returned ${response.status}. ${detail}`.trim() };
    }

    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: body.id ?? "" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
