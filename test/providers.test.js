// BDD-tester för kommunlistan. Kör: node --test
//
// Kommunerna står på två ställen: PROVIDERS i server.js (proxyns allowlist,
// bara bas-URL:er) och PROVIDERS i index.html (UI:t, med etikett och källänk).
// De måste hållas i synk – annars kan besökaren välja en kommun som proxyn
// vägrar, eller tvärtom. Testerna här är det som gör synken kontrollerbar.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { PROVIDERS: SERVER_PROVIDERS } = require("../server.js");

// Läser ut kommunerna ur index.html med textmatchning i stället för att
// köra koden – en testfil ska inte evaluera det den granskar.
function uiProviders() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const start = html.indexOf("const PROVIDERS = {");
  assert.notEqual(start, -1, "PROVIDERS ska finnas i index.html");
  const open = html.indexOf("{", start);
  let depth = 0, end = -1;
  for (let i = open; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1, "PROVIDERS-objektet ska vara balanserat");
  const body = html.slice(open + 1, end - 1);

  // Varje kommun inleds på fyra stegs indrag: `  nyckel: {` eller `  "nyckel": {`.
  const providers = {};
  const entry = /^ {4}"?([a-z0-9-]+)"?:\s*\{$/gm;
  const field = name => new RegExp('^ {6}' + name + ':\\s*"([^"]*)"', "m");
  const starts = [];
  let m;
  while ((m = entry.exec(body))) starts.push({ key: m[1], at: m.index });
  for (let i = 0; i < starts.length; i++) {
    const chunk = body.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : body.length);
    const pick = name => (chunk.match(field(name)) || [])[1];
    providers[starts[i].key] = { base: pick("base"), label: pick("label"), site: pick("site") };
  }
  return providers;
}

describe("Egenskap: kommunlistan är densamma i proxyn och i gränssnittet", () => {
  it("Givet de två listorna, när de jämförs, så innehåller de samma kommuner", () => {
    const ui = Object.keys(uiProviders());
    // Utan den här kontrollen skulle en formatändring i index.html göra att
    // testet inte hittar någon kommun alls – och då passera tyst.
    assert.ok(ui.length > 0, "ingen kommun lästes ur index.html – har formatet ändrats?");
    assert.deepEqual(ui.sort(), Object.keys(SERVER_PROVIDERS).sort());
  });

  it("Givet en kommun, när dess bas-URL jämförs mellan listorna, så är den identisk", () => {
    const ui = uiProviders();
    for (const [key, base] of Object.entries(SERVER_PROVIDERS)) {
      assert.equal(ui[key].base, base, key + " har olika bas-URL i server.js och index.html");
    }
  });
});

// Kommuner som lagts till efter kartläggningen 2026-08-04. Bas-URL:erna står
// här också, inte för att upprepa koden, utan för att testet ska gå sönder om
// någon ändrar en URL utan att ha provat den mot kommunens tjänst först.
// Varje rad är verifierad i båda stegen (SearchAdress + GetWastePickupSchedule).
const VERIFIED_2026_08_04 = {
  kungalv: "https://minasidor-va-avfall.kungalv.se/FutureWeb/SimpleWastePickup",
  lerum: "https://vatjanst.lerum.se/FutureWeb/SimpleWastePickup",
  ale: "https://edp.ale.se/FutureWeb/SimpleWastePickup",
  partille: "https://vatjanst.partille.se/FutureWeb/SimpleWastePickup",
  lund: "https://eservice431601.lund.se/Lund/FutureWeb/SimpleWastePickup",
  kristianstad: "https://edp.kristianstad.se/FutureWeb/SimpleWastePickup",
  merab: "https://edpmobile.merab.se/FutureWeb/SimpleWastePickup",
  gotland: "https://edpfuture.gotland.se/FutureWeb/SimpleWastePickup",
  "vivab-falkenberg": "https://minasidor.vivab.info/FutureWebFalken/SimpleWastePickup",
  "vivab-varberg": "https://minasidor.vivab.info/FutureWebVarberg/SimpleWastePickup",
  hudiksvall: "https://futureweb.hudiksvall.se/FutureWeb/SimpleWastePickup",
  kramfors: "https://futureweb.kramfors.se/EDPFutureWeb/SimpleWastePickup",
  solleftea: "https://futureweb.solleftea.se/FutureWeb/SimpleWastePickup",
  june: "https://minasidor.juneavfall.se/FutureWebJuneBasic/SimpleWastePickup",
  ludvika: "https://futureweb.wbab.se/EDPFutureWeb/SimpleWastePickup"
};

describe("Egenskap: kommunerna från kartläggningen 2026-08-04 finns med", () => {
  it("Givet de verifierade kommunerna, när listan läses, så finns var och en med sin provade bas-URL", () => {
    for (const [key, base] of Object.entries(VERIFIED_2026_08_04)) {
      assert.equal(SERVER_PROVIDERS[key], base, key + " saknas eller har en oprövad bas-URL");
    }
  });
});

describe("Egenskap: varje kommun presenteras ärligt för besökaren", () => {
  it("Givet en kommun i listan, så har den ett läsbart namn och en källänk", () => {
    for (const [key, p] of Object.entries(uiProviders())) {
      assert.ok(p.label && p.label.trim(), key + " saknar etikett");
      assert.match(p.site || "", /^https:\/\//, key + " saknar människoläsbar källänk");
    }
  });

  it("Givet en bas-URL, så pekar den på kommunens EDP-tjänst över https", () => {
    for (const [key, base] of Object.entries(SERVER_PROVIDERS)) {
      assert.match(base, /^https:\/\//, key + " ska anropas över https");
      assert.match(base, /\/SimpleWastePickup$/, key + " ska peka på SimpleWastePickup");
    }
  });
});
