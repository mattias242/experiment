// BDD-tester för reminders.js – prenumerationer och utskick. Kör: node --test
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createReminderService } = require("../reminders.js");

const PROVIDERS = { stenungsund: "https://example.invalid/SimpleWastePickup" };

// Ett schema där Kärl 2 töms 6 augusti (imorgon, sett från 5 augusti).
const SCHEDULE = JSON.stringify({
  RhServices: [
    { WasteType: "FNI Kärl 2", BinType: { ContainerType: "Fyrfack", Code: "Kärl 2" }, NextWastePickup: "2026-08-06" },
    { WasteType: "FNI Kärl 1", BinType: { ContainerType: "Fyrfack", Code: "Kärl 1" }, NextWastePickup: "2026-08-20" }
  ]
});

function rig({ scheduleBody = SCHEDULE, fetchImpl } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hamtning-test-"));
  const dataFile = path.join(dir, "reminders.json");
  const sent = [];
  const fetches = [];
  const service = createReminderService({
    dataFile,
    providers: PROVIDERS,
    notify: async ev => { sent.push(ev); },
    fetchImpl: fetchImpl || (async url => {
      fetches.push(url);
      return new Response(scheduleBody, { status: 200 });
    }),
    log: { error: () => {}, warn: () => {} }
  });
  return { service, dataFile, sent, fetches };
}

describe("Egenskap: opt-in ger ett svårgissat eget topic", () => {
  it("Givet en giltig kommun och adress, när besökaren anmäler sig, så får hen ett slumpat hamtning-topic", () => {
    const { service } = rig();
    const topic = service.subscribe("stenungsund", "Storgatan 1, Orten (123)");
    assert.match(topic, /^hamtning-[a-f0-9]{16}$/);
  });

  it("Givet samma adress igen, när ett hushåll anmäler sig två gånger, så delar de topic", () => {
    const { service } = rig();
    const a = service.subscribe("stenungsund", "Storgatan 1, Orten (123)");
    const b = service.subscribe("stenungsund", "Storgatan 1, Orten (123)");
    const c = service.subscribe("stenungsund", "Annan väg 2, Orten (456)");
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("Givet en okänd kommun eller orimlig adress, när anmälan görs, så vägras den", () => {
    const { service } = rig();
    assert.equal(service.subscribe("finnsinte", "Storgatan 1"), null);
    assert.equal(service.subscribe("stenungsund", ""), null);
    assert.equal(service.subscribe("stenungsund", "x".repeat(300)), null);
    assert.equal(service.subscribe("stenungsund", 42), null);
  });

  it("Givet en omstart av servern, när lagret läses in igen, så finns prenumerationen kvar", () => {
    const { service, dataFile } = rig();
    const topic = service.subscribe("stenungsund", "Storgatan 1, Orten (123)");
    const reloaded = createReminderService({
      dataFile, providers: PROVIDERS, notify: async () => {},
      fetchImpl: async () => new Response("{}"), log: { error: () => {}, warn: () => {} }
    });
    assert.equal(reloaded.subscribe("stenungsund", "Storgatan 1, Orten (123)"), topic);
  });
});

describe("Egenskap: påminnelsen går ut kvällen före tömning", () => {
  it("Givet en prenumeration och tömning imorgon, när kontrollen körs, så notifieras rätt topic med rätt text", async () => {
    const { service, sent } = rig();
    const topic = service.subscribe("stenungsund", "Storgatan 1, Orten (123)");
    await service.checkNow({ todayStr: "2026-08-05" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].topic, topic);
    assert.equal(sent[0].title, "Kärl 2 töms imorgon");
    assert.equal(sent[0].body, "Kärl 2 töms torsdag 6 augusti.");
    assert.deepEqual(sent[0].tags, ["wastebasket"]);
    assert.match(sent[0].click, /^https:\/\/hamta\.neomeda\.eu/);
  });

  it("Givet att påminnelsen redan gått ut, när kontrollen körs igen samma kväll, så skickas ingen dubblett", async () => {
    const { service, sent } = rig();
    service.subscribe("stenungsund", "Storgatan 1, Orten (123)");
    await service.checkNow({ todayStr: "2026-08-05" });
    await service.checkNow({ todayStr: "2026-08-05" });
    assert.equal(sent.length, 1);
  });

  it("Givet att inget töms imorgon, när kontrollen körs, så skickas ingenting", async () => {
    const { service, sent } = rig();
    service.subscribe("stenungsund", "Storgatan 1, Orten (123)");
    await service.checkNow({ todayStr: "2026-08-10" });
    assert.equal(sent.length, 0);
  });

  it("Givet att kommunens tjänst är nere, när kontrollen körs, så överlever tjänsten och övriga prenumeranter får sitt", async () => {
    const calls = [];
    const { service, sent } = rig({
      fetchImpl: async url => {
        calls.push(url);
        if (calls.length === 1) throw new Error("ECONNREFUSED");
        return new Response(SCHEDULE, { status: 200 });
      }
    });
    service.subscribe("stenungsund", "Trasiga vägen 1, Orten (111)");
    service.subscribe("stenungsund", "Hela vägen 2, Orten (222)");
    await assert.doesNotReject(service.checkNow({ todayStr: "2026-08-05" }));
    assert.equal(sent.length, 1);
  });

  it("Givet ett dygn med utskick, när nästa tömning närmar sig, så nollställs spärren och nästa påminnelse går ut", async () => {
    const { service, sent } = rig();
    service.subscribe("stenungsund", "Storgatan 1, Orten (123)");
    await service.checkNow({ todayStr: "2026-08-05" });
    // Två veckor senare, kvällen före nästa tömning 20 augusti.
    await service.checkNow({ todayStr: "2026-08-19" });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].title, "Kärl 1 töms imorgon");
  });
});
