// Local-only frontend server. Production continues to use vercel.json.
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv.includes("--production") ? path.join(__dirname, "dist") : __dirname;
const port = Number(process.env.FRONTEND_PORT || 3001);
const apiTarget = new URL(process.env.BACKEND_URL || (process.env.BACKEND_PORT ? `http://127.0.0.1:${Number(process.env.BACKEND_PORT)}` : "https://muraderp-api-jy6eophhla-el.a.run.app"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://localhost:${port}`).pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const transport = apiTarget.protocol === "https:" ? https : http;
    const upstream = transport.request(new URL(request.url, apiTarget), { method: request.method, headers: { ...request.headers, host: apiTarget.host } }, (result) => {
      const headers = { ...result.headers };
      // This server binds only to loopback HTTP. Keep HttpOnly/SameSite, but
      // match the local backend's non-Secure cookie policy when proxying HTTPS.
      if (headers["set-cookie"]) headers["set-cookie"] = headers["set-cookie"].map(cookie => cookie.replace(/;\s*Secure\b/gi, ""));
      response.writeHead(result.statusCode, headers);
      result.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "ERP API could not be reached. Please retry." } }));
    });
    upstream.setTimeout(70000, () => upstream.destroy(new Error("ERP request timed out")));
    request.pipe(upstream);
    return;
  }

  let relative;
  try { relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname); }
  catch { response.writeHead(400).end(); return; }
  const file = path.resolve(root, `.${relative}`);
  if (!file.startsWith(root + path.sep) || !types[path.extname(file)]) { response.writeHead(404).end(); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": types[path.extname(file)], "cache-control": "no-store" });
    fs.createReadStream(file).pipe(response);
  });
}).listen(port, "127.0.0.1", () => console.log(`MuradERP frontend: http://localhost:${port} (API: ${apiTarget.origin})`));
