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
    for (const p of ["/server.js", "/probe-api.js", "/README.md", "/docker-compose.yml"]) {
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
