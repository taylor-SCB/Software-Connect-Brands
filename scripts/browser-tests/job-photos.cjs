/* Browser regression for job photos and videos (Oct 17, 2026; tags, mini
 * folders and Grant Access Oct 21, 2026).
 *
 * Covers: the two tag lists and their starting tags; a photo sent with no
 * Photo Type becoming General Project; tiles showing who, when and the
 * tags; "+ Add" from the uploader, a tile and an installer's phone; the
 * filter chips stacking; mini folders from the bar and from Move / Clone;
 * a clone being its own photo on the same stored file, which goes with
 * the last copy; the crew link (sends, tags, sees nothing); Grant Access
 * with the job's accounts (customer and paperwork), Select all, ticking
 * one person, inviting by email (added to the CRM) and emailing links;
 * View only vs Editor on a person's link, with nobody outside deleting;
 * a grant opening its own folder and nothing else; switching a role,
 * re-granting without a second link, turning a person off; Members not
 * granting; a paused workspace; forged upload tickets.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) whose .env has
 * STORAGE_DRIVER=local and no BLOB_READ_WRITE_TOKEN (files land in
 * .local-storage/), plus the fake email settings password-reset.cjs uses
 * (RESEND_API_KEY, EMAIL_FROM, RESEND_ENDPOINT=http://localhost:3999/emails):
 * the suite catches the grant emails on :3999. Local Postgres with
 * `prisma migrate deploy` run.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/job-photos.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const http = require("node:http");
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
async function one(text, params) {
  return (await sql(text, params)).rows[0];
}
async function waitFor(check, what) {
  for (let tries = 0; tries < 80; tries += 1) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(`timed out waiting for ${what}`);
}
async function status(request, url) {
  const response = await request.get(url, { maxRedirects: 5 });
  return response.status();
}

const inbox = [];
function startCatcher() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          inbox.push(JSON.parse(body));
        } catch {
          inbox.push({ raw: body });
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `caught-${inbox.length}` }));
      });
    });
    server.listen(3999, () => resolve(server));
  });
}

const tile = (page, fileName) => page.locator(`[data-testid=media-item][data-name="${fileName}"]`).first();
const tileTags = async (page, fileName) =>
  (await tile(page, fileName).locator("[data-testid=media-tags] span").allTextContents()).sort();

async function send(page, prefix, files, tags = []) {
  for (const name of tags) {
    await page.locator(`[data-testid=${prefix}-tags-tag][data-name="${name}"]`).click();
  }
  const before = await page.locator(`[data-testid=${prefix}-row][data-state=done]`).count();
  await page.locator(`[data-testid=${prefix}-files]`).setInputFiles(files);
  await waitFor(
    async () => (await page.locator(`[data-testid=${prefix}-row][data-state=done]`).count()) === before + files.length,
    `${files.length} sent`,
  );
}

(async () => {
  const catcher = await startCatcher();
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  page.on("dialog", (dialog) => dialog.accept());
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const crewPage = await phone.newPage();
  crewPage.on("pageerror", (err) => console.error("CREW PAGE ERROR:", err.message));
  const outside = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const guest = await outside.newPage();
  guest.on("pageerror", (err) => console.error("GUEST PAGE ERROR:", err.message));

  log("signup + activate + login; seed two jobs, the customer with two people, a sub with paperwork");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG_LIKE]);
  const org = (await one(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).id;
  const user = (await one(`SELECT id FROM "User" WHERE email=$1`, [EMAIL])).id;
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES
       ('cmp_ph_h',$1,'Harbor Property Group',now()), ('cmp_ph_r',$1,'Ridgeline Roofing',now()), ('cmp_ph_x',$1,'Unrelated Co',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,email,"updatedAt") VALUES
       ('ctc_ph_dana',$1,'cmp_ph_h','Dana Ruiz','dana@harbor.example.com',now()),
       ('ctc_ph_sam',$1,'cmp_ph_h','Sam Lee','sam@harbor.example.com',now()),
       ('ctc_ph_rita',$1,'cmp_ph_r','Rita Ortiz','rita@ridgeline.example.com',now()),
       ('ctc_ph_xena',$1,'cmp_ph_x','Xena Stone','xena@unrelated.example.com',now())`,
    [org],
  );
  for (const [id, number, name] of [
    ["prj_ph_a", 2000, "Lobby tile install"],
    ["prj_ph_b", 2001, "Garage doors"],
  ]) {
    await sql(
      `INSERT INTO "Project" (id,"organizationId",number,name,stage,"companyId","customerName","awardedAt","updatedAt")
       VALUES ($1,$2,$3,$4,'ACTIVE','cmp_ph_h','Harbor Property Group',now(),now())`,
      [id, org, number, name],
    );
    await sql(`INSERT INTO "ProjectScope" (id,"projectId",name,"isDefault",position) VALUES ($1,$2,'Whole job',true,0)`, [`scp_${id}`, id]);
  }
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId","companyId","projectId",number,title,type,payable,status,body,"publicToken","updatedAt")
     VALUES ('con_ph_r',$1,'ctc_ph_rita','cmp_ph_r','prj_ph_a',9101,'Roof','Purchase Order',true,'SENT','','tok_con_ph_r_0123456',now())`,
    [org],
  );
  await sql(`UPDATE "Organization" SET "nextContractNumber"=GREATEST("nextContractNumber",9102) WHERE id=$1`, [org]);
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
  const FILES = `${BASE}/dashboard/projects/prj_ph_a/files`;

  log("the two tag lists start with the four Photo Types and twelve Locations");
  await page.goto(FILES);
  const tagNames = await page.locator("[data-testid=media-tags-tag]").evaluateAll((els) => els.map((el) => el.dataset.name));
  assert.deepEqual(tagNames.slice(0, 4), ["General Project", "Site Walk", "Installation", "Finished Install"]);
  assert.equal(tagNames.length, 16);
  assert.ok(tagNames.includes("Bathroom") && tagNames.includes("Clubhouse") && tagNames.includes("Office"));

  log("a photo sent with no tags is General Project; its tile says who and when");
  await send(page, "media", [png("plain.png")]);
  await page.reload();
  assert.deepEqual(await tileTags(page, "plain.png"), ["General Project"]);
  assert.match(await tile(page, "plain.png").locator("[data-testid=media-meta]").textContent(), /Taylor Test.*\d{4}/);
  const plain = await one(`SELECT "storageKey","publicToken",data IS NULL AS nodata FROM "Upload" WHERE "projectId"='prj_ph_a' AND "fileName"='plain.png'`);
  assert.equal(plain.nodata, true, "the bytes are not in the database");
  assert.ok(fs.existsSync(path.join(STORE, plain.storageKey)));

  log("tags ticked before sending ride along; + Add makes a new Location on the spot");
  await page.locator("[data-testid=media-tags-add-location]").click();
  await page.locator("[data-testid=media-tags-new-location]").fill("Boiler Room");
  await page.locator("[data-testid=media-tags-new-location]").press("Enter");
  await page.locator("[data-testid=media-tags-tag][data-name='Boiler Room'][aria-pressed=true]").waitFor();
  await send(page, "media", [png("done-bath.png")], ["Finished Install", "Bathroom"]);
  await page.reload();
  assert.deepEqual(await tileTags(page, "done-bath.png"), ["Bathroom", "Boiler Room", "Finished Install"]);
  await send(page, "media", [mp4("walk.mp4")], ["Site Walk", "Lobby"]);
  await page.reload();
  assert.equal(await tile(page, "walk.mp4").locator("video").count(), 1, "the video plays on the tile");

  log("a file that isn't a photo or video is refused by name");
  await page.locator("[data-testid=media-files]").setInputFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") }]);
  await page.getByText("notes.txt isn't a photo or video.").waitFor();

  log("filter chips stack: a type, then a location, then clear");
  await page.reload();
  await page.locator("[data-testid=photo-filter][data-name='Finished Install']").click();
  assert.equal(await page.locator("[data-testid=media-item]").count(), 1);
  await page.locator("[data-testid=photo-filter][data-name='Site Walk']").click();
  assert.equal(await page.locator("[data-testid=media-item]").count(), 2, "two types: either one");
  await page.locator("[data-testid=photo-filter][data-name='Lobby']").click();
  assert.equal(await page.locator("[data-testid=media-item]").count(), 1, "and a location narrows it");
  await page.getByRole("button", { name: "Clear" }).click();
  assert.equal(await page.locator("[data-testid=media-item]").count(), 3);
  await shot(page, "01-files-tab");

  log("changing a tile's tags; taking off every type puts General Project back");
  await tile(page, "plain.png").locator("[data-testid=media-edit-tags]").click();
  const editor = tile(page, "plain.png").locator("[data-testid=media-tag-editor]");
  await editor.locator("[data-testid=edit-tags-tag][data-name='General Project']").click();
  await editor.locator("[data-testid=edit-tags-tag][data-name='Installation']").click();
  await editor.locator("[data-testid=edit-tags-tag][data-name='Kitchen']").click();
  await editor.locator("[data-testid=media-save-tags]").click();
  await waitFor(async () => (await tileTags(page, "plain.png")).join() === "Installation,Kitchen", "tags saved");
  await tile(page, "plain.png").locator("[data-testid=media-edit-tags]").click();
  await tile(page, "plain.png").locator("[data-testid=edit-tags-tag][data-name='Installation']").click();
  await tile(page, "plain.png").locator("[data-testid=media-save-tags]").click();
  await waitFor(async () => (await tileTags(page, "plain.png")).join() === "General Project,Kitchen", "General Project back");

  log("+ New mini folder on the bar opens it, empty");
  await page.locator("[data-testid=folder-new]").click();
  await page.locator("[data-testid=folder-new-name]").fill("Punch List");
  await page.locator("[data-testid=folder-new-save]").click();
  await page.waitForURL(/folder=/);
  await page.locator("[data-testid=photo-grid-empty]").waitFor();
  const punch = (await one(`SELECT id FROM "PhotoFolder" WHERE "projectId"='prj_ph_a' AND name='Punch List'`)).id;

  log("Clone puts a copy in Punch List and leaves the original in the main folder");
  await page.goto(FILES);
  await tile(page, "plain.png").locator("[data-testid=media-clone]").click();
  await page.locator("[data-testid=place-folder][data-name='Punch List']").check();
  await page.locator("[data-testid=place-submit]").click();
  await waitFor(async () => Number((await one(`SELECT count(*) n FROM "Upload" WHERE "storageKey"=$1`, [plain.storageKey])).n) === 2, "clone row");
  await page.reload();
  assert.equal(await page.locator("[data-testid=media-item]").count(), 3, "main folder unchanged");
  assert.match(await page.locator("[data-testid=folder-tab][data-name='Punch List']").textContent(), /· 1/);

  log("a clone's tags are its own");
  await page.goto(`${FILES}?folder=${punch}`);
  await tile(page, "plain.png").locator("[data-testid=media-edit-tags]").click();
  await tile(page, "plain.png").locator("[data-testid=edit-tags-tag][data-name='Roof']").click();
  await tile(page, "plain.png").locator("[data-testid=media-save-tags]").click();
  await waitFor(async () => (await tileTags(page, "plain.png")).includes("Roof"), "clone tagged");
  await page.goto(FILES);
  assert.deepEqual(await tileTags(page, "plain.png"), ["General Project", "Kitchen"], "original untouched");

  log("Move to Punch List plus a new folder: moved to one, copied to the other, gone from main");
  await tile(page, "done-bath.png").locator("[data-testid=media-move]").click();
  await page.locator("[data-testid=place-folder][data-name='Punch List']").check();
  await page.locator("[data-testid=place-new-folder]").fill("Owner Review");
  await page.locator("[data-testid=place-submit]").click();
  await waitFor(async () => (await page.locator("[data-testid=place-dialog]").count()) === 0, "dialog closed");
  await page.reload();
  assert.equal(await page.locator("[data-testid=media-item]").count(), 2);
  assert.match(await page.locator("[data-testid=folder-tab][data-name='Punch List']").textContent(), /· 2/);
  assert.match(await page.locator("[data-testid=folder-tab][data-name='Owner Review']").textContent(), /· 1/);

  log("deleting one copy keeps the file for the other; the last copy takes it");
  await page.goto(`${FILES}?folder=${punch}`);
  await tile(page, "plain.png").locator("[data-testid=delete-media]").click();
  await waitFor(async () => Number((await one(`SELECT count(*) n FROM "Upload" WHERE "storageKey"=$1`, [plain.storageKey])).n) === 1, "clone gone");
  assert.ok(fs.existsSync(path.join(STORE, plain.storageKey)), "the main folder's photo still has its file");

  log("crew link: installer names themself, tags, adds a new Photo Type, sends to the main folder");
  await page.goto(FILES);
  await page.locator("[data-testid=crew-link-make]").click();
  await page.locator("[data-testid=crew-link-card] input[readonly]").waitFor();
  const crewToken = (await one(`SELECT token FROM "ProjectPhotoLink" WHERE "projectId"='prj_ph_a' AND kind='CREW' AND active`)).token;
  await crewPage.goto(`${BASE}/p/${crewToken}`);
  assert.equal(await crewPage.locator("[data-testid=media-item]").count(), 0, "a crew link never shows photos");
  await crewPage.locator("[data-testid=crew-pick]").click();
  await crewPage.getByText("Put your name in first").waitFor();
  await crewPage.locator("[data-testid=crew-who]").fill("Marco");
  await crewPage.locator("[data-testid=crew-tags-add-type]").click();
  await crewPage.locator("[data-testid=crew-tags-new-type]").fill("punch item");
  await crewPage.locator("[data-testid=crew-tags-new-type]").press("Enter");
  await crewPage.locator("[data-testid=crew-tags-tag][data-name='punch item'][aria-pressed=true]").waitFor();
  await send(crewPage, "crew", [png("crew-1.png")], ["Pool Area"]);
  assert.equal(await crewPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no sideways scroll");
  await shot(crewPage, "02-crew-phone");
  await page.goto(FILES);
  assert.deepEqual(await tileTags(page, "crew-1.png"), ["Pool Area", "punch item"]);
  assert.match(await tile(page, "crew-1.png").textContent(), /Marco · crew link/);

  log("Grant Access lists the job's accounts: the customer and the sub with paperwork, nobody else");
  await page.goto(`${FILES}?folder=${punch}`);
  await page.locator("[data-testid=grant-open]").click();
  const box = await page.locator("[data-testid=grant-dialog]").boundingBox();
  assert.ok(box.y >= 0 && box.y < 200 && box.width > 400, `the window covers the screen, not one card (${JSON.stringify(box)})`);
  const accounts = await page.locator("[data-testid=grant-account]").evaluateAll((els) => els.map((el) => el.dataset.name));
  assert.deepEqual(accounts.sort(), ["Harbor Property Group", "Ridgeline Roofing"]);

  log("Select all ticks everyone under an account; one person can be ticked on their own");
  await page.locator("[data-testid=grant-account][data-name='Harbor Property Group'] [data-testid=grant-account-all]").click();
  assert.match(await page.locator("[data-testid=grant-account][data-name='Harbor Property Group'] [data-testid=grant-account-all]").textContent(), /All selected/);
  await page.locator("[data-testid=grant-account][data-name='Ridgeline Roofing'] [data-testid=grant-account-expand]").click();
  await page.locator("[data-testid=grant-person][data-name='Rita Ortiz']").check();

  log("Invite Other Users: someone from the CRM, and someone new by email");
  await page.locator("[data-testid=grant-invite-crm]").click();
  await page.locator("[data-testid=grant-search]").fill("Xena");
  await page.locator("[data-testid=grant-search-result][data-name='Xena Stone']").check();
  await page.locator("[data-testid=grant-invite-email]").click();
  await page.locator("[data-testid=grant-email-name]").fill("Pat Owner");
  await page.locator("[data-testid=grant-email-address]").fill("pat@owner.example.com");
  await page.locator("[data-testid=grant-email-add]").click();
  assert.equal(await page.locator("[data-testid=grant-picked] span").count(), 5);
  await shot(page, "03-grant-dialog");

  log("View only, emailed: five people, five emails, and Pat is now in the CRM");
  await page.locator("[data-testid=grant-role-view]").click();
  await page.locator("[data-testid=grant-submit]").click();
  await page.getByText("Access granted to 5 people. Each was emailed their link.").waitFor();
  await waitFor(async () => inbox.length === 5, "five emails");
  const toPat = inbox.find((mail) => mail.to[0] === "pat@owner.example.com");
  assert.match(toPat.subject, /Punch List on Lobby tile install/);
  assert.match(toPat.from, /^"Test Photos Co" </, "sent as the business");
  const patLink = toPat.text.match(/https?:\/\/\S+\/p\/\S+/)[0];
  assert.ok(await one(`SELECT id FROM "Contact" WHERE "organizationId"=$1 AND email='pat@owner.example.com'`, [org]));
  await page.keyboard.press("Escape");
  await page.reload();
  assert.equal(await page.locator("[data-testid=grant-row][data-active=true]").count(), 5);

  log("a view-only link opens its folder's photos with filters, and nothing to change");
  await guest.goto(patLink);
  assert.match(await guest.locator("[data-testid=photos-title]").textContent(), /Punch List · Lobby tile install/);
  assert.equal(await guest.locator("[data-testid=media-item]").count(), 1);
  assert.equal(await guest.locator("[data-testid=editor-uploader]").count(), 0);
  assert.equal(await guest.locator("[data-testid=media-edit-tags], [data-testid=delete-media], [data-testid=media-move]").count(), 0);
  assert.ok(await guest.locator("[data-testid=media-item] img").first().evaluate((img) => new Promise((r) => (img.complete ? r(img.naturalWidth > 0) : (img.onload = () => r(true))))));
  await guest.locator("[data-testid=photo-filter]").first().waitFor();
  await shot(guest, "04-view-only");

  log("a grant opens nothing outside its folder: not the main folder, not another job");
  const patToken = patLink.split("/p/")[1];
  assert.equal(await status(guest.request, `${BASE}/files/${plain.publicToken}?v=${patToken}`), 404);
  await page.goto(`${BASE}/dashboard/projects/prj_ph_b/files`);
  await send(page, "media", [png("garage.png")]);
  const garage = await one(`SELECT "publicToken" FROM "Upload" WHERE "projectId"='prj_ph_b'`);
  assert.equal(await status(guest.request, `${BASE}/files/${garage.publicToken}?v=${patToken}`), 404);
  assert.equal(await status(guest.request, `${BASE}/files/${plain.publicToken}`), 404, "nobody logged in gets nothing");

  log("Dana as Editor on the main folder: adds a photo and changes tags, never deletes or moves");
  await page.goto(FILES);
  await page.locator("[data-testid=grant-open]").click();
  await page.locator("[data-testid=grant-account][data-name='Harbor Property Group'] [data-testid=grant-account-expand]").click();
  await page.locator("[data-testid=grant-person][data-name='Dana Ruiz']").check();
  await page.locator("[data-testid=grant-role-edit]").click();
  await page.locator("[data-testid=grant-send-email]").uncheck();
  await page.locator("[data-testid=grant-submit]").click();
  await page.getByText("Access granted to 1 person.").waitFor();
  assert.equal(inbox.length, 5, "unticked: no email");
  await page.keyboard.press("Escape");
  const danaToken = (await one(`SELECT token FROM "PhotoGrant" WHERE "contactId"='ctc_ph_dana' AND "folderId" IS NULL AND active`)).token;
  await guest.goto(`${BASE}/p/${danaToken}`);
  await send(guest, "editor", [png("from-dana.png")], ["Site Walk", "Office"]);
  await guest.reload();
  assert.match(await tile(guest, "from-dana.png").textContent(), /Dana Ruiz/);
  await tile(guest, "walk.mp4").locator("[data-testid=media-edit-tags]").click();
  await tile(guest, "walk.mp4").locator("[data-testid=edit-tags-tag][data-name='Hallway']").click();
  await tile(guest, "walk.mp4").locator("[data-testid=media-save-tags]").click();
  await waitFor(async () => (await tileTags(guest, "walk.mp4")).includes("Hallway"), "editor tagged");
  assert.equal(await guest.locator("[data-testid=delete-media], [data-testid=media-move], [data-testid=media-clone]").count(), 0);
  const fromDana = await one(`SELECT "photoFolderId","photoGrantId" FROM "Upload" WHERE "fileName"='from-dana.png'`);
  assert.equal(fromDana.photoFolderId, null, "landed in the folder Dana was granted");
  assert.ok(fromDana.photoGrantId);
  await shot(guest, "05-editor");

  log("Make view only takes the uploader and tag buttons away");
  await page.goto(FILES);
  await page.locator("[data-testid=grant-row][data-name='Dana Ruiz'] [data-testid=grant-switch-role]").click();
  await page.locator("[data-testid=grant-row][data-name='Dana Ruiz'][data-role=VIEW]").waitFor();
  await guest.reload();
  assert.equal(await guest.locator("[data-testid=editor-uploader]").count(), 0);
  assert.equal(await guest.locator("[data-testid=media-edit-tags]").count(), 0);

  log("granting Dana again changes her level rather than making a second link");
  await page.locator("[data-testid=grant-open]").click();
  await page.locator("[data-testid=grant-account][data-name='Harbor Property Group'] [data-testid=grant-account-expand]").click();
  await page.locator("[data-testid=grant-person][data-name='Dana Ruiz']").check();
  await page.locator("[data-testid=grant-role-edit]").click();
  await page.locator("[data-testid=grant-send-email]").uncheck();
  await page.locator("[data-testid=grant-submit]").click();
  await page.getByText("Access granted to 1 person.").waitFor();
  const danas = await sql(`SELECT role, token FROM "PhotoGrant" WHERE "contactId"='ctc_ph_dana' AND "folderId" IS NULL`);
  assert.deepEqual(danas.rows.map((r) => [r.role, r.token]), [["EDIT", danaToken]]);
  await page.keyboard.press("Escape");

  log("turning Pat off shuts the page and the files");
  await page.goto(`${FILES}?folder=${punch}`);
  await page.locator("[data-testid=grant-row][data-name='Pat Owner'] [data-testid=grant-off]").click();
  await page.locator("[data-testid=grant-row][data-name='Pat Owner'][data-active=false]").waitFor();
  await guest.goto(patLink);
  await guest.getByText("This link is turned off").waitFor();
  const inPunch = await one(`SELECT "publicToken" FROM "Upload" WHERE "photoFolderId"=$1 LIMIT 1`, [punch]);
  assert.equal(await status(guest.request, `${BASE}/files/${inPunch.publicToken}?v=${patToken}`), 404);
  const xenaToken = (await one(`SELECT token FROM "PhotoGrant" WHERE "contactId"='ctc_ph_xena' AND active`)).token;
  assert.equal(await status(guest.request, `${BASE}/files/${inPunch.publicToken}?v=${xenaToken}`), 200, "the others still work");

  log("a Member sends photos but can't grant access");
  await sql(`UPDATE "User" SET role='MEMBER' WHERE id=$1`, [user]);
  await page.goto(FILES);
  await page.getByText("Only an owner or admin can grant access to a job's photos.").waitFor();
  assert.equal(await page.locator("[data-testid=grant-open]").count(), 0);
  await sql(`UPDATE "User" SET role='OWNER' WHERE id=$1`, [user]);

  log("a paused workspace's links go dark");
  await sql(`UPDATE "Organization" SET status='PAUSED' WHERE id=$1`, [org]);
  await guest.goto(`${BASE}/p/${danaToken}`);
  await guest.getByText("This link is turned off").waitFor();
  await crewPage.goto(`${BASE}/p/${crewToken}`);
  await crewPage.getByText("This link is turned off").waitFor();
  await sql(`UPDATE "Organization" SET status='ACTIVE' WHERE id=$1`, [org]);

  log("deleting the last copy of a photo takes the file out of the store");
  await page.goto(FILES);
  await tile(page, "plain.png").locator("[data-testid=delete-media]").click();
  await waitFor(async () => Number((await one(`SELECT count(*) n FROM "Upload" WHERE "storageKey"=$1`, [plain.storageKey])).n) === 0, "row gone");
  assert.equal(fs.existsSync(path.join(STORE, plain.storageKey)), false);

  log("the store refuses an upload or read without a valid ticket");
  const forged = await guest.request.put(`${BASE}/api/storage/local?t=bogus.ticket`, { headers: { "content-type": "image/png" }, data: PNG });
  assert.equal(forged.status(), 403);
  assert.equal((await guest.request.get(`${BASE}/api/storage/local?t=bogus.ticket`)).status(), 404);

  log("clean up the workspace and its files");
  const keys = (await sql(`SELECT DISTINCT "storageKey" FROM "Upload" WHERE "organizationId"=$1 AND "storageKey" IS NOT NULL`, [org])).rows;
  for (const { storageKey } of keys) fs.rmSync(path.join(STORE, storageKey), { force: true });
  await sql(`DELETE FROM "Organization" WHERE id=$1`, [org]);

  await browser.close();
  catcher.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
