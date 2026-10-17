// Local-only frontend server. Production continues to use vercel.json.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.FRONTEND_PORT || 3001);
const apiPort = Number(process.env.BACKEND_PORT || 3002);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://localhost:${port}`).pathname;
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    const upstream = http.request({ hostname: "localhost", port: apiPort, method: request.method, path: request.url, headers: request.headers }, (result) => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Local API is unavailable" } }));
    });
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
}).listen(port, "127.0.0.1", () => console.log(`MuradERP frontend: http://localhost:${port} (API: localhost:${apiPort})`));
