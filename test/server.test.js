// BDD-tester för server.js med Nodes inbyggda testrigg – inga beroenden.
// Kör: node --test
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { createHandler } = require("../server.js");

// Startar en riktig HTTP-server på en ledig port, med möjlighet att byta ut
// fetch så att testerna aldrig går ut på nätet.
function startServer(opts) {
  const server = http.createServer(createHandler(opts));
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}
const base = server => `http://127.0.0.1:${server.address().port}`;

describe("Egenskap: appen serveras till besökaren", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server.close());

  it("Givet en besökare, när hen hämtar startsidan, så svarar servern med appens HTML", async () => {
    const res = await fetch(base(server) + "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.match(await res.text(), /töms mitt kärl/i);
  });

  it("Givet en besökare, när webbläsaren hämtar logikmodulen, så serveras den som javascript", async () => {
    const res = await fetch(base(server) + "/logic.js");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /javascript/);
  });

  it("Givet en besökare, när webbläsaren hämtar typsnittet, så cachas det som oföränderligt", async () => {
    const res = await fetch(base(server) + "/familjen-grotesk.woff2");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "font/woff2");
    assert.match(res.headers.get("cache-control"), /immutable/);
  });

  it("Givet en okänd sökväg, när den efterfrågas, så blir svaret 404", async () => {
    const res = await fetch(base(server) + "/finns-inte.html");
    assert.equal(res.status, 404);
  });
});

describe("Egenskap: bara appens egna filer exponeras", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server.close());

  it("Givet att serverkoden ligger i samma katalog, när någon försöker hämta den, så vägras det", async () => {
    for (const p of ["/server.js", "/probe-api.js", "/README.md", "/docker-compose.yml",
                     "/notify.js", "/reminders.js", "/ratelimit.js", "/.env", "/data/reminders.json"]) {
      const res = await fetch(base(server) + p);
      assert.equal(res.status, 404, p + " ska inte serveras");
    }
  });

  it("Givet en angripare, när hen försöker gå utanför webbroten, så vägras det", async () => {
    // fetch normaliserar "../" i URL:er, så traversal-försöken skickas som
    // råa request-rader direkt på socketen.
    const attempts = [
      "/../server.js",
      "/../../etc/passwd",
      "/..%2f..%2fetc/passwd",
      "/%2e%2e/server.js",
      "//etc/passwd",
      "/foo/../server.js"
    ];
    for (const p of attempts) {
      const status = await new Promise((resolve, reject) => {
        const req = http.request({
          host: "127.0.0.1", port: server.address().port, path: p, method: "GET"
        }, res => { res.resume(); resolve(res.statusCode); });
        req.on("error", reject);
        req.end();
      });
      assert.equal(status, 404, p + " ska vägras");
    }
  });
});

