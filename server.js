// Minimal server utan beroenden: serverar index.html och proxar API-anrop
// till kommunens EDP FutureWeb-tjänst (webbläsaren stoppas annars av CORS).
// Start: node server.js  →  http://localhost:8080
const http = require("http");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://futureweb.stenungsund.se/FutureWebBasic/SimpleWastePickup";
const PORT = process.env.PORT || 8080;
const ALLOWED = new Set(["SearchAdress", "GetWastePickupSchedule"]);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    const endpoint = url.pathname.slice("/api/".length);
    if (!ALLOWED.has(endpoint)) {
      res.writeHead(404).end("Unknown endpoint");
      return;
    }
    try {
      const body = req.method === "POST"
        ? await new Promise((resolve, reject) => {
            let data = "";
            req.on("data", c => { data += c; });
            req.on("end", () => resolve(data));
            req.on("error", reject);
          })
        : undefined;
      const headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (compatible; hamtschema-app)"
      };
      if (body) headers["Content-Type"] = req.headers["content-type"] || "application/x-www-form-urlencoded";
      const upstream = await fetch(API_BASE + "/" + endpoint + url.search, {
        method: req.method,
        headers,
        body
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        console.error(`Upstream ${endpoint}: HTTP ${upstream.status} – ${text.slice(0, 200)}`);
      }
      res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
      res.end(text);
    } catch (err) {
      console.error(`Proxyfel mot ${API_BASE}/${endpoint}:`, err.cause || err);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxyn kunde inte nå kommunens tjänst", detail: String(err.cause || err) }));
    }
    return;
  }

  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  fs.readFile(path.join(__dirname, safe), (err, data) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    const type = safe.endsWith(".html") ? "text/html; charset=utf-8"
      : safe.endsWith(".js") ? "text/javascript"
      : safe.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
    const headers = { "Content-Type": type };
    // Typsnittet är versionerat i filnamnet och ändras inte – låt det cachas.
    if (safe.endsWith(".woff2")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Hämtschema-appen körs på http://localhost:${PORT}`);
});
