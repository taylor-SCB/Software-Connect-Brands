/* A stand-in for the Claude Messages API, for browser suites (Nov 12, 2026,
 * the AI release). Nothing leaves the machine.
 *
 * Start the app server with
 *   ANTHROPIC_API_KEY=test-key
 *   ANTHROPIC_ENDPOINT=http://localhost:3995
 * (run-suites.sh's "ai" group does). askClaude (src/lib/ai.ts) labels every
 * request to a stand-in with its AiRequest kind in the x-scb-ai-kind header,
 * so answers are picked by kind, never by matching prompt text.
 *
 *   const { startFakeClaude } = require("./fake-claude.cjs");
 *   const claude = await startFakeClaude();            // port 3995
 *   claude.reply("BRIEF", { lines: ["..."] });          // the JSON askClaude parses
 *   claude.reply("BRIEF", (req) => ({ ... }));          // or worked out per request
 *   claude.refuse("BRIEF");  claude.cutOff("BRIEF");  claude.garbage("BRIEF");
 *   claude.fail("BRIEF", 529);                          // an API error status
 *   const req = claude.last("BRIEF");                   // { kind, system, text, images, documents, body }
 *   claude.count("BRIEF");  claude.clear();  await claude.close();
 *
 * `text` is every text block (and a plain-string prompt) joined; `images`
 * is the number of image blocks; `documents` lists each document block as
 * { kind: "pdf" | "text", title, text } (text only for text documents).
 * A kind with no reply set answers "{}", which most helper schemas refuse,
 * so a step that forgets to set one fails loudly.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose, like every suite */
const http = require("node:http");

function startFakeClaude({ port = Number(process.env.FAKE_CLAUDE_PORT || 3995) } = {}) {
  const replies = new Map();
  const requests = [];

  function summarise(kind, body) {
    const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? "");
    const content = body.messages?.[0]?.content ?? "";
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const images = blocks.filter((b) => b.type === "image").length;
    const documents = blocks
      .filter((b) => b.type === "document")
      .map((b) => ({
        kind: b.source?.type === "text" ? "text" : "pdf",
        title: b.title ?? null,
        text: b.source?.type === "text" ? b.source.data : null,
      }));
    return { kind, system, text, images, documents, body };
  }

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const kind = String(req.headers["x-scb-ai-kind"] || "UNKNOWN");
      const request = summarise(kind, body);
      requests.push(request);
      let answer = replies.get(kind) ?? { text: "{}", stop: "end_turn" };
      if (typeof answer === "function") answer = answer(request);
      if (answer && answer.status) {
        res.statusCode = answer.status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "stand-in failure" } }));
        return;
      }
      if (!answer || typeof answer.text !== "string") answer = { text: JSON.stringify(answer ?? {}), stop: "end_turn" };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `msg_test_${requests.length}`,
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: answer.text }],
          stop_reason: answer.stop ?? "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });

  const api = {
    requests,
    // A JSON value (sent as Claude's text), a function of the request
    // returning one, or { text, stop } / { status } for full control.
    reply(kind, value) {
      if (typeof value === "function") {
        replies.set(kind, (request) => {
          const out = value(request);
          return out && (typeof out.text === "string" || out.status) ? out : { text: JSON.stringify(out), stop: "end_turn" };
        });
      } else if (value && (typeof value.text === "string" || value.status)) {
        replies.set(kind, value);
      } else {
        replies.set(kind, { text: JSON.stringify(value), stop: "end_turn" });
      }
    },
    refuse(kind) {
      replies.set(kind, { text: "", stop: "refusal" });
    },
    cutOff(kind) {
      replies.set(kind, { text: '{"cut', stop: "max_tokens" });
    },
    garbage(kind) {
      replies.set(kind, { text: "not json at all", stop: "end_turn" });
    },
    fail(kind, status = 500) {
      replies.set(kind, { status });
    },
    last(kind) {
      return [...requests].reverse().find((row) => row.kind === kind) ?? null;
    },
    count(kind) {
      return requests.filter((row) => row.kind === kind).length;
    },
    clear() {
      requests.length = 0;
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(api));
  });
}

module.exports = { startFakeClaude };
