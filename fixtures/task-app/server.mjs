import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 3200);
const dir = path.dirname(fileURLToPath(import.meta.url));

// The ticket (TASK-7 AC3) caps a title at 80 characters. The server uses 100.
const TITLE_MAX = 80;
const PLANTED_MAX = 100;

const server = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = await readFile(path.join(dir, "public", "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && req.url === "/api/tasks") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let title = "";
    let priority = "low";
    try {
      ({ title = "", priority = "low" } = JSON.parse(body || "{}"));
    } catch {
      /* ignore malformed body */
    }

    const trimmed = String(title).trim();
    if (trimmed === "") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Title is required" }));
      return;
    }

    // PLANTED BUG (ticket AC3): the limit must be TITLE_MAX (80). This uses
    // PLANTED_MAX (100), so a 90-char title is wrongly accepted. A boundary
    // test for AC3 exposes it — the agent should file a finding, not a green test.
    if (trimmed.length > PLANTED_MAX) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: `Title must be ${TITLE_MAX} characters or fewer` }));
      return;
    }

    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, task: { title: trimmed, priority } }));
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`task-app on http://localhost:${PORT}`));
