import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 3100);
const dir = path.dirname(fileURLToPath(import.meta.url));

const USER = { email: "user@test.com", password: "secret123", name: "user@test.com" };

const server = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = await readFile(path.join(dir, "public", "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && req.url === "/api/login") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let email = "";
    let password = "";
    try {
      ({ email = "", password = "" } = JSON.parse(body || "{}"));
    } catch {
      /* ignore malformed body */
    }

    // PLANTED BUG (ticket AC3): an empty email must return "Email is required".
    // Instead it falls through to the generic invalid-credentials path.
    if (email === USER.email && password === USER.password) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: USER.name }));
    } else {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Invalid credentials" }));
    }
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`login-app on http://localhost:${PORT}`));
