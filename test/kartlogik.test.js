// BDD-tester för räknesnurran bakom förändringskartan.
// Kör: node --test
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  summera, andel, forandring, forandringParti, forandringValdeltagande,
  valdeltagande, farg, nollfarg, automatiskSkala, formateraForandring,
} = require("../docs/kartlogik.js");

// Hjälpare: ett valdistrikt med två partier, angivna som röstetal.
const krets = (rostberattigade, nu, fore, extra = {}) => ({
  rb: rostberattigade,
  rb0: extra.rb0 ?? rostberattigade,
  t: extra.t ?? nu.reduce((a, b) => a + b, 0),
  t0: extra.t0 ?? fore.reduce((a, b) => a + b, 0),
  g: nu.reduce((a, b) => a + b, 0),
  g0: fore.reduce((a, b) => a + b, 0),
  r: nu,
  r0: fore,
  c: 1,
  j: 1,
  ...extra,
});

describe("sammanvägning av områden", () => {
  it("väger delarna efter storlek, inte efter antal", () => {
    // Uppdragets eget exempel: +2 procentenheter i en krets med 1 000 röstande
    // och ±0 i en annan krets med 1 000 röstande ska bli +1 tillsammans.
    const a = krets(1000, [220, 780], [200, 800]);
    const b = krets(1000, [300, 700], [300, 700]);
    assert.equal(forandringParti(a, 0), 2);
    assert.equal(forandringParti(b, 0), 0);
    assert.equal(forandringParti(summera([a, b]), 0), 1);
  });

  it("låter en stor krets väga tyngre än en liten", () => {
    // +10 procentenheter i en krets med 3 000 röster och ±0 i en med 1 000
    // ska ge +7,5 – inte +5 som ett rakt medelvärde skulle ge.
    const stor = krets(3000, [1200, 1800], [900, 2100]);
    const liten = krets(1000, [300, 700], [300, 700]);
    assert.equal(forandringParti(stor, 0), 10);
    assert.equal(forandringParti(summera([stor, liten]), 0), 7.5);
  });

  it("summerar röstberättigade, röster och flaggor", () => {
    const s = summera([
      krets(1000, [220, 780], [200, 800]),
      krets(500, [100, 400], [0, 0], { j: 0, c: 0, g0: 0, t0: 0 }),
    ]);
    assert.equal(s.rb, 1500);
    assert.equal(s.antal, 2);
    assert.equal(s.raknade, 1);
    assert.equal(s.utanJamforelse, 1);
    assert.deepEqual(s.r, [320, 1180]);
  });

  it("ger tom summa för tom lista utan att krascha", () => {
    const s = summera([]);
    assert.deepEqual(s.r, []);
    assert.equal(forandringParti(s, 0), null);
  });
});

describe("andelar och förändringar", () => {
  it("räknar andelar på giltiga partiröster", () => {
    assert.equal(andel(250, 1000), 25);
  });

  it("säger null i stället för noll procent när inget är räknat", () => {
    assert.equal(andel(0, 0), null);
    const oraknat = krets(1200, [0, 0], [300, 700], { g: 0, t: 0 });
    assert.equal(forandringParti(oraknat, 0), null);
  });

  it("säger null när 2022 saknas helt", () => {
    // Så ser ett omritat valdistrikt ut i Valmyndighetens data.
    const nytt = krets(900, [200, 500], [0, 0], { j: 0, g0: 0, t0: 0, rb0: 0 });
    assert.equal(forandringParti(nytt, 0), null);
    assert.equal(forandringValdeltagande(nytt), null);
  });

  it("räknar valdeltagande på alla avlagda röster", () => {
    const k = krets(1000, [400, 400], [500, 400], { t: 820, t0: 910, rb0: 1000 });
    assert.equal(valdeltagande(k, "nu"), 82);
    assert.equal(valdeltagande(k, "fore"), 91);
    assert.equal(forandringValdeltagande(k), -9);
  });

  it("väljer mått efter vad man frågar om", () => {
    const k = krets(1000, [400, 400], [500, 400], { t: 820, t0: 910, rb0: 1000 });
    assert.equal(forandring(k, "valdeltagande"), -9);
    assert.equal(forandring(k, 0), 50 - (500 / 900) * 100);
    assert.equal(forandring(null, 0), null);
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
