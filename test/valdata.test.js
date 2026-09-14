// Kontrollerar att datafilerna i docs/valdata hänger ihop med varandra och med
// kartgeometrin, för alla tre valen. Går något sönder i bygg-valdata.mjs eller
// bygg-valgeografi.mjs märks det här i stället för som tomma ytor på kartan.
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

// Gotland har inget regionfullmäktigeval – kommunen sköter regionens uppgifter.
// Länet, kommunen och kommunens valdistrikt finns alltså i geometrin men ska
// inte ha några siffror i regionvalet.
const UTAN_REGIONVAL = "09";
const saknasIRegionvalet = (valtyp, kod) =>
  valtyp === "RF" && String(kod).startsWith(UTAN_REGIONVAL);

let index; const val = {};

before(() => {
  index = las("val.json");
  for (const v of index.val) {
    val[v.kod] = {
      meta: las(`${v.kod}/meta.json`),
      omraden: las(`${v.kod}/omraden.json`),
      distrikt: las(`${v.kod}/valdistrikt.json`),
    };
  }
});

describe("indexet över valen", () => {
  it("listar riksdags-, region- och kommunvalet", () => {
    assert.deepEqual(index.val.map((v) => v.kod).sort(), ["KF", "RD", "RF"]);
  });

  it("jämför varje val med ett tidigare val samma dag", () => {
    for (const v of index.val) {
      assert.match(v.valdatum, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(v.tidigareValdatum < v.valdatum, v.kod);
      assert.equal(v.valdatum, index.val[0].valdatum, `${v.kod} har annat valdatum`);
    }
  });

  it("delar in de tre valen på olika sätt", () => {
    // Riksdagsvalet räknas i 29 valkretsar, regionvalet i 20 regioner (Gotland
    // saknas) och kommunvalet i 21 län.
    assert.equal(val.RD.meta.toppnivan.length, 29);
    assert.equal(val.RF.meta.toppnivan.length, 20);
    assert.equal(val.KF.meta.toppnivan.length, 21);
    assert.equal(val.RD.meta.toppNivan, "valkrets");
    assert.equal(val.RF.meta.toppNivan, "lan");
    assert.equal(val.KF.meta.toppNivan, "lan");
  });

  it("har alla kommuner utom Gotland i regionvalet", () => {
    assert.equal(val.RD.meta.kommuner.length, 290);
    assert.equal(val.KF.meta.kommuner.length, 290);
    assert.equal(val.RF.meta.kommuner.length, 289);
    assert.ok(!val.RF.meta.kommuner.some((k) => k.kod === "0980"));
  });
});

for (const valtyp of ["RD", "RF", "KF"]) {
  describe(`${valtyp}: innehållet`, () => {
    it("har lika många valdistrikt som ska räknas", () => {
      const { meta, distrikt } = val[valtyp];
      assert.equal(distrikt.length, meta.antalValdistriktSomSkaRaknas);
      assert.ok(distrikt.length > 6000, `bara ${distrikt.length} distrikt`);
    });

    it("har riksdagspartierna i partiregistret", () => {
      const kort = new Set(val[valtyp].meta.partier.map((p) => p.kort));
      for (const p of ["S", "M", "SD", "C", "V", "KD", "MP", "L"]) {
        assert.ok(kort.has(p), `${p} saknas`);
      }
    });

    it("ger varje parti en förkortning, ett namn och en färg", () => {
      for (const p of val[valtyp].meta.partier) {
        assert.ok(p.kod && p.kort && p.namn, JSON.stringify(p));
        assert.match(p.farg, /^(#|hsl)/, `${p.kort}: ${p.farg}`);
      }
    });

    it("slår upp varje områdes röster på partikod", () => {
      const { omraden, distrikt } = val[valtyp];
      const alla = [omraden.riket, ...Object.values(omraden.tp),
        ...Object.values(omraden.km), ...distrikt];
      for (const o of alla) {
        assert.equal(typeof o.r, "object");
        assert.ok(!Array.isArray(o.r));
        for (const [kod, antal] of Object.entries(o.r)) {
          assert.ok(antal > 0, `${kod} ligger i tabellen med ${antal} röster`);
        }
      }
    });

    it("lägger varje valdistrikt i en kommun och en toppnivå som finns", () => {
      const { meta, distrikt } = val[valtyp];
      const kommuner = new Set(meta.kommuner.map((k) => k.kod));
      const toppnivan = new Set(meta.toppnivan.map((t) => t.kod));
      for (const d of distrikt) {
        assert.ok(kommuner.has(d.km), `${d.k} ${d.n} pekar på kommun ${d.km}`);
        assert.ok(toppnivan.has(d.tp), `${d.k} ${d.n} pekar på toppnivå ${d.tp}`);
      }
    });

    it("lägger varje kommun i en toppnivå som finns", () => {
      const { meta } = val[valtyp];
      const toppnivan = new Set(meta.toppnivan.map((t) => t.kod));
      for (const k of meta.kommuner) {
        assert.ok(toppnivan.has(k.tp), `${k.namn} pekar på ${k.tp}`);
      }
    });
  });

  describe(`${valtyp}: summorna stämmer`, () => {
    it("summerar toppnivåerna till riket", () => {
      const { omraden } = val[valtyp];
      const s = summera(Object.values(omraden.tp));
      assert.equal(s.g, omraden.riket.g);
      assert.equal(s.g0, omraden.riket.g0);
      assert.deepEqual(s.r, omraden.riket.r);
    });

    it("summerar kommunerna till riket", () => {
      const { omraden } = val[valtyp];
      const s = summera(Object.values(omraden.km));
      assert.equal(s.g, omraden.riket.g);
      assert.deepEqual(s.r, omraden.riket.r);
    });

    it("summerar valdistrikten till kommunens 2026-siffror", () => {
      // Bara innevarande val: för 2022 saknar omritade distrikt jämförelsetal,
      // och det är just därför kommunerna har egna summor i omraden.json.
      // Det här testet fångade att Stockholms kommun i riksdagsvalet hämtades
      // från en kommunvalkrets i stället för från hela kommunen.
      const { omraden, distrikt } = val[valtyp];
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

    it("räknar rätt antal distrikt per område", () => {
      const { omraden, distrikt } = val[valtyp];
      assert.equal(omraden.riket.ad, distrikt.length);
      assert.equal(Object.values(omraden.km).reduce((s, o) => s + o.ad, 0), distrikt.length);
      assert.equal(Object.values(omraden.tp).reduce((s, o) => s + o.ad, 0), distrikt.length);
    });

    it("har fler röstberättigade än avlagda röster, på enstaka undantag när", () => {
      // I ett slutligt resultat är fler röster än röstberättigade omöjligt. I
      // ett preliminärt händer det att röster råkar rapporteras på fel distrikt
      // på valnatten och rättas i onsdagsräkningen – Valmyndigheten visar då
      // själv över 100 % valdeltagande. Enstaka sådana släpper vi igenom, men
      // ett systematiskt fel i vår egen läsning ska fortfarande fastna.
      const { meta, distrikt } = val[valtyp];
      const omojliga = distrikt.filter((d) => d.rb && d.t > d.rb);
      const tak = meta.rakningstillfalle === 'slutlig' ? 0 : Math.ceil(distrikt.length / 1000);
      assert.ok(omojliga.length <= tak,
        `${omojliga.length} distrikt har fler röster än röstberättigade: ` +
        omojliga.slice(0, 5).map((d) => `${d.k} ${d.n} ${d.t}/${d.rb}`).join(', '));
    });

    it("saknar 2022-siffror just för de distrikt som är flaggade som ojämförbara", () => {
      for (const d of val[valtyp].distrikt) {
        if (d.j) assert.ok(d.g0 > 0, `${d.k} ${d.n} sägs jämförbar men saknar 2022`);
        else assert.equal(d.g0, 0, `${d.k} ${d.n} sägs ojämförbar men har 2022-siffror`);
        if (!d.j) assert.equal(forandringParti(d, "0002"), null);
      }
    });
  });

  describe(`${valtyp}: geometrin hänger ihop med siffrorna`, () => {
    it("har en yta för varje toppnivå", () => {
      const { meta } = val[valtyp];
      const ytor = meta.toppNivan === "lan"
        ? koder("geografi-lan.json", "lan", "Länskod")
        : koder("geografi-valkrets.json", "valkrets", "Riksdagsvalkretskod");
      for (const t of meta.toppnivan) assert.ok(ytor.has(t.kod), `${t.namn} saknar yta`);
    });

    it("har en kommunyta för varje kommun", () => {
      const ytor = koder("geografi-kommun.json", "kommun", "Kommunkod");
      assert.equal(ytor.size, 290);
      for (const k of val[valtyp].meta.kommuner) {
        assert.ok(ytor.has(k.kod), `${k.namn} saknar yta`);
      }
    });

    it("har siffror för varje valdistriktsyta som ingår i valet", () => {
      const ytor = koder("geografi-valdistrikt.json", "valdistrikt", "Valdistriktskod");
      const medSiffror = new Set(val[valtyp].distrikt.map((d) => d.k));
      for (const kod of ytor) {
        if (saknasIRegionvalet(valtyp, kod)) continue;
        assert.ok(medSiffror.has(kod), `${kod} saknar siffror`);
      }
    });

    it("saknar yta bara för uppsamlingsdistrikten", () => {
      // Uppsamlingsdistrikten – dit sena brev- och budröster går – har ingen
      // geografi. Alla andra distrikt ska gå att rita.
      const ytor = koder("geografi-valdistrikt.json", "valdistrikt", "Valdistriktskod");
      for (const d of val[valtyp].distrikt) {
        if (ytor.has(d.k)) continue;
        assert.equal(d.k.length, 6,
          `${d.k} ${d.n} saknar yta men ser ut som ett vanligt valdistrikt`);
        assert.equal(d.rb, 0, `${d.k} ${d.n} saknar yta men har röstberättigade`);
      }
    });
  });
}

describe("Gotland i regionvalet", () => {
  it("har varken län, kommun eller distrikt i regionvalet", () => {
    const { omraden, distrikt } = val.RF;
    assert.equal(omraden.tp[UTAN_REGIONVAL], undefined);
    assert.equal(omraden.km["0980"], undefined);
    assert.equal(distrikt.filter((d) => d.km === "0980").length, 0);
  });

  it("finns kvar i de andra två valen", () => {
    assert.ok(val.KF.omraden.km["0980"], "Gotland saknas i kommunvalet");
    assert.ok(val.RD.omraden.km["0980"], "Gotland saknas i riksdagsvalet");
  });
});

describe("lokala partier", () => {
  it("finns med under eget namn i kommunvalet", () => {
    // Stenungsundspartiet ställer bara upp i Stenungsunds kommun.
    const { omraden, meta } = val.KF;
    const stenungsund = omraden.km["1415"];
    const lokala = Object.keys(stenungsund.r)
      .map((kod) => meta.partier.find((p) => p.kod === kod))
      .filter((p) => p && !["S", "M", "SD", "C", "V", "KD", "MP", "L", "ÖVR"].includes(p.kort));
    assert.ok(lokala.length > 0, "inga lokala partier i Stenungsund");
    assert.ok(lokala.some((p) => /Stenungsund/i.test(p.namn)),
      `hittade ${lokala.map((p) => p.namn).join(", ")}`);
  });

  it("ställer inte upp överallt", () => {
    const { omraden } = val.KF;
    const kod = Object.keys(omraden.km["1415"].r)
      .find((k) => !omraden.km["1480"].r[k]);
    assert.ok(kod, "något parti borde finnas i Stenungsund men inte i Göteborg");
    assert.equal(forandringParti(omraden.km["1480"], kod), 0,
      "ett parti som inte ställt upp ska räknas som noll röster");
  });
});
