const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const products = [
  { id: 10, name: "Premium Cement", sku: "CEM-001", unit: "bag", sale_price: 1200 },
  { id: 20, name: "First Class Bricks", sku: "BRK-001", unit: "piece", sale_price: 18 },
  { id: 30, name: "Cable 1.5mm", sku: "CBL-15", unit: "roll", sale_price: 250 },
];

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function body(request) {
  return new Promise((resolve) => {
    let value = "";
    request.on("data", (part) => { value += part; });
    request.on("end", () => resolve(value ? JSON.parse(value) : {}));
  });
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost:4173");
  if (url.pathname === "/api/v1/auth/session") return json(response, 401, { error: { message: "Signed out" } });
  if (url.pathname === "/api/v1/customers") return json(response, 200, { data: [{ id: 7, name: "Ali Traders", phone: "0300 1234567", city: "Raiwind Road, Lahore" }] });
  if (url.pathname === "/api/v1/products") return json(response, 200, { data: products });
  if (url.pathname === "/api/v1/estimates/rate-lists") return json(response, 200, { data: [{ id: 4, name: "GM", code: "GM" }, { id: 5, name: "Pakistan Cables", code: "PAK-CABLES" }, { id: 6, name: "Popular", code: "POPULAR" }] });
  if (url.pathname === "/api/v1/estimates/rate-list-preview" && request.method === "POST") {
    const input = await body(request);
    const rates = input.target_rate_list_id === 5 ? { 10: 1275, 20: 19, 30: 270 } : input.target_rate_list_id === 6 ? { 10: 1300, 20: 20 } : { 10: 1225, 20: 18.5, 30: 255 };
    const lines = input.lines.map((line, index) => ({ line_number: index + 1, product_id: line.product_id, old_rate: line.current_unit_price, new_rate: rates[line.product_id] ?? null, status: rates[line.product_id] == null ? "UNMATCHED" : "MATCHED", message: rates[line.product_id] == null ? "No authorized rate was found for this item." : null }));
    const matched = lines.filter((line) => line.status === "MATCHED").length;
    return json(response, 200, { data: { rate_list: { id: input.target_rate_list_id, name: input.target_rate_list_id === 5 ? "Pakistan Cables" : "Selected" }, lines, matched, needs_review: lines.length - matched, can_apply: matched === lines.length } });
  }
  if (url.pathname === "/api/v1/estimates" && request.method === "POST") {
    const input = await body(request);
    return json(response, 201, { data: { id: 91, definition: { estimate_number: input.estimate_number } } });
  }
  if (/^\/api\/v1\/estimates\/\d+\/whatsapp-share$/.test(url.pathname)) return json(response, 200, { data: { share_url: "https://wa.me/?text=Estimate", message: "Please find your Estimate PDF from Murad Building Materials Store.", phone: "923001234567", document_name: "Estimate.pdf" } });

  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return json(response, 404, { error: { message: "Not found" } });
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
  response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  return fs.createReadStream(file).pipe(response);
}).listen(4173, "127.0.0.1");
