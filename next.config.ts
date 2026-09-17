import type { NextConfig } from "next";

// Every PDF route renders its own document page in headless Chrome, so each
// one needs the Chromium payload shipped beside it.
const PDF_ROUTES = ["/q/\\[token\\]/pdf", "/c/\\[token\\]/pdf", "/i/\\[token\\]/pdf"];

const nextConfig: NextConfig = {
  // Chromium ships a binary alongside its JS. Bundling the package relocates
  // the JS away from that binary, and the PDF routes then fail at runtime
  // with "input directory .../bin does not exist". Keeping these external
  // leaves the package intact in node_modules where the binary is found.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // Externalising the package is only half of it. @sparticuz/chromium finds
  // its own payload at runtime with `join(dirname(import.meta.url), "..",
  // "bin")`, and a path built at runtime is invisible to the build's file
  // tracer: it copied the package's JavaScript into the deployment and left
  // all four .br archives behind. Chromium then had nothing to unpack, so
  // every PDF on the live site came back "Could not generate the PDF" from
  // Sept 7 to Sept 15, 2026 while working fine on a laptop. Naming the
  // folder here is the only way the tracer learns about it.
  outputFileTracingIncludes: Object.fromEntries(
    PDF_ROUTES.map((route) => [route, ["./node_modules/@sparticuz/chromium/bin/**"]]),
  ),
  experimental: {
    serverActions: {
      // Ratesheet uploads travel through a server action as multipart form
      // data, and the default cap is 1 MB. The action itself refuses files
      // over 4 MB; this only has to clear that plus multipart overhead, and
      // Vercel rejects request bodies above 4.5 MB regardless.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
