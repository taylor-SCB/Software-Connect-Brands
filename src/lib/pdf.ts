import puppeteer, { type Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium";

// PDFs are produced by rendering the app's own document pages in headless
// Chrome. That keeps one source of truth for the layout — the file a
// general contractor drops into a bid package is the same document the
// customer sees in the browser, not a second template that drifts.

// Serverless gives us a read-only filesystem and a bundled Chromium;
// locally we point at whatever Chrome is already installed.
async function launch(): Promise<Browser> {
  const localChrome =
    process.env.CHROME_EXECUTABLE_PATH ??
    (process.env.NODE_ENV !== "production" ? "/opt/pw-browsers/chromium" : undefined);

  if (localChrome) {
    return puppeteer.launch({
      executablePath: localChrome,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }

  // `chromium.args` already carries `--headless='shell'` because the bundled
  // binary is chrome-headless-shell. Passing `headless: true` makes Puppeteer
  // add a second, conflicting `--headless=new` that the shell build does not
  // understand, so say "shell" here and the two agree on one flag.
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });
}

export type PdfOptions = {
  /** Absolute URL of the page to render. */
  url: string;
  /** Cookies from the incoming request, so draft previews stay authenticated. */
  cookieHeader?: string | null;
};

// Vercel refuses a function response much over 4.5 MB, and would answer
// the customer with a bare error page. Past this the PDF is refused in words.
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

export class PdfTooLargeError extends Error {
  constructor() {
    super("This document is too large to download as a PDF. Open it and use Print instead.");
  }
}

export async function renderPdf({ url, cookieHeader }: PdfOptions): Promise<Uint8Array> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const origin = new URL(url).origin;

    // Forward the caller's session so an owner can export a draft that
    // isn't public yet. Without this the page would redirect to /login
    // and we'd silently produce a PDF of the login screen. Set as cookies
    // for this site only, so nothing the page loads from anywhere else
    // (a font, a picture) ever carries the session (Release 3b review).
    const cookies = (cookieHeader ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const at = part.indexOf("=");
        // Secure on https, which a __Secure- session cookie needs.
        return at > 0
          ? { name: part.slice(0, at), value: part.slice(at + 1), url: origin, secure: origin.startsWith("https:") }
          : null;
      })
      .filter((cookie): cookie is { name: string; value: string; url: string; secure: boolean } => cookie !== null);
    if (cookies.length > 0) await page.setCookie(...cookies);

    // Vercel's Deployment Protection guards *.vercel.app with an SSO wall.
    // The app's own session cookie doesn't satisfy it, so a self-fetch would
    // capture the login page instead of the document. This secret is exposed
    // automatically when Protection Bypass for Automation is enabled; where
    // it isn't set (custom domains, local dev) no header is sent. It goes on
    // this site's own requests only.
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) {
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        let sameOrigin = false;
        try {
          sameOrigin = new URL(request.url()).origin === origin;
        } catch {}
        if (!sameOrigin) return void request.continue();
        void request.continue({
          headers: {
            ...request.headers(),
            "x-vercel-protection-bypass": bypass,
            "x-vercel-set-bypass-cookie": "true",
          },
        });
      });
    }

    const response = await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: 25_000,
    });

    if (!response || !response.ok()) {
      throw new Error(`Document page returned ${response?.status() ?? "no response"}`);
    }

    // Web fonts finish after networkidle on occasion; without this the
    // PDF can render in a fallback face.
    await page.evaluateHandle("document.fonts.ready");

    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: "0.5in", bottom: "0.5in", left: "0.4in", right: "0.4in" },
    });

    if (pdf.byteLength > MAX_PDF_BYTES) throw new PdfTooLargeError();
    return pdf;
  } finally {
    await browser.close();
  }
}

// The request's own host is the only reliable base URL — VERCEL_URL points
// at the deployment rather than a custom domain, and localhost varies by port.
export function baseUrlFromRequest(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;
  const protocol = forwardedProto ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

// Content-Disposition filenames must not carry quotes, slashes or newlines.
export function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
