/* A pretend faraway database for import-slow-db.cjs: listens on :5434 and
 * passes everything to the local Postgres on :5433, waiting DELAY ms
 * (default 8) each way, the way the live database across the internet
 * does. Local Postgres answers too fast to show timing bugs without it.
 *
 *   node scripts/browser-tests/slow-db-proxy.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose, like the suites */
const net = require("node:net");

const DELAY = Number(process.env.DELAY || 8);
net
  .createServer((client) => {
    const server = net.connect(5433, "127.0.0.1");
    const pipe = (from, to) => from.on("data", (data) => setTimeout(() => to.write(data), DELAY));
    pipe(client, server);
    pipe(server, client);
    const end = () => {
      client.destroy();
      server.destroy();
    };
    for (const socket of [client, server]) {
      socket.on("error", end);
      socket.on("close", end);
    }
  })
  .listen(5434, () => console.log(`slow proxy on :5434 -> :5433, ${DELAY} ms each way`));
