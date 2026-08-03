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
