// Kontrollerar att datafilerna i docs/valdata hänger ihop med varandra och med
// kartgeometrin. Går något sönder i bygg-valdata.mjs eller bygg-valgeografi.mjs
// märks det här i stället för som tomma ytor på kartan.
// Kör: node --test
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { summera, forandringParti } = require("../docs/kartlogik.js");

const MAPP = path.join(__dirname, "..", "docs", "valdata");
const las = (fil) => JSON.parse(fs.readFileSync(path.join(MAPP, fil), "utf8"));
const koder = (fil, lager, falt) =>
  new Set(las(fil).objects[lager].geometries.map((g) => g.properties[falt]));

let meta; let omraden; let distrikt;

before(() => {
  meta = las("meta.json");
  omraden = las("omraden.json");
  distrikt = las("valdistrikt.json");
});

describe("valdatans innehåll", () => {
  it("gäller riksdagsvalet och har ett tidigare val att jämföra med", () => {
    assert.equal(meta.valtyp, "RD");
    assert.match(meta.valdatum, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(meta.tidigareValdatum, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(meta.tidigareValdatum < meta.valdatum);
  });

  it("har alla 29 valkretsar och alla 290 kommuner", () => {
    assert.equal(meta.valkretsar.length, 29);
    assert.equal(meta.kommuner.length, 290);
    assert.equal(Object.keys(omraden.vk).length, 29);
    assert.equal(Object.keys(omraden.km).length, 290);
  });

  it("har lika många valdistrikt som Valmyndigheten säger ska räknas", () => {
    assert.equal(distrikt.length, meta.antalValdistriktSomSkaRaknas);
  });

  it("ger varje område en rösträkning med en post per parti", () => {
    const n = meta.partier.length;
    assert.ok(n >= 8, "riksdagspartierna ska finnas med");
    for (const rad of [omraden.riket, ...Object.values(omraden.vk),
      ...Object.values(omraden.km), ...distrikt]) {
      assert.equal(rad.r.length, n);
      assert.equal(rad.r0.length, n);
    }
  });

  it("lägger varje kommun i en valkrets som finns", () => {
    const valkretsar = new Set(meta.valkretsar.map((v) => v.kod));
    for (const [kod, km] of Object.entries(omraden.km)) {
      assert.ok(valkretsar.has(km.vk), `${kod} ${km.namn} pekar på valkrets ${km.vk}`);
    }
  });

  it("lägger varje valdistrikt i en kommun och en valkrets som finns", () => {
    const kommuner = new Set(meta.kommuner.map((k) => k.kod));
    const valkretsar = new Set(meta.valkretsar.map((v) => v.kod));
    for (const d of distrikt) {
      assert.ok(kommuner.has(d.km), `${d.k} ${d.n} pekar på kommun ${d.km}`);
      assert.ok(valkretsar.has(d.vk), `${d.k} ${d.n} pekar på valkrets ${d.vk}`);
    }
  });
});

describe("summorna stämmer", () => {
  it("ger samma riksresultat som Valmyndighetens egen sammanställning", () => {
    // meta.partier kommer från rikets resultatfil, omraden.riket från samma
    // fil – men via vår egen omräkning. De ska landa på samma andelar.
    for (let i = 0; i < meta.partier.length; i++) {
      const vart = (omraden.riket.r[i] / omraden.riket.g) * 100;
      assert.ok(Math.abs(vart - meta.partier[i].andel) < 0.06,
        `${meta.partier[i].kort}: ${vart.toFixed(2)} mot ${meta.partier[i].andel}`);
    }
  });

  it("summerar valkretsarna till riket", () => {
    const s = summera(Object.values(omraden.vk));
    assert.equal(s.g, omraden.riket.g);
    assert.equal(s.g0, omraden.riket.g0);
    assert.deepEqual(s.r, omraden.riket.r);
  });

  it("summerar kommunerna till riket", () => {
    const s = summera(Object.values(omraden.km));
    assert.equal(s.g, omraden.riket.g);
    assert.deepEqual(s.r, omraden.riket.r);
  });

  it("summerar valdistrikten till kommunens 2026-siffror", () => {
    // Bara innevarande val: för 2022 saknar omritade distrikt jämförelsetal,
    // och det är just därför kommunerna har egna summor i omraden.json.
    const perKommun = new Map();
    for (const d of distrikt) {
      if (!perKommun.has(d.km)) perKommun.set(d.km, []);
      perKommun.get(d.km).push(d);
    }
    for (const [kod, delar] of perKommun) {
      assert.equal(summera(delar).g, omraden.km[kod].g,
        `${kod} ${omraden.km[kod].namn}`);
    }
  });

  it("har fler röstberättigade än avlagda röster överallt", () => {
    for (const d of distrikt) {
      if (!d.rb) continue;                // uppsamlingsdistrikt saknar egna väljare
      assert.ok(d.t <= d.rb, `${d.k} ${d.n}: ${d.t} röster på ${d.rb} röstberättigade`);
    }
  });

  it("saknar 2022-siffror just för de distrikt som är flaggade som ojämförbara", () => {
    for (const d of distrikt) {
      if (d.j) assert.ok(d.g0 > 0, `${d.k} ${d.n} sägs jämförbar men saknar 2022`);
      else assert.equal(d.g0, 0, `${d.k} ${d.n} sägs ojämförbar men har 2022-siffror`);
      if (!d.j) assert.equal(forandringParti(d, 0), null);
    }
  });
});

describe("geometrin hänger ihop med siffrorna", () => {
  it("har en valkretsyta för varje valkrets", () => {
    const ytor = koder("geografi-valkrets.json", "valkrets", "Riksdagsvalkretskod");
    for (const v of meta.valkretsar) assert.ok(ytor.has(v.kod), `${v.namn} saknar yta`);
  });

  it("har en kommunyta för varje kommun", () => {
    const ytor = koder("geografi-kommun.json", "kommun", "Kommunkod");
    assert.equal(ytor.size, 290);
    for (const k of meta.kommuner) assert.ok(ytor.has(k.kod), `${k.namn} saknar yta`);
  });

  it("har siffror för varje valdistriktsyta", () => {
    const ytor = koder("geografi-valdistrikt.json", "valdistrikt", "Valdistriktskod");
    const medSiffror = new Set(distrikt.map((d) => d.k));
    for (const kod of ytor) assert.ok(medSiffror.has(kod), `${kod} saknar siffror`);
  });

  it("saknar yta bara för uppsamlingsdistrikten", () => {
    // Uppsamlingsdistrikten – dit sena brev- och budröster går – har ingen
    // geografi. Alla andra distrikt ska gå att rita.
    const ytor = koder("geografi-valdistrikt.json", "valdistrikt", "Valdistriktskod");
    for (const d of distrikt) {
      if (ytor.has(d.k)) continue;
      assert.equal(d.k.length, 6,
        `${d.k} ${d.n} saknar yta men ser ut som ett vanligt valdistrikt`);
      assert.equal(d.rb, 0, `${d.k} ${d.n} saknar yta men har röstberättigade`);
    }
  });
});
