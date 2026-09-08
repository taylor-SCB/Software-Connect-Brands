import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Chromium ships a binary alongside its JS. Bundling the package relocates
  // the JS away from that binary, and the PDF routes then fail at runtime
  // with "input directory .../bin does not exist". Keeping these external
  // leaves the package intact in node_modules where the binary is found.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
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
