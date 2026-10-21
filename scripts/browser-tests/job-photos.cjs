/* Browser regression for job photos and videos (Oct 17, 2026).
 *
 * Covers: the Files tab's photo uploader (category first, photos and
 * videos only, the grid grouped Site walk / Finished install / Photo);
 * the crew photo link an installer opens on a phone with no login,
 * which can send but never see; the look-only links handed to anyone,
 * which open that job's photos and nothing else; turning either kind
 * off, replacing a crew link, a paused workspace's links going dark;
 * only owners and admins sharing; deleting a photo removing its file;
 * and the signed upload tickets refusing anything they don't name.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) whose .env has
 * STORAGE_DRIVER=local and no BLOB_READ_WRITE_TOKEN, so files land in
 * .local-storage/ instead of Vercel Blob; without it every upload is
 * refused with "Photo storage isn't switched on", which reads as a bug
 * and is not one. Local Postgres with `prisma migrate deploy` run.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/job-photos.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const { chromium } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-photos");
const STORE = path.join(__dirname, "..", "..", ".local-storage");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-photos@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Photos Co";
const SLUG_LIKE = "test-photos-co%";

// A real 1x1 PNG, so the browser genuinely draws it.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const png = (name) => ({ name, mimeType: "image/png", buffer: PNG });
const mp4 = (name) => ({ name, mimeType: "video/mp4", buffer: Buffer.alloc(2048, 1) });

let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}
async function sql(text, params) {
  const client = new Client({ connectionString: DB });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}
async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}
async function waitForCount(text, params, expected) {
  for (let tries = 0; tries < 60; tries += 1) {
    const n = Number((await sql(text, params)).rows[0].n);
    if (n === expected) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(`expected ${expected} for ${text}`);
}
async function status(request, url) {
  const response = await request.get(url, { maxRedirects: 5 });
  return { code: response.status(), type: response.headers()["content-type"] ?? "" };
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  page.on("dialog", (dialog) => dialog.accept());
  // Nobody logged in: an installer's phone, or whoever a gallery was shared with.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const crewPage = await phone.newPage();
  crewPage.on("pageerror", (err) => console.error("CREW PAGE ERROR:", err.message));
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();

  log("signup + activate + login, seed two jobs");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG_LIKE]);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;
  const user = (await sql(`SELECT id FROM "User" WHERE email=$1`, [EMAIL])).rows[0].id;
  for (const [id, number, name] of [
    ["prj_ph_a", 2000, "Lobby tile install"],
    ["prj_ph_b", 2001, "Garage doors"],
  ]) {
    await sql(
      `INSERT INTO "Project" (id,"organizationId",number,name,stage,"customerName","awardedAt","updatedAt")
       VALUES ($1,$2,$3,$4,'ACTIVE','Harbor Property Group',now(),now())`,
      [id, org, number, name],
    );
    await sql(`INSERT INTO "ProjectScope" (id,"projectId",name,"isDefault",position) VALUES ($1,$2,'Whole job',true,0)`, [
      `scp_${id}`,
      id,
    ]);
  }
  await login(page);
  const FILES = `${BASE}/dashboard/projects/prj_ph_a/files`;

  log("the uploader asks what the photos are before it opens the camera");
  await page.goto(FILES);
  await page.locator("[data-testid=media-pick]").click();
  await page.getByText("Pick what these are first.").waitFor();

  log("office sends a site-walk photo; it lands in object storage, not Postgres");
  await page.locator("[data-testid=media-category-site-walk]").click();
  await page.locator("[data-testid=media-files]").setInputFiles([png("walk-1.png")]);
  await page.locator("[data-testid=media-sent-count]").getByText("1 sent").waitFor();
  const staffRow = (
    await sql(
      `SELECT "storageKey","storageDriver",data IS NULL AS nodata,"uploadedById",category,"publicToken" FROM "Upload" WHERE "projectId"='prj_ph_a'`,
    )
  ).rows[0];
  assert.equal(staffRow.storageDriver, "local");
  assert.equal(staffRow.nodata, true, "the bytes are not in the database");
  assert.equal(staffRow.uploadedById, user);
  assert.equal(staffRow.category, "Site walk");
  assert.match(staffRow.storageKey, new RegExp(`^org/${org}/projects/prj_ph_a/`));
  assert.ok(fs.existsSync(path.join(STORE, staffRow.storageKey)), "the file is in the store");
  await page.locator("[data-testid=media-group][data-category='Site walk'] [data-testid=media-item]").first().waitFor();

  log("a file that isn't a photo or video is refused by name");
  await page.locator("[data-testid=media-files]").setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
  ]);
  await page.getByText("notes.txt isn't a photo or video.").waitFor();

  log("the office can open its own photo; the photo really draws");
  const drawn = await page
    .locator("[data-testid=media-item] img")
    .first()
    .evaluate((img) => img.complete && img.naturalWidth > 0);
  assert.ok(drawn, "the image loaded through /files -> the store");
  assert.deepEqual(await status(page.request, `${BASE}/files/${staffRow.publicToken}`), { code: 200, type: "image/png" });

  log("nobody logged in gets nothing from the same address");
  assert.equal((await status(strangerPage.request, `${BASE}/files/${staffRow.publicToken}`)).code, 404);

  log("make the crew photo link");
  await page.locator("[data-testid=crew-link-make]").click();
  await page.locator("[data-testid=crew-link-card] input[readonly]").waitFor();
  const crewToken = (await sql(`SELECT token FROM "ProjectPhotoLink" WHERE "projectId"='prj_ph_a' AND kind='CREW' AND active`)).rows[0].token;
  assert.match(await page.locator("[data-testid=crew-link-card] input[readonly]").inputValue(), new RegExp(`/p/${crewToken}$`));
  await shot(page, "01-files-tab");

  log("installer opens the link on a phone: no login, job named, nothing to look at");
  await crewPage.goto(`${BASE}/p/${crewToken}`);
  assert.equal(await crewPage.locator("[data-testid=photos-title]").textContent(), "Lobby tile install");
  assert.equal(await crewPage.locator("[data-testid=media-item]").count(), 0, "a crew link never shows photos");
  assert.equal(
    await crewPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "no sideways scroll on a phone",
  );

  log("installer must say who they are");
  await crewPage.locator("[data-testid=crew-category-finished-install]").click();
  await crewPage.locator("[data-testid=crew-pick]").click();
  await crewPage.getByText("Put your name in first").waitFor();

  log("installer sends a photo and a video of the finished install");
  await crewPage.locator("[data-testid=crew-who]").fill("Marco");
  await crewPage.locator("[data-testid=crew-files]").setInputFiles([png("done-1.png"), mp4("walkthrough.mp4")]);
  await crewPage.locator("[data-testid=crew-sent-count]").getByText("2 sent").waitFor();
  await shot(crewPage, "02-crew-phone");
  const crewRows = (
    await sql(
      `SELECT "uploadedByName","photoLinkId" IS NOT NULL AS linked,"mimeType",category FROM "Upload" WHERE "projectId"='prj_ph_a' AND "uploadedByName" IS NOT NULL ORDER BY "mimeType"`,
    )
  ).rows;
  assert.deepEqual(
    crewRows.map((r) => [r.uploadedByName, r.linked, r.mimeType, r.category]),
    [
      ["Marco", true, "image/png", "Finished install"],
      ["Marco", true, "video/mp4", "Finished install"],
    ],
  );

  log("the phone remembers the installer's name next time");
  await crewPage.reload();
  assert.equal(await crewPage.locator("[data-testid=crew-who]").inputValue(), "Marco");
  await crewPage.getByText("2 sent on this link so far.").waitFor();

  log("the office sees them under Finished install, marked as from the crew");
  await page.goto(FILES);
  const finished = page.locator("[data-testid=media-group][data-category='Finished install']");
  assert.equal(await finished.locator("[data-testid=media-item]").count(), 2);
  assert.match(await finished.textContent(), /Marco · crew link/);
  assert.equal(await finished.locator("video").count(), 1, "the video plays on the page");

  log("a crew link opens no photos through /files either");
  assert.equal((await status(strangerPage.request, `${BASE}/files/${staffRow.publicToken}?v=${crewToken}`)).code, 404);

  log("share a look-only link with an outside company");
  await page.locator("[data-testid=view-link-make]").click(); // empty: refused by the browser
  await page.locator("[data-testid=view-link-label]").fill("Acme Property Management");
  await page.locator("[data-testid=view-link-make]").click();
  await page.getByText("Link made for Acme Property Management").waitFor();
  const viewToken = (await sql(`SELECT token FROM "ProjectPhotoLink" WHERE "projectId"='prj_ph_a' AND kind='VIEW'`)).rows[0].token;

  log("whoever has it sees the job's photos and videos, and they load");
  await strangerPage.goto(`${BASE}/p/${viewToken}`);
  assert.equal(await strangerPage.locator("[data-testid=media-item]").count(), 3);
  const strangerDrawn = await strangerPage
    .locator("[data-testid=media-item] img")
    .first()
    .evaluate((img) => new Promise((r) => (img.complete ? r(img.naturalWidth > 0) : (img.onload = () => r(true)))));
  assert.ok(strangerDrawn);
  assert.equal(await strangerPage.locator("[data-testid=delete-media]").count(), 0, "look-only");
  await shot(strangerPage, "03-shared-gallery");
  await waitForCount(`SELECT count(*) n FROM "ProjectPhotoLink" WHERE token=$1 AND "lastUsedAt" IS NOT NULL`, [viewToken], 1);

  log("a view link opens nothing but this job's photos: not its documents, not another job");
  await page.locator("[data-testid=project-file-input]").setInputFiles({
    name: "permit.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test"),
  });
  await page.locator("[data-testid=project-file-upload]").click();
  await page.getByText("uploaded").waitFor();
  const permit = (await sql(`SELECT "publicToken" FROM "Upload" WHERE "projectId"='prj_ph_a' AND "mimeType"='application/pdf'`)).rows[0];
  assert.equal((await status(strangerPage.request, `${BASE}/files/${permit.publicToken}?v=${viewToken}`)).code, 404);
  await page.goto(`${BASE}/dashboard/projects/prj_ph_b/files`);
  await page.locator("[data-testid=media-category-photo]").click();
  await page.locator("[data-testid=media-files]").setInputFiles([png("garage.png")]);
  await page.locator("[data-testid=media-sent-count]").getByText("1 sent").waitFor();
  const otherJob = (await sql(`SELECT "publicToken" FROM "Upload" WHERE "projectId"='prj_ph_b'`)).rows[0];
  assert.equal((await status(strangerPage.request, `${BASE}/files/${otherJob.publicToken}?v=${viewToken}`)).code, 404);
  assert.equal((await status(strangerPage.request, `${BASE}/files/${staffRow.publicToken}?v=${viewToken}`)).code, 200);

  log("documents stay in the Files list below, not in the photo grid");
  await page.goto(FILES);
  assert.equal(await page.locator("[data-testid=project-file]").count(), 1);
  assert.equal(await page.locator("[data-testid=media-item]").count(), 3);

  log("turning the view link off shuts the gallery and its files");
  await page.locator("[data-testid=view-link-off]").click();
  await page.locator("[data-testid=view-link][data-active=false]").waitFor();
  await strangerPage.goto(`${BASE}/p/${viewToken}`);
  await strangerPage.getByText("This link is turned off").waitFor();
  assert.equal((await status(strangerPage.request, `${BASE}/files/${staffRow.publicToken}?v=${viewToken}`)).code, 404);
  assert.match(await page.locator("[data-testid=view-link]").textContent(), /Turned off/, "kept as a record");

  log("New link retires the old crew link, even mid-job");
  await page.locator("[data-testid=crew-link-new]").click();
  await waitForCount(`SELECT count(*) n FROM "ProjectPhotoLink" WHERE "projectId"='prj_ph_a' AND kind='CREW'`, [], 2);
  await crewPage.goto(`${BASE}/p/${crewToken}`);
  await crewPage.getByText("This link is turned off").waitFor();
  const newCrew = (await sql(`SELECT token FROM "ProjectPhotoLink" WHERE "projectId"='prj_ph_a' AND kind='CREW' AND active`)).rows[0].token;
  assert.notEqual(newCrew, crewToken);

  log("a paused workspace's links go dark");
  await sql(`UPDATE "Organization" SET status='PAUSED' WHERE id=$1`, [org]);
  await crewPage.goto(`${BASE}/p/${newCrew}`);
  await crewPage.getByText("This link is turned off").waitFor();
  await sql(`UPDATE "Organization" SET status='ACTIVE' WHERE id=$1`, [org]);

  log("a Member can send photos and turn off the crew link, but not share outside");
  await sql(`UPDATE "User" SET role='MEMBER' WHERE id=$1`, [user]);
  await page.goto(FILES);
  await page.getByText("Only an owner or admin can share a job's photos.").waitFor();
  assert.equal(await page.locator("[data-testid=view-link-label]").count(), 0);
  await sql(`UPDATE "User" SET role='OWNER' WHERE id=$1`, [user]);

  log("deleting a photo takes the file out of the store too");
  await page.goto(FILES);
  await page.locator("[data-testid=media-group][data-category='Site walk'] [data-testid=delete-media]").click();
  await waitForCount(`SELECT count(*) n FROM "Upload" WHERE "storageKey"=$1`, [staffRow.storageKey], 0);
  assert.equal(fs.existsSync(path.join(STORE, staffRow.storageKey)), false);

  log("the store refuses an upload without a valid ticket");
  const forged = await strangerPage.request.put(`${BASE}/api/storage/local?t=bogus.ticket`, {
    headers: { "content-type": "image/png" },
    data: PNG,
  });
  assert.equal(forged.status(), 403);
  const forgedRead = await strangerPage.request.get(`${BASE}/api/storage/local?t=bogus.ticket`);
  assert.equal(forgedRead.status(), 404);

  log("clean up the workspace and its files");
  const keys = (await sql(`SELECT "storageKey" FROM "Upload" WHERE "organizationId"=$1 AND "storageKey" IS NOT NULL`, [org])).rows;
  for (const { storageKey } of keys) fs.rmSync(path.join(STORE, storageKey), { force: true });
  await sql(`DELETE FROM "Organization" WHERE id=$1`, [org]);

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
