// BDD-tester för notify.js – ntfy-klienten. Kör: node --test
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { encodeTitle, createNotifier } = require("../notify.js");

// Avkodar en RFC 2047-titel tillbaka till klartext, för att kunna verifiera
// att kodningen är reversibel och inte bara "ser rätt ut".
function decodeTitle(encoded) {
  const m = encoded.match(/^=\?UTF-8\?B\?(.+)\?=$/);
  return m ? Buffer.from(m[1], "base64").toString("utf8") : encoded;
}

describe("Egenskap: titlar överlever HTTP-headers", () => {
  it("Givet en ren ASCII-titel, när den kodas, så lämnas den orörd", () => {
    assert.equal(encodeTitle("Pickup tomorrow"), "Pickup tomorrow");
  });

  it("Givet en titel med å/ä/ö, när den kodas, så blir den RFC 2047-kodad ASCII som går att avkoda tillbaka", () => {
    const encoded = encodeTitle("Kärl 2 töms imorgon");
    assert.match(encoded, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    assert.equal(decodeTitle(encoded), "Kärl 2 töms imorgon");
  });
});

// Fångar alla utgående anrop utan att gå ut på nätet.
function stubbedNotifier(overrides = {}) {
  const calls = [];
  const fetchImpl = overrides.fetchImpl || (async (url, opts) => {
    calls.push({ url, opts });
    return new Response('{"id":"abc"}', { status: 200 });
  });
  const logged = [];
  const log = { error: (...a) => logged.push(a.join(" ")), warn: (...a) => logged.push(a.join(" ")) };
  const notify = createNotifier({ fetchImpl, token: "tk_test", log, ...overrides });
  return { notify, calls, logged };
}

describe("Egenskap: varje notis når både sitt topic och firehosen", () => {
  it("Givet en händelse, när den notifieras, så POSTas den till sitt topic och till neomeda-all", async () => {
    const { notify, calls } = stubbedNotifier();
    await notify({
      topic: "hamtning-abc123",
      title: "Kärl 2 töms imorgon",
      body: "Kärl 2 töms torsdag 6 augusti.",
      tags: ["wastebasket"],
      click: "https://hamta.neomeda.eu/"
    });
    assert.equal(calls.length, 2);
    const urls = calls.map(c => c.url).sort();
    assert.deepEqual(urls, [
      "https://notify.neomeda.eu/hamtning-abc123",
      "https://notify.neomeda.eu/neomeda-all"
    ]);
  });

  it("Givet notisens innehåll, när den skickas, så har båda samma body, klicklänk och Bearer-token", async () => {
    const { notify, calls } = stubbedNotifier();
    await notify({ topic: "hamtning-abc123", title: "T", body: "Brödtext med åäö.", click: "https://hamta.neomeda.eu/" });
    for (const c of calls) {
      assert.equal(c.opts.body, "Brödtext med åäö.");
      assert.equal(c.opts.headers["Click"], "https://hamta.neomeda.eu/");
      assert.equal(c.opts.headers["Authorization"], "Bearer tk_test");
      assert.ok(c.opts.signal instanceof AbortSignal, "kort timeout ska finnas");
    }
  });

  it("Givet firehosens blandade avsändare, när notisen skickas dit, så prefixas titeln med appnamnet och slugen är första taggen", async () => {
    const { notify, calls } = stubbedNotifier();
    await notify({ topic: "hamtning-abc123", title: "Kärl 2 töms imorgon", body: "b", tags: ["wastebasket"] });
    const fire = calls.find(c => c.url.endsWith("/neomeda-all"));
    const own = calls.find(c => c.url.endsWith("/hamtning-abc123"));
    assert.equal(decodeTitle(fire.opts.headers["Title"]), "Hämtschema · Kärl 2 töms imorgon");
    assert.equal(decodeTitle(own.opts.headers["Title"]), "Kärl 2 töms imorgon");
    assert.equal(fire.opts.headers["Tags"], "hamtning,wastebasket");
    assert.equal(own.opts.headers["Tags"], "wastebasket");
  });

  it("Givet att alla headervärden måste vara ASCII, när titeln innehåller åäö, så är alla skickade headers ASCII-rena", async () => {
    const { notify, calls } = stubbedNotifier();
    await notify({ topic: "hamtning-abc123", title: "Kärl 2 töms imorgon", body: "b", tags: ["wastebasket"] });
    for (const c of calls) {
      for (const [k, v] of Object.entries(c.opts.headers)) {
        assert.match(String(v), /^[\x20-\x7e]*$/, `headern ${k} ska vara ASCII`);
      }
    }
  });
});

describe("Egenskap: notiser fäller aldrig huvudflödet", () => {
  it("Givet att ntfy-servern är nere, när en notis skickas, så kastas inget vidare – felet loggas", async () => {
    const { notify, logged } = stubbedNotifier({
      fetchImpl: async () => { throw new Error("ECONNREFUSED"); }
    });
    await assert.doesNotReject(notify({ topic: "hamtning-x", title: "T", body: "b" }));
    assert.ok(logged.some(l => /ECONNREFUSED/.test(l)), "felet ska loggas");
  });

  it("Givet att ena topicet felar, när notisen skickas, så går den andra ändå iväg", async () => {
    const calls = [];
    const { notify } = stubbedNotifier({
      fetchImpl: async (url, opts) => {
        calls.push(url);
        if (url.endsWith("/neomeda-all")) throw new Error("boom");
        return new Response("{}", { status: 200 });
      }
    });
    await notify({ topic: "hamtning-x", title: "T", body: "b" });
    assert.ok(calls.some(u => u.endsWith("/hamtning-x")), "apptopicet ska ändå få notisen");
  });

  it("Givet ett HTTP-fel från ntfy, när svaret kommer, så loggas det", async () => {
    const { notify, logged } = stubbedNotifier({
      fetchImpl: async () => new Response("forbidden", { status: 403 })
    });
    await notify({ topic: "hamtning-x", title: "T", body: "b" });
    assert.ok(logged.some(l => /403/.test(l)), "HTTP-status ska loggas");
  });
});

describe("Egenskap: utan token är notiser tyst avstängda", () => {
  it("Givet att NTFY_TOKEN saknas, när notifiern skapas, så loggas det en gång och inga anrop görs", async () => {
    const calls = [];
    const logged = [];
    const notify = createNotifier({
      fetchImpl: async (...a) => { calls.push(a); return new Response("{}"); },
      token: undefined,
      log: { error: () => {}, warn: (...a) => logged.push(a.join(" ")) }
    });
    assert.equal(logged.length, 1, "en varning vid uppstart");
    await notify({ topic: "hamtning-x", title: "T", body: "b" });
    await notify({ topic: "hamtning-x", title: "T2", body: "b2" });
    assert.equal(calls.length, 0, "inga nätverksanrop utan token");
    assert.equal(logged.length, 1, "ingen spam vid varje anrop");
  });
});

describe("Egenskap: driftlarm när en kommun-tjänst felar, utan spam", () => {
  const { createUpstreamAlarm } = require("../notify.js");

  function alarmRig(days) {
    const sent = [];
    let i = 0;
    const report = createUpstreamAlarm({
      notify: async ev => { sent.push(ev); },
      today: () => days[Math.min(i, days.length - 1)]
    });
    return { report, sent, nextDay: () => i++ };
  }

  it("Givet första felet för en kommun, när det rapporteras, så larmas apptopicet med kommunen i titeln", async () => {
    const { report, sent } = alarmRig(["2026-08-05"]);
    await report("boras", "HTTP 502 vid GetWastePickupSchedule");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].topic, "hamtning");
    assert.match(sent[0].title, /boras/);
    assert.match(sent[0].body, /HTTP 502/);
  });

  it("Givet upprepade fel samma dygn, när de rapporteras, så larmas det bara en gång per kommun", async () => {
    const { report, sent } = alarmRig(["2026-08-05"]);
    await report("boras", "fel 1");
    await report("boras", "fel 2");
    await report("orebro", "annat fel");
    assert.equal(sent.length, 2);
    assert.match(sent[0].title, /boras/);
    assert.match(sent[1].title, /orebro/);
  });

  it("Givet ett nytt dygn, när kommunen felar igen, så larmas det på nytt", async () => {
    const { report, sent, nextDay } = alarmRig(["2026-08-05", "2026-08-06"]);
    await report("boras", "fel");
    nextDay();
    await report("boras", "fel igen");
    assert.equal(sent.length, 2);
  });
});
