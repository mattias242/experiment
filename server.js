// Minimal server utan beroenden: serverar index.html och proxar API-anrop
// till kommunernas EDP FutureWeb-tjänster (webbläsaren stoppas annars av CORS).
// Start: node server.js  →  http://localhost:8080
const http = require("http");
const fs = require("fs");
const path = require("path");

// Måste hållas i synk med PROVIDERS i index.html.
const PROVIDERS = {
  stenungsund: "https://futureweb.stenungsund.se/FutureWebBasic/SimpleWastePickup",
  boden: "https://edpmobile.boden.se/FutureWeb/SimpleWastePickup",
  boras: "https://kundportal.borasem.se/EDPFutureWeb/SimpleWastePickup",
  "herrljunga-vargarda": "https://edpfuture.remondis.se/EDPFutureWeb/SimpleWastePickup",
  kiruna: "https://kund.tekniskaverkenikiruna.se/FutureWebBasic/SimpleWastePickup",
  "kretslopp-sydost": "https://kundportal.kretsloppsydost.se/FutureWeb/SimpleWastePickup",
  lidkoping: "https://futureweb.lidkoping.se/FutureWebBasic/SimpleWastePickup",
  ljungby: "https://edpwebb.ljungby.se/FutureWeb/SimpleWastePickup",
  lycksele: "https://future.lycksele.se/FutureWeb/SimpleWastePickup",
  mark: "https://va-renhallning.mark.se/FutureWeb/SimpleWastePickup",
  nvoa: "https://futureweb.nvoa.se/EDP/FutureWebBasic/SimpleWastePickup",
  orebro: "https://futureweb.orebro.se/FutureWeb/SimpleWastePickup",
  orust: "https://va-renhallning-minasidor.orust.se/FutureWebBasic/SimpleWastePickup",
  skelleftea: "https://wwwtk2.skelleftea.se/FutureWeb/SimpleWastePickup",
  ssam: "https://edpfuture.ssam.se/FutureWeb/SimpleWastePickup",
  uppsalavatten: "https://futureweb.uppsalavatten.se/Uppsala/FutureWeb/SimpleWastePickup",
  vafabmiljo: "https://services.vafabmiljo.se/FutureWebVKFHus/SimpleWastePickup"
};
const PORT = process.env.PORT || 8080;
const ALLOWED = new Set(["SearchAdress", "GetWastePickupSchedule"]);

// Hanteraren skapas via en fabrik så att testerna kan köra den på en egen
// port och byta ut fetch mot en stub som aldrig går ut på nätet.
function createHandler({ fetchImpl = fetch } = {}) {
  return async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    // /api/<kommun>/<endpoint>; /api/<endpoint> (äldre klient) → Stenungsund.
    const parts = url.pathname.slice("/api/".length).split("/");
    const [providerKey, endpoint] = parts.length === 1 ? ["stenungsund", parts[0]] : parts;
    const API_BASE = PROVIDERS[providerKey];
    if (!API_BASE || !ALLOWED.has(endpoint)) {
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
      const upstream = await fetchImpl(API_BASE + "/" + endpoint + url.search, {
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
  };
}

module.exports = { createHandler, PROVIDERS };

if (require.main === module) {
  http.createServer(createHandler()).listen(PORT, () => {
    console.log(`Hämtschema-appen körs på http://localhost:${PORT}`);
  });
}
