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

  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

export type PdfOptions = {
  /** Absolute URL of the page to render. */
  url: string;
  /** Cookies from the incoming request, so draft previews stay authenticated. */
  cookieHeader?: string | null;
};

export async function renderPdf({ url, cookieHeader }: PdfOptions): Promise<Uint8Array> {
  const browser = await launch();
  try {
    const page = await browser.newPage();

    // Forward the caller's session so an owner can export a draft that
    // isn't public yet. Without this the page would redirect to /login
    // and we'd silently produce a PDF of the login screen.
    if (cookieHeader) {
      await page.setExtraHTTPHeaders({ cookie: cookieHeader });
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