describe("Egenskap: proxyn vidarebefordrar bara kända kommun-anrop", () => {
  let server;
  const calls = [];
  const fetchStub = async (url, opts) => {
    calls.push({ url, opts });
    return new Response('{"Succeeded":true}', {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  };
  before(async () => { server = await startServer({ fetchImpl: fetchStub }); });
  after(() => server.close());

  it("Givet en adress-sökning, när den skickas till /api/<kommun>/SearchAdress, så vidarebefordras den till kommunens tjänst", async () => {
    calls.length = 0;
    const res = await fetch(base(server) + "/api/herrljunga-vargarda/SearchAdress", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "searchText=Storgatan"
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { Succeeded: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://edpfuture.remondis.se/EDPFutureWeb/SimpleWastePickup/SearchAdress");
    assert.equal(calls[0].opts.body, "searchText=Storgatan");
  });

  it("Givet en äldre klient utan kommun i sökvägen, när den anropar /api/SearchAdress, så antas Stenungsund", async () => {
    calls.length = 0;
    await fetch(base(server) + "/api/SearchAdress", { method: "POST", body: "searchText=x" });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/futureweb\.stenungsund\.se\//);
  });

  it("Givet en okänd kommun eller okänt endpoint, när det anropas, så blir svaret 404 utan att något vidarebefordras", async () => {
    calls.length = 0;
    for (const p of ["/api/finnsinte/SearchAdress", "/api/stenungsund/DeleteEverything"]) {
      const res = await fetch(base(server) + p);
      assert.equal(res.status, 404, p);
    }
    assert.equal(calls.length, 0);
  });

  it("Givet en angripare, när hen använder prototypnycklar som kommun, så blir svaret 404", async () => {
    calls.length = 0;
    for (const key of ["__proto__", "constructor", "hasOwnProperty"]) {
      const res = await fetch(base(server) + `/api/${key}/SearchAdress`);
      assert.equal(res.status, 404, key + " ska inte slå upp något");
    }
    assert.equal(calls.length, 0);
  });

  it("Givet extra sökvägssegment efter endpointet, när det anropas, så blir svaret 404", async () => {
    calls.length = 0;
    const res = await fetch(base(server) + "/api/stenungsund/SearchAdress/extra");
    assert.equal(res.status, 404);
    assert.equal(calls.length, 0);
  });

  it("Givet andra HTTP-metoder än GET och POST, när de används mot proxyn, så blir svaret 405", async () => {
    calls.length = 0;
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      const res = await fetch(base(server) + "/api/stenungsund/SearchAdress", { method });
      assert.equal(res.status, 405, method + " ska vägras");
    }
    assert.equal(calls.length, 0);
  });

  it("Givet en orimligt stor request-body, när den skickas, så avvisas den med 413", async () => {
    calls.length = 0;
    const res = await fetch(base(server) + "/api/stenungsund/SearchAdress", {
      method: "POST",
      body: "searchText=" + "x".repeat(64 * 1024)
    });
    assert.equal(res.status, 413);
    assert.equal(calls.length, 0);
  });

  it("Givet en hängande kommun-tjänst, när proxyn anropar den, så finns en timeout-signal som avbryter", async () => {
    calls.length = 0;
    await fetch(base(server) + "/api/stenungsund/SearchAdress", { method: "POST", body: "searchText=x" });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].opts.signal instanceof AbortSignal, "fetch ska få en AbortSignal");
  });
});

describe("Egenskap: opt-in till påminnelser via API:t", () => {
  let server;
  const subscriptions = [];
  const remindersStub = {
    subscribe: (provider, building) => {
      if (provider !== "stenungsund" || typeof building !== "string" || !building) return null;
      subscriptions.push({ provider, building });
      return "hamtning-deadbeefdeadbeef";
    }
  };
  before(async () => { server = await startServer({ reminders: remindersStub }); });
  after(() => server.close());

  it("Givet en giltig anmälan, när den POSTas till /api/remind, så svarar servern med topic och serveradress", async () => {
    const res = await fetch(base(server) + "/api/remind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "stenungsund", building: "Storgatan 1, Orten (123)" })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.topic, "hamtning-deadbeefdeadbeef");
    assert.equal(data.server, "https://notify.neomeda.eu");
    assert.deepEqual(subscriptions.at(-1), { provider: "stenungsund", building: "Storgatan 1, Orten (123)" });
  });

  it("Givet en ogiltig anmälan, när kommunen är okänd eller bodyn trasig, så blir svaret 400", async () => {
    for (const body of [JSON.stringify({ provider: "finnsinte", building: "X 1" }), "inte json", "{}"]) {
      const res = await fetch(base(server) + "/api/remind", { method: "POST", body });
      assert.equal(res.status, 400, body);
    }
  });

  it("Givet andra metoder än POST, när de används mot /api/remind, så blir svaret 405", async () => {
    const res = await fetch(base(server) + "/api/remind");
    assert.equal(res.status, 405);
  });

  it("Givet en server utan påminnelsetjänst, när /api/remind anropas, så blir svaret 404 som allt annat okänt", async () => {
    const bare = await startServer();
    const res = await fetch(base(bare) + "/api/remind", { method: "POST", body: "{}" });
    assert.equal(res.status, 404);
    bare.close();
  });
});

describe("Egenskap: driftlarmet kopplas in när kommunens tjänst felar", () => {
  let server;
  const alarms = [];
  let mode = "ok";
  const fetchStub = async () => {
    if (mode === "throw") throw new Error("ECONNREFUSED upstream");
    if (mode === "500") return new Response("boom", { status: 500 });
    if (mode === "404") return new Response("not found", { status: 404 });
    return new Response("{}", { status: 200 });
  };
  before(async () => {
    server = await startServer({ fetchImpl: fetchStub, alarm: (provider, detail) => alarms.push({ provider, detail }) });
  });
  after(() => server.close());

  it("Givet ett nätverksfel mot kommunen, när proxyn anropas, så larmas kommunen", async () => {
    alarms.length = 0; mode = "throw";
    const res = await fetch(base(server) + "/api/boras/SearchAdress", { method: "POST", body: "searchText=x" });
    assert.equal(res.status, 502);
    assert.equal(alarms.length, 1);
    assert.equal(alarms[0].provider, "boras");
    assert.match(alarms[0].detail, /ECONNREFUSED/);
  });

  it("Givet HTTP 500 från kommunen, när proxyn anropas, så larmas det också", async () => {
    alarms.length = 0; mode = "500";
    await fetch(base(server) + "/api/orebro/SearchAdress", { method: "POST", body: "searchText=x" });
    assert.equal(alarms.length, 1);
    assert.match(alarms[0].detail, /HTTP 500/);
  });

  it("Givet HTTP 404 från kommunen, när proxyn anropas, så larmas det inte – adressfel är inte driftfel", async () => {
    alarms.length = 0; mode = "404";
    await fetch(base(server) + "/api/orebro/SearchAdress", { method: "POST", body: "searchText=x" });
    assert.equal(alarms.length, 0);
  });
});

describe("Egenskap: API:t har en per-IP-spärr", () => {
  let server;
  const seenIps = [];
  let allowNext = true;
  const limits = {
    api: ip => { seenIps.push(ip); return allowNext; },
    remind: ip => { seenIps.push("remind:" + ip); return allowNext; }
  };
  before(async () => {
    server = await startServer({ fetchImpl: async () => new Response("{}", { status: 200 }), limits,
                                 reminders: { subscribe: () => "hamtning-feedfeedfeedfeed" } });
  });
  after(() => server.close());

  it("Givet att spärren slagit till, när ett API-anrop görs, så blir svaret 429", async () => {
    allowNext = false;
    const res = await fetch(base(server) + "/api/stenungsund/SearchAdress", { method: "POST", body: "searchText=x" });
    assert.equal(res.status, 429);
    const remind = await fetch(base(server) + "/api/remind", { method: "POST", body: "{}" });
    assert.equal(remind.status, 429);
    allowNext = true;
    const ok = await fetch(base(server) + "/api/stenungsund/SearchAdress", { method: "POST", body: "searchText=x" });
    assert.equal(ok.status, 200);
  });

  it("Givet nginx framför, när klientens IP avgörs, så räknas bara det sista XFF-ledet – det enda vår egen proxy skrivit", async () => {
    allowNext = true;
    seenIps.length = 0;
    // Klienten kan skriva egna led ("fejk") men nginx appendar alltid sin
    // faktiska motpart sist – det är den som gäller.
    await fetch(base(server) + "/api/stenungsund/SearchAdress", {
      method: "POST", body: "x",
      headers: { "X-Forwarded-For": "fejk.fejk.fejk.fejk, 203.0.113.9" }
    });
    assert.equal(seenIps[0], "203.0.113.9");
    seenIps.length = 0;
    // Klientskrivna CF-Connecting-IP kan förfalskas förbi Cloudflare och ignoreras.
    await fetch(base(server) + "/api/stenungsund/SearchAdress", {
      method: "POST", body: "x",
      headers: { "CF-Connecting-IP": "198.51.100.7", "X-Forwarded-For": "203.0.113.9" }
    });
    assert.equal(seenIps[0], "203.0.113.9");
    seenIps.length = 0;
    await fetch(base(server) + "/api/stenungsund/SearchAdress", { method: "POST", body: "x" });
    assert.equal(seenIps[0], "127.0.0.1");
  });

  it("Givet statiska filer, när de hämtas, så berörs de inte av spärren", async () => {
    allowNext = false;
    const res = await fetch(base(server) + "/");
    assert.equal(res.status, 200);
    allowNext = true;
  });
});
