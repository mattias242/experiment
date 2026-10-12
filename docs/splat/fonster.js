// Fönstermatematiken: var huvudet är i förhållande till skärmen, och hur
// scenen ska projiceras för att skärmen ska se ut som ett fönster.
// Delas mellan webbläsaren (app.js) och Node (testerna). Kör: node --test
//
// Koordinatsystemet är fysiskt och i millimeter: origo i skärmens mitt,
// x åt höger, y uppåt och z ut ur skärmen mot den som tittar. Skärmen är
// alltså rektangeln |x| ≤ bredd/2, |y| ≤ höjd/2 i planet z = 0, och allt med
// negativt z ligger "bakom glaset".
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Fonster = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // ---- Matriser -----------------------------------------------------------
  // Kolumnvisa Float32Array(16), som WebGL vill ha dem: element (rad r,
  // kolumn k) ligger på index k * 4 + r.

  const identitet = () => {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  };

  function multiplicera(a, b) {
    const o = new Float32Array(16);
    for (let k = 0; k < 4; k++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let i = 0; i < 4; i++) s += a[i * 4 + r] * b[k * 4 + i];
        o[k * 4 + r] = s;
      }
    }
    return o;
  }

  const kedja = (...matriser) => matriser.reduce((a, b) => multiplicera(a, b));

  const forflyttning = (x, y, z) => {
    const m = identitet();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  };

  const skalning = (s) => {
    const m = identitet();
    m[0] = m[5] = m[10] = s;
    return m;
  };

  const rotationX = (v) => {
    const m = identitet(), c = Math.cos(v), s = Math.sin(v);
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
    return m;
  };

  const rotationY = (v) => {
    const m = identitet(), c = Math.cos(v), s = Math.sin(v);
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
    return m;
  };

  // Punkt genom matris, med perspektivdivision. Ger [x, y, z, w] där x, y, z
  // redan är delade med w (alltså normaliserade enhetskoordinater, NDC).
  function projicera(m, p) {
    const [x, y, z] = p;
    const X = m[0] * x + m[4] * y + m[8] * z + m[12];
    const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
    const Z = m[2] * x + m[6] * y + m[10] * z + m[14];
    const W = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [X / W, Y / W, Z / W, W];
  }

  // ---- Fönsterprojektionen ------------------------------------------------

  function frustum(v, h, n, u, nara, fjarran) {
    const m = new Float32Array(16);
    m[0] = 2 * nara / (h - v);
    m[5] = 2 * nara / (u - n);
    m[8] = (h + v) / (h - v);
    m[9] = (u + n) / (u - n);
    m[10] = -(fjarran + nara) / (fjarran - nara);
    m[11] = -1;
    m[14] = -2 * fjarran * nara / (fjarran - nara);
    return m;
  }

  // Den asymmetriska ("off-axis") synpyramiden från ögat genom skärmens fyra
  // hörn. Det är den som gör illusionen: skärmens kanter ligger alltid exakt i
  // bildens kanter, men det som syns innanför dem beror på var ögat är – precis
  // som när man flyttar huvudet framför ett fönster.
  function fonsterprojektion(oga, bredd, hojd, nara = 10, fjarran = 1e6) {
    const k = nara / oga.z;
    return frustum(
      (-bredd / 2 - oga.x) * k, (bredd / 2 - oga.x) * k,
      (-hojd / 2 - oga.y) * k, (hojd / 2 - oga.y) * k,
      nara, fjarran
    );
  }

  // Kameran står i ögat och tittar rakt in i skärmen. Den vrids aldrig: det är
  // skärmen som är fast, inte blickriktningen.
  const vymatris = (oga) => forflyttning(-oga.x, -oga.y, -oga.z);

  // ---- Skärmen och kameran i millimeter ----------------------------------

  // Webbläsaren berättar inte hur stor skärmen är fysiskt. CSS-pixeln är dock
  // definierad så att den ska se ungefär lika stor ut på alla enheter, och på
  // telefoner och surfplattor hamnar den kring 1/160 tum (Androids dp har just
  // den definitionen, iPhone ligger på 1/163). På datorskärmar gäller 1/96 tum.
  function skarmstorlek(cssBredd, cssHojd, pekskarm) {
    const mmPerPx = 25.4 / (pekskarm ? 160 : 96);
    return { bredd: cssBredd * mmPerPx, hojd: cssHojd * mmPerPx };
  }

  // Var frontkameran sitter, sett från skärmens mitt. Den sitter i telefonens
  // överkant, och när telefonen vrids till liggande hamnar överkanten åt
  // vänster (vinkel 90) eller höger (vinkel 270). Kamerabilden vrids av
  // webbläsaren så att den alltid står rätt mot skärmen, så bara läget
  // behöver räknas om – inte axlarna.
  function kameraposition(vinkel, bredd, hojd, marginal = 4) {
    switch (((Math.round(vinkel) % 360) + 360) % 360) {
      case 90: return { x: -bredd / 2 - marginal, y: 0 };
      case 270: return { x: bredd / 2 + marginal, y: 0 };
      case 180: return { x: 0, y: -hojd / 2 - marginal };
      default: return { x: 0, y: hojd / 2 + marginal };
    }
  }

  // ---- Huvudet ur ansiktslandmärkena -------------------------------------

  // Index i MediaPipes ansiktsnät (478 punkter): ögonvrårna. Vrårna rör sig
  // inte när blicken flyttas, vilket pupillerna gör, och ger därför ett
  // stadigare mått på var ögonen sitter.
  const OGONVRAR = { hogerYttre: 33, hogerInre: 133, vansterInre: 362, vansterYttre: 263 };

  // Var ögonen sitter, i mm från kameran, med skärmens axlar: x åt höger och y
  // uppåt som den som håller telefonen ser det, z ut från skärmen.
  //
  // Avståndet fås ur hur stort avståndet mellan ögonen ser ut i bilden: en
  // vuxen har ungefär 63 mm mellan ögonen, så om det ser ut som d pixlar och
  // kameran har brännvidden f pixlar är avståndet f · 63 / d. Djupkomponenten
  // i landmärkena räknas med så att avståndet inte tycks växa när man vrider
  // på huvudet.
  //
  // Bilden från en frontkamera är inte spegelvänd: den som rör sig åt sin
  // högra sida, alltså mot skärmens högerkant, hamnar till vänster i bilden.
  // Därav minustecknen.
  function uppskattaOgon(landmarken, bildBredd, bildHojd, {
    synfaltDiagonal = 75, ogonavstand = 63, spegla = false,
  } = {}) {
    if (!landmarken || landmarken.length < 468) return null;
    const mitt = (a, b) => ({
      x: (landmarken[a].x + landmarken[b].x) / 2,
      y: (landmarken[a].y + landmarken[b].y) / 2,
      z: ((landmarken[a].z || 0) + (landmarken[b].z || 0)) / 2,
    });
    const h = mitt(OGONVRAR.hogerYttre, OGONVRAR.hogerInre);
    const v = mitt(OGONVRAR.vansterInre, OGONVRAR.vansterYttre);
    const dx = (v.x - h.x) * bildBredd;
    const dy = (v.y - h.y) * bildHojd;
    const dz = (v.z - h.z) * bildBredd; // landmärkenas z har x-axelns skala
    const avstandPx = Math.hypot(dx, dy, dz);
    if (!(avstandPx > 1)) return null;

    const f = (Math.hypot(bildBredd, bildHojd) / 2) / Math.tan(synfaltDiagonal * Math.PI / 360);
    const z = f * ogonavstand / avstandPx;
    const u = ((h.x + v.x) / 2) * bildBredd - bildBredd / 2;
    const w = ((h.y + v.y) / 2) * bildHojd - bildHojd / 2;
    return {
      x: (spegla ? 1 : -1) * u * z / f,
      y: -w * z / f,
      z,
    };
  }

  // ---- Utjämning ----------------------------------------------------------

  // 1€-filtret (Casiez, Roussel & Vogel 2012): hårt utjämnat när huvudet står
  // still, så att bilden inte darrar, men nästan utan fördröjning när det rör
  // sig snabbt, så att illusionen inte släpar efter.
  class EnEuroFilter {
    constructor({ minGrans = 1.2, beta = 0.02, derivataGrans = 1 } = {}) {
      Object.assign(this, { minGrans, beta, derivataGrans });
      this.nollstall();
    }

    nollstall() {
      this.x = null; this.dx = 0; this.t = null;
    }

    static alfa(grans, dt) {
      const tau = 1 / (2 * Math.PI * grans);
      return 1 / (1 + tau / dt);
    }

    filtrera(varde, t) {
      if (this.x === null || !(t > this.t)) {
        if (this.x === null) { this.x = varde; this.t = t; }
        return this.x;
      }
      const dt = t - this.t;
      const raDerivata = (varde - this.x) / dt;
      this.dx += EnEuroFilter.alfa(this.derivataGrans, dt) * (raDerivata - this.dx);
      const grans = this.minGrans + this.beta * Math.abs(this.dx);
      this.x += EnEuroFilter.alfa(grans, dt) * (varde - this.x);
      this.t = t;
      return this.x;
    }

    // Kameran ger 30 bilder i sekunden men skärmen ritar 60 eller 120. Mellan
    // två mätningar skjuts läget fram längs den utjämnade hastigheten, högst
    // en bildruta, så att rörelsen blir mjuk utan att skena iväg.
    framat(t, maxSekunder = 0.05) {
      if (this.x === null) return null;
      return this.x + this.dx * Math.min(Math.max(t - this.t, 0), maxSekunder);
    }
  }

  return {
    identitet, multiplicera, kedja, forflyttning, skalning, rotationX, rotationY,
    projicera, frustum, fonsterprojektion, vymatris,
    skarmstorlek, kameraposition, OGONVRAR, uppskattaOgon, EnEuroFilter,
  };
});
