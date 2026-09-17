/* Proves the built app ships Chromium's payload next to the PDF routes.
 *
 * The PDF routes render their document page in headless Chrome. Chromium's
 * four .br archives are found at runtime from a path the build's file tracer
 * cannot see, so without `outputFileTracingIncludes` in next.config.ts the
 * build quietly leaves them out and every PDF on the live site fails with
 * "Could not generate the PDF" — while working perfectly on a laptop, where
 * the archives are sitting in node_modules anyway. That is how PDFs shipped
 * broken on Sept 7, 2026 and stayed broken for eight days without a single
 * test going red, so the check belongs on the build, not in a browser suite.
 *
 *   npm run build:app && node scripts/check-pdf-trace.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose, run straight from node */
const fs = require("node:fs");
const path = require("node:path");

const ROUTES = ["q/[token]/pdf", "c/[token]/pdf", "i/[token]/pdf"];
// Every archive @sparticuz/chromium unpacks. Missing any one throws at launch.
const REQUIRED = ["chromium.br", "fonts.tar.br", "swiftshader.tar.br", "al2023.tar.br"];

let failed = false;

for (const route of ROUTES) {
  const traceDir = path.join(".next", "server", "app", route);
  const tracePath = path.join(traceDir, "route.js.nft.json");

  if (!fs.existsSync(tracePath)) {
    console.error(`FAIL  /${route} — no trace at ${tracePath}. Did the build run?`);
    failed = true;
    continue;
  }

  const { files } = JSON.parse(fs.readFileSync(tracePath, "utf8"));
  const missing = [];
  let bytes = 0;

  for (const name of REQUIRED) {
    const entry = files.find((f) => f.endsWith(`@sparticuz/chromium/bin/${name}`));
    if (!entry) {
      missing.push(name);
      continue;
    }
    // Traced paths are relative to the trace file, and a listed path that does
    // not resolve is just as broken as one that was never listed.
    const onDisk = path.resolve(traceDir, entry);
    if (!fs.existsSync(onDisk)) {
      missing.push(`${name} (listed but not on disk)`);
      continue;
    }
    bytes += fs.statSync(onDisk).size;
  }

  if (missing.length > 0) {
    console.error(`FAIL  /${route} — Chromium payload missing: ${missing.join(", ")}`);
    failed = true;
  } else {
    console.log(`ok    /${route} — Chromium payload traced (${(bytes / 1e6).toFixed(1)} MB)`);
  }
}

if (failed) {
  console.error(
    "\nPDFs will fail on the live site. Check `outputFileTracingIncludes` in next.config.ts.",
  );
  process.exit(1);
}

console.log("\nAll PDF routes ship Chromium.");
