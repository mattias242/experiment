// Räknesnurran bakom förändringskartan: hur ett områdes förändring vägs ihop
// ur delarna, och vilken färg förändringen ska ha.
// Delas mellan webbläsaren (karta.js) och Node (test/kartlogik.test.js).
// Kör testerna med: node --test
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Kartlogik = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // ---- Sammanvägning ------------------------------------------------------
  //
  // Ett områdes förändring är inte medelvärdet av delarnas förändringar – då
  // skulle ett valdistrikt med 200 röster väga lika tungt som ett med 2 000.
  // I stället summeras rösterna i området och andelen räknas på summan, vilket
  // ger varje del en vikt som är proportionell mot dess storlek:
  //
  //   +2 procentenheter i en krets med 1 000 röstande, tillsammans med
  //    0 procentenheter i en annan krets med 1 000 röstande, blir +1.
  //
  // Andelen räknas på "röster som påverkar mandatfördelningen" (giltiga röster
  // på anmälda partier), precis som Valmyndighetens egna procenttal.

  function summera(delar) {
    const summa = {
      rb: 0, rb0: 0, t: 0, t0: 0, g: 0, g0: 0,
      r: null, r0: null, antal: 0, raknade: 0, utanJamforelse: 0,
    };
    for (const d of delar) {
      summa.rb += d.rb || 0;
      summa.rb0 += d.rb0 || 0;
      summa.t += d.t || 0;
      summa.t0 += d.t0 || 0;
      summa.g += d.g || 0;
      summa.g0 += d.g0 || 0;
      summa.antal += 1;
      if (d.c) summa.raknade += 1;
      if (d.j === 0) summa.utanJamforelse += 1;
      if (!summa.r) {
        summa.r = (d.r || []).slice();
        summa.r0 = (d.r0 || []).slice();
      } else {
        for (let i = 0; i < summa.r.length; i++) {
          summa.r[i] += (d.r && d.r[i]) || 0;
          summa.r0[i] += (d.r0 && d.r0[i]) || 0;
        }
      }
    }
    if (!summa.r) { summa.r = []; summa.r0 = []; }
    return summa;
  }

  // Andel av de giltiga partirösterna, i procent. Noll röster ger null i
  // stället för 0 %, så att "inget räknat än" inte ser ut som "0 procent".
  function andel(roster, total) {
    if (!total) return null;
    return (roster / total) * 100;
  }

  // Förändringen i procentenheter för ett parti, eller null om något av åren
  // saknas för området.
  function forandringParti(omrade, partiIndex) {
    const nu = andel(omrade.r[partiIndex], omrade.g);
    const fore = andel(omrade.r0[partiIndex], omrade.g0);
    if (nu === null || fore === null) return null;
    return nu - fore;
  }

  // Valdeltagande = alla avlagda röster (även blanka) av de röstberättigade.
  function valdeltagande(omrade, ar) {
    const roster = ar === 'fore' ? omrade.t0 : omrade.t;
    const berattigade = ar === 'fore' ? omrade.rb0 : omrade.rb;
    if (!berattigade) return null;
    return (roster / berattigade) * 100;
  }

  function forandringValdeltagande(omrade) {
    const nu = valdeltagande(omrade, 'nu');
    const fore = valdeltagande(omrade, 'fore');
    if (nu === null || fore === null) return null;
    return nu - fore;
  }

  // Ett mått är antingen ett parti (index i partilistan) eller valdeltagandet.
  function forandring(omrade, matt) {
    if (!omrade) return null;
    return matt === 'valdeltagande'
      ? forandringValdeltagande(omrade)
      : forandringParti(omrade, matt);
  }

  // ---- Färgskala ----------------------------------------------------------
  //
  // Grått i mitten, orange uppåt, lila nedåt. Stegen är valda i OKLab så att
  // lika stora steg i förändring ser lika stora ut för ögat, och så att orange
  // och lila har samma ljushet vid samma avstånd från noll – annars ser den
  // ena sidan av skalan kraftigare ut än den andra.
  const NOLL = [0.895, 0.004, 0.002];              // ljust varmgrått
  const PLUS = [                                    // mot orange
    [0.895, 0.004, 0.002],
    [0.845, 0.043, 0.058],
    [0.780, 0.082, 0.108],
    [0.700, 0.122, 0.142],
    [0.590, 0.150, 0.135],
  ];
  const MINUS = [                                   // mot lila
    [0.895, 0.004, 0.002],
    [0.845, 0.016, -0.046],
    [0.780, 0.040, -0.099],
    [0.700, 0.078, -0.148],
    [0.590, 0.116, -0.172],
  ];

  function oklabTillRgb(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const lin = [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
    return lin.map((v) => {
      const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
      return Math.max(0, Math.min(255, Math.round(g * 255)));
    });
  }

  function langsSkala(stopp, t) {
    const x = Math.max(0, Math.min(1, t)) * (stopp.length - 1);
    const i = Math.min(stopp.length - 2, Math.floor(x));
    const f = x - i;
    return [0, 1, 2].map((k) => stopp[i][k] + (stopp[i + 1][k] - stopp[i][k]) * f);
  }

  // Färgen för en förändring, där `max` är var skalan tar slut (i
  // procentenheter). Förändringar utanför skalan får ändfärgen.
  function farg(forandringen, max) {
    if (forandringen === null || forandringen === undefined || !Number.isFinite(forandringen)) {
      return null;
    }
    const t = max > 0 ? Math.abs(forandringen) / max : 0;
    const [L, a, b] = forandringen >= 0 ? langsSkala(PLUS, t) : langsSkala(MINUS, t);
    const [r, g, bl] = oklabTillRgb(L, a, b);
    return `rgb(${r},${g},${bl})`;
  }

  const nollfarg = () => farg(0, 1);

  // Var skalan ska sluta när användaren inte valt själv: strax ovanför den
  // förändring som nio tiondelar av de röstberättigade ligger under, räknat på
  // hela landet. Skalas det i stället efter det man råkar ha på skärmen byter
  // färgerna betydelse så fort man zoomar, och då går områden inte att jämföra.
  // Enstaka extrema småkretsar ska inte heller platta ut hela kartan – de får
  // slå i skalans ände i stället.
  function automatiskSkala(varden, vikter, andel = 0.9) {
    const rader = [];
    for (let i = 0; i < varden.length; i++) {
      const v = varden[i];
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      rader.push([Math.abs(v), (vikter && vikter[i]) || 1]);
    }
    if (!rader.length) return 5;
    rader.sort((a, b) => a[0] - b[0]);
    const total = rader.reduce((s, x) => s + x[1], 0);
    let sedd = 0;
    let gräns = rader[rader.length - 1][0];
    for (const [v, w] of rader) {
      sedd += w;
      if (sedd >= total * andel) { gräns = v; break; }
    }
    // Runda uppåt till något läsbart, och håll skalan inom rimliga gränser.
    const steg = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];
    return steg.find((s) => s >= gräns) ?? 50;
  }

  const formateraForandring = (v, decimaler = 1) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    const tecken = v > 0 ? '+' : v < 0 ? '−' : '±';
    return `${tecken}${Math.abs(v).toFixed(decimaler).replace('.', ',')}`;
  };

  return {
    summera, andel, forandring, forandringParti, forandringValdeltagande,
    valdeltagande, farg, nollfarg, automatiskSkala, formateraForandring,
    oklabTillRgb,
  };
});
