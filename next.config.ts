import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Chromium ships a binary alongside its JS. Bundling the package relocates
  // the JS away from that binary, and the PDF routes then fail at runtime
  // with "input directory .../bin does not exist". Keeping these external
  // leaves the package intact in node_modules where the binary is found.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
