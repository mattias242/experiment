// BDD-tester för ratelimit.js – per-IP-spärren mot curl-loopar. Kör: node --test
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../ratelimit.js");

describe("Egenskap: en IP kan inte hamra API:t i loop", () => {
  it("Givet gränsen 3 per fönster, när en IP gör fyra anrop, så stoppas det fjärde", () => {
    let t = 0;
    const allow = createRateLimiter({ limit: 3, windowMs: 60000, now: () => t });
    assert.equal(allow("1.2.3.4"), true);
    assert.equal(allow("1.2.3.4"), true);
    assert.equal(allow("1.2.3.4"), true);
    assert.equal(allow("1.2.3.4"), false);
  });

  it("Givet att fönstret löpt ut, när IP:n återkommer, så räknas den från noll igen", () => {
    let t = 0;
    const allow = createRateLimiter({ limit: 1, windowMs: 60000, now: () => t });
    assert.equal(allow("1.2.3.4"), true);
    assert.equal(allow("1.2.3.4"), false);
    t = 60001;
    assert.equal(allow("1.2.3.4"), true);
  });

  it("Givet flera besökare, när en IP spärras, så påverkas inte de andra", () => {
    let t = 0;
    const allow = createRateLimiter({ limit: 1, windowMs: 60000, now: () => t });
    assert.equal(allow("1.2.3.4"), true);
    assert.equal(allow("1.2.3.4"), false);
    assert.equal(allow("5.6.7.8"), true);
  });

  it("Givet många olika IP:n över tid, när gamla fönster löpt ut, så växer inte minnet obegränsat", () => {
    let t = 0;
    const allow = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t, maxEntries: 100 });
    for (let i = 0; i < 500; i++) {
      allow("ip-" + i);
      t += 100; // var tionde iteration passerar ett helt fönster
    }
    assert.ok(allow.size() <= 101, "spärrlistan ska rensas, var " + allow.size());
  });
});
