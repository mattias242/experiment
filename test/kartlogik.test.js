// BDD-tester för räknesnurran bakom förändringskartan.
// Kör: node --test
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  summera, andel, forandring, forandringParti, forandringValdeltagande,
  valdeltagande, farg, nollfarg, automatiskSkala, formateraForandring,
} = require("../docs/kartlogik.js");

// Hjälpare: ett valdistrikt där rösterna anges som { partikod: antal }.
const krets = (rostberattigade, nu, fore, extra = {}) => {
  const summa = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return {
    rb: rostberattigade,
    rb0: extra.rb0 ?? rostberattigade,
    t: extra.t ?? summa(nu),
    t0: extra.t0 ?? summa(fore),
    g: summa(nu),
    g0: summa(fore),
    r: nu,
    r0: fore,
    c: 1,
    j: 1,
    ...extra,
  };
};

describe("sammanvägning av områden", () => {
  it("väger delarna efter storlek, inte efter antal", () => {
    // Uppdragets eget exempel: +2 procentenheter i en krets med 1 000 röstande
    // och ±0 i en annan krets med 1 000 röstande ska bli +1 tillsammans.
    const a = krets(1000, { S: 220, M: 780 }, { S: 200, M: 800 });
    const b = krets(1000, { S: 300, M: 700 }, { S: 300, M: 700 });
    assert.equal(forandringParti(a, "S"), 2);
    assert.equal(forandringParti(b, "S"), 0);
    assert.equal(forandringParti(summera([a, b]), "S"), 1);
  });

  it("låter en stor krets väga tyngre än en liten", () => {
    // +10 procentenheter i en krets med 3 000 röster och ±0 i en med 1 000
    // ska ge +7,5 – inte +5 som ett rakt medelvärde skulle ge.
    const stor = krets(3000, { S: 1200, M: 1800 }, { S: 900, M: 2100 });
    const liten = krets(1000, { S: 300, M: 700 }, { S: 300, M: 700 });
    assert.equal(forandringParti(stor, "S"), 10);
    assert.equal(forandringParti(summera([stor, liten]), "S"), 7.5);
  });

  it("summerar röstberättigade, röster och flaggor", () => {
    const s = summera([
      krets(1000, { S: 220, M: 780 }, { S: 200, M: 800 }),
      krets(500, { S: 100, M: 400 }, {}, { j: 0, c: 0 }),
    ]);
    assert.equal(s.rb, 1500);
    assert.equal(s.antal, 2);
    assert.equal(s.raknadeDelar, 1);
    assert.equal(s.utanJamforelse, 1);
    assert.deepEqual(s.r, { S: 320, M: 1180 });
  });

  it("ger tom summa för tom lista utan att krascha", () => {
    const s = summera([]);
    assert.deepEqual(s.r, {});
    assert.equal(forandringParti(s, "S"), null);
  });
});

describe("lokala partier", () => {
  // I kommunvalet ställer lokala partier upp i en enda kommun. Partierna kan
  // därför inte ligga i en fast lista – de slås upp på sin partikod.
  const medLokalt = krets(1000, { S: 200, St: 130, M: 670 }, { S: 300, M: 700 });
  const utanLokalt = krets(1000, { S: 300, M: 700 }, { S: 300, M: 700 });

  it("räknar ett nytt lokalt parti mot noll året innan", () => {
    assert.equal(forandringParti(medLokalt, "St"), 13);
  });

  it("säger ±0 för ett parti som inte ställt upp i området", () => {
    // Väljarna hade det inte att rösta på – det är noll röster, inte okänt.
    assert.equal(forandringParti(utanLokalt, "St"), 0);
  });

  it("tar med lokala partier när områden vägs ihop", () => {
    const ihop = summera([medLokalt, utanLokalt]);
    assert.equal(ihop.r.St, 130);
    assert.equal(forandringParti(ihop, "St"), 6.5);
  });
});

