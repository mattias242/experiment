// Minimal server utan beroenden: serverar index.html och proxar API-anrop
// till kommunernas EDP FutureWeb-tjänster (webbläsaren stoppas annars av CORS).
// Start: node server.js  →  http://localhost:8080
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createRateLimiter, clientIp } = require("./ratelimit.js");
// Kommunlistan och översättningen till varje leverantörs API ligger i
// adapters.js, så att proxyn och påminnelsetjänsten delar samma källa.
const { PROVIDERS, adapterFor } = require("./adapters.js");

const PORT = process.env.PORT || 8080;
const ALLOWED = new Set(["SearchAdress", "GetWastePickupSchedule"]);
const MAX_BODY = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 15000;

// Explicit lista över det som får serveras – allt annat (inklusive den här
// filen) ger 404, så inget path traversal-skydd behöver "räcka till".
const FONT_HEADERS = {
  "Content-Type": "font/woff2",
  // Typsnittet är versionerat i filnamnet och ändras inte – låt det cachas.
  "Cache-Control": "public, max-age=31536000, immutable"
};
const STATIC = {
  "/": { file: "index.html", headers: { "Content-Type": "text/html; charset=utf-8" } },
  "/index.html": { file: "index.html", headers: { "Content-Type": "text/html; charset=utf-8" } },
  "/logic.js": { file: "logic.js", headers: { "Content-Type": "text/javascript; charset=utf-8" } },
  "/familjen-grotesk.woff2": { file: "familjen-grotesk.woff2", headers: FONT_HEADERS }
};

// Läser hela request-bodyn, eller null om den är orimligt stor.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", c => {
      if (data === null) return;
      size += c.length;
      // En adressökning är några hundra byte – allt större är oseriöst.
      if (size > MAX_BODY) { data = null; resolve(null); return; }
      data += c;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Hanteraren skapas via en fabrik så att testerna kan köra den på en egen
// port och byta ut fetch, påminnelsetjänsten, driftlarmet och spärrarna
// mot stubbar.
function createHandler({ fetchImpl = fetch, reminders, alarm, limits } = {}) {
  // En sökning är två anrop (adress + schema); 120/min stör ingen människa
  // men stoppar loopande skript. Gränsen har marginal för att besökare bakom
  // samma Cloudflare-edge delar hink (se clientIp). Opt-in behövs bara någon
  // enstaka gång och hålls stramare.
  const limit = limits || {
    api: createRateLimiter({ limit: 120 }),
    remind: createRateLimiter({ limit: 20 })
  };
  return async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Spärren gäller bara API:t – statiska filer är billiga och cachas ändå.
  if (url.pathname.startsWith("/api/")) {
    const allowed = url.pathname.startsWith("/api/remind") ? limit.remind(clientIp(req)) : limit.api(clientIp(req));
    if (!allowed) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
      res.end(JSON.stringify({ error: "För många anrop – vänta en stund." }));
      return;
    }
  }

  // Testnotis till ett redan registrerat topic, så att besökaren kan
  // verifiera sin prenumeration direkt.
  if (url.pathname === "/api/remind/test" && reminders) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Allow": "POST" }).end("Method not allowed");
      return;
    }
    let ok = false;
    try {
      const body = JSON.parse(await readBody(req));
      ok = typeof body.topic === "string" && await reminders.sendTest(body.topic);
    } catch (err) { /* trasig JSON → ok förblir false → 400 */ }
    res.writeHead(ok ? 200 : 400, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ok ? { ok: true } : { error: "Okänt topic" }));
    return;
  }

  // Opt-in till tömningspåminnelser: adressen registreras och besökaren får
  // sitt ntfy-topic tillbaka. Utan påminnelsetjänst finns endpointen inte.
  if (url.pathname === "/api/remind" && reminders) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Allow": "POST" }).end("Method not allowed");
      return;
    }
    let topic = null;
    try {
      const body = JSON.parse(await readBody(req));
      topic = reminders.subscribe(body.provider, body.building);
    } catch (err) { /* trasig JSON → topic förblir null → 400 */ }
    if (!topic) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Ogiltig anmälan" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ topic, server: "https://notify.neomeda.eu" }));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "POST") {
      res.writeHead(405, { "Allow": "GET, POST" }).end("Method not allowed");
      return;
    }
    // /api/<kommun>/<endpoint>; /api/<endpoint> (äldre klient) → Stenungsund.
    const parts = url.pathname.slice("/api/".length).split("/");
    const [providerKey, endpoint] = parts.length === 1 ? ["stenungsund", parts[0]] : parts;
    // Object.hasOwn: annars slår "__proto__" m.fl. upp saker på prototypen.
    const provider = Object.hasOwn(PROVIDERS, providerKey) ? PROVIDERS[providerKey] : undefined;
    const adapter = adapterFor(provider);
    if (parts.length > 2 || !adapter || !ALLOWED.has(endpoint)) {
      res.writeHead(404).end("Unknown endpoint");
      return;
    }
    try {
      const clientBody = req.method === "POST" ? await readBody(req) : undefined;
      if (clientBody === null) {
        res.writeHead(413).end("Request body too large");
        return;
      }
      // Adaptern översätter appens anrop till leverantörens API. För EDP är
      // det en ren vidarebefordran; för andra byggs anropet om.
      const call = adapter.request(provider, endpoint, {
        search: url.search,
        method: req.method,
        body: clientBody,
        contentType: req.headers["content-type"]
      });
      const upstream = await fetchImpl(call.url, {
        method: call.method,
        headers: call.headers,
        body: call.body,
        // Ge upp i stället för att låta en hängande kommun-tjänst hålla
        // anslutningar öppna hos oss.
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        console.error(`Upstream ${endpoint}: HTTP ${upstream.status} – ${text.slice(0, 200)}`);
        // 5xx är driftfel hos kommunen och värt ett larm; 4xx är bara ett
        // svar (t.ex. okänd adress) och vidarebefordras utan väsen.
        if (alarm && upstream.status >= 500) alarm(providerKey, `HTTP ${upstream.status} vid ${endpoint}.`);
        res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
        res.end(text);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(adapter.normalize(endpoint, text));
    } catch (err) {
      console.error(`Proxyfel mot ${providerKey}/${endpoint}:`, err.cause || err);
      if (alarm) alarm(providerKey, `${String(err.cause || err)} vid ${endpoint}.`);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxyn kunde inte nå kommunens tjänst", detail: String(err.cause || err) }));
    }
    return;
  }

  const entry = STATIC[url.pathname];
  if (!entry) { res.writeHead(404).end("Not found"); return; }
  fs.readFile(path.join(__dirname, entry.file), (err, data) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, entry.headers);
    res.end(data);
  });
  };
}

module.exports = { createHandler, PROVIDERS };

if (require.main === module) {
  const { createNotifier, createUpstreamAlarm } = require("./notify.js");
  const { createReminderService } = require("./reminders.js");
  const notify = createNotifier();
  const alarm = createUpstreamAlarm({ notify });
  const reminders = createReminderService({
    dataFile: path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "reminders.json"),
    providers: PROVIDERS,
    notify,
    alarm
  });
  reminders.start();
  http.createServer(createHandler({ reminders, alarm })).listen(PORT, () => {
    console.log(`Hämtschema-appen körs på http://localhost:${PORT}`);
  });
}