describe("andelar och förändringar", () => {
  it("räknar andelar på giltiga partiröster", () => {
    assert.equal(andel(250, 1000), 25);
  });

  it("säger null i stället för noll procent när inget är räknat", () => {
    assert.equal(andel(0, 0), null);
    const oraknat = krets(1200, {}, { S: 300, M: 700 });
    assert.equal(forandringParti(oraknat, "S"), null);
  });

  it("säger null när 2022 saknas helt", () => {
    // Så ser ett omritat valdistrikt ut i Valmyndighetens data.
    const nytt = krets(900, { S: 200, M: 500 }, {}, { rb0: 0 });
    assert.equal(forandringParti(nytt, "S"), null);
    assert.equal(forandringValdeltagande(nytt), null);
  });

  it("räknar valdeltagande på alla avlagda röster", () => {
    const k = krets(1000, { S: 400, M: 400 }, { S: 500, M: 400 },
      { t: 820, t0: 910, rb0: 1000 });
    assert.equal(valdeltagande(k, "nu"), 82);
    assert.equal(valdeltagande(k, "fore"), 91);
    assert.equal(forandringValdeltagande(k), -9);
  });

  it("väljer mått efter vad man frågar om", () => {
    const k = krets(1000, { S: 400, M: 400 }, { S: 500, M: 400 },
      { t: 820, t0: 910, rb0: 1000 });
    assert.equal(forandring(k, "valdeltagande"), -9);
    assert.equal(forandring(k, "S"), 50 - (500 / 900) * 100);
    assert.equal(forandring(null, "S"), null);
  });
});

describe("färgskalan", () => {
  it("ger grått vid noll", () => {
    const [r, g, b] = nollfarg().match(/\d+/g).map(Number);
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 12, `${nollfarg()} är inte grått`);
  });

  it("gör plus orange och minus lila", () => {
    const [pr, pg, pb] = farg(8, 10).match(/\d+/g).map(Number);
    assert.ok(pr > pg && pg > pb, `plus ska vara orange, blev ${farg(8, 10)}`);
    const [mr, mg, mb] = farg(-8, 10).match(/\d+/g).map(Number);
    assert.ok(mb > mr && mr > mg, `minus ska vara lila, blev ${farg(-8, 10)}`);
  });

  it("blir kraftigare ju större förändringen är", () => {
    const mattnad = (v) => {
      const [r, g, b] = farg(v, 10).match(/\d+/g).map(Number);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    assert.ok(mattnad(2) < mattnad(5));
    assert.ok(mattnad(5) < mattnad(9));
    assert.ok(mattnad(-2) < mattnad(-5));
  });

  it("låter förändringar utanför skalan slå i taket i stället för att spricka", () => {
    assert.equal(farg(40, 10), farg(10, 10));
    assert.equal(farg(-40, 10), farg(-10, 10));
  });

  it("håller sig inom giltiga rgb-värden hela vägen", () => {
    for (let v = -12; v <= 12; v += 0.25) {
      const delar = farg(v, 10).match(/\d+/g).map(Number);
      assert.equal(delar.length, 3);
      for (const d of delar) assert.ok(d >= 0 && d <= 255, `${v} gav ${farg(v, 10)}`);
    }
  });

  it("har ingen färg alls för områden utan siffror", () => {
    assert.equal(farg(null, 10), null);
    assert.equal(farg(NaN, 10), null);
  });
});

describe("automatisk skala", () => {
  it("låter enstaka extremvärden slå i taket i stället för att platta ut kartan", () => {
    const varden = Array.from({ length: 100 }, (_, i) => (i < 99 ? 1.8 : 40));
    const vikter = varden.map(() => 1000);
    assert.equal(automatiskSkala(varden, vikter), 2);
  });

  it("väger efter storlek, så att småkretsar inte styr skalan", () => {
    const varden = [20, 1, 1, 1];
    const vikter = [10, 5000, 5000, 5000];
    assert.ok(automatiskSkala(varden, vikter) <= 1.5);
  });

  it("hoppar över hål i datat", () => {
    assert.equal(automatiskSkala([null, null, 4.5, 4.5], [1, 1, 1, 1]), 5);
  });

  it("faller tillbaka på något rimligt när allt saknas", () => {
    assert.equal(automatiskSkala([null, null], [1, 1]), 5);
    assert.equal(automatiskSkala([], []), 5);
  });
});

describe("formatering", () => {
  it("skriver tecken och svenskt decimaltecken", () => {
    assert.equal(formateraForandring(2.34), "+2,3");
    assert.equal(formateraForandring(-2.35), "−2,4");
    assert.equal(formateraForandring(0), "±0,0");
    assert.equal(formateraForandring(null), "–");
  });
});
