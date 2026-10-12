// Neonrummet: en demoscen som byggs av splattar direkt i webbläsaren, så att
// något syns på en gång utan att något behöver laddas ned.
// Delas mellan webbläsaren (app.js) och Node (testerna). Kör: node --test
//
// Scenen är gjord för fönsterillusionen: ett rum med rutnät på väggarna,
// precis lika stort som skärmen och med öppningen i skärmens plan, och
// planeter på pinnar på olika djup. Rutnätet ger ögat något att mäta djupet
// mot, och den lilla månen längst fram svävar en bit framför glaset.
//
// Allt mäts i millimeter. Rummets mitt ligger i origo; för att öppningen ska
// hamna i skärmen ska scenen flyttas bakåt ett halvt rumsdjup (se djup nedan).
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Demoscen = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // Liten deterministisk slumpgenerator (mulberry32), så att scenen ser
  // likadan ut varje gång och går att testa.
  function slump(fro) {
    let a = fro >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const blanda = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

  // Kvaternionen som vrider z-axeln till enhetsvektorn n.
  function franZ([x, y, z]) {
    if (z < -0.999999) return [0, 1, 0, 0];
    const w = 1 + z, l = Math.hypot(w, -y, x);
    return [w / l, -y / l, x / l, 0];
  }

  function neonrummet(bredd, hojd, { fro = 7 } = {}) {
    const r = slump(fro);
    const pos = [], skala = [], rot = [], farg = [];
    const lagg = (p, s, c, a, q = [1, 0, 0, 0]) => {
      pos.push(p[0], p[1], p[2]);
      skala.push(s[0], s[1], s[2]);
      rot.push(q[0], q[1], q[2], q[3]);
      farg.push(c[0] * 255, c[1] * 255, c[2] * 255, a * 255);
    };

    const B = bredd, H = hojd;
    const D = Math.max(B, H) * 0.9; // rummets djup
    const m = Math.min(B, H);      // planeterna skalar med kortsidan
    const g = m / 6;               // rutnätets maskvidd
    const fram = hex('#39d5ff'), bak = hex('#b04dff');
    const djupfarg = (z) => blanda(bak, fram, (z + D / 2) / D);

    // ---- Rutnätet -------------------------------------------------------
    // En linje är en rad avlånga splattar längs en axel, plus en bredare och
    // svagare rad ovanpå som glöd.
    const linje = (fran, till) => {
      const d = [0, 1, 2].map((k) => till[k] - fran[k]);
      const langd = Math.hypot(...d);
      const axel = d.findIndex((v) => Math.abs(v) > 1e-9);
      const steg = 1.2, n = Math.max(1, Math.round(langd / steg));
      for (let i = 0; i <= n; i++) {
        const p = fran.map((v, k) => v + d[k] * i / n);
        const c = djupfarg(p[2]);
        const tunn = [0.16, 0.16, 0.16], glod = [0.7, 0.7, 0.7];
        tunn[axel] = glod[axel] = steg * 0.6;
        lagg(p, tunn, c, 0.95);
        if (i % 2 === 0) lagg(p, glod, c, 0.16);
      }
    };

    const steg = (min, max) => {
      const n = Math.max(1, Math.round((max - min) / g));
      return Array.from({ length: n + 1 }, (_, i) => min + (max - min) * i / n);
    };
    const x0 = -B / 2, x1 = B / 2, y0 = -H / 2, y1 = H / 2, z0 = -D / 2, z1 = D / 2;

    for (const x of steg(x0, x1)) linje([x, y0, z0], [x, y1, z0]); // bakvägg
    for (const y of steg(y0, y1)) linje([x0, y, z0], [x1, y, z0]);
    for (const x of [x0, x1]) {                                      // sidoväggar
      for (const y of steg(y0, y1)) linje([x, y, z0], [x, y, z1]);
      for (const z of steg(z0, z1)) linje([x, y0, z], [x, y1, z]);
    }
    for (const y of [y0, y1]) {                                      // golv och tak
      for (const x of steg(x0, x1)) linje([x, y, z0], [x, y, z1]);
      for (const z of steg(z0, z1)) linje([x0, y, z], [x1, y, z]);
    }

    // Väggarna fylls med mörka, platta splattar så att rummet känns slutet.
    const vagg = (punkt, normal, n) => {
      const q = franZ(normal);
      for (let i = 0; i < n; i++) {
        const p = punkt(r(), r());
        const c = blanda(hex('#03040c'), hex('#0e1438'), (p[2] + D / 2) / D);
        lagg(p, [g * 0.45, g * 0.45, 0.2], c, 0.5, q);
      }
    };
    const yta = B * H + 2 * (B + H) * D;
    const tathet = 900 / yta;
    vagg((u, v) => [x0 + u * B, y0 + v * H, z0], [0, 0, 1], Math.round(B * H * tathet * 3));
    vagg((u, v) => [x0, y0 + u * H, z0 + v * D], [1, 0, 0], Math.round(H * D * tathet * 3));
    vagg((u, v) => [x1, y0 + u * H, z0 + v * D], [-1, 0, 0], Math.round(H * D * tathet * 3));
    vagg((u, v) => [x0 + u * B, y0, z0 + v * D], [0, 1, 0], Math.round(B * D * tathet * 3));
    vagg((u, v) => [x0 + u * B, y1, z0 + v * D], [0, -1, 0], Math.round(B * D * tathet * 3));

    // ---- Planeterna -----------------------------------------------------
    // Ytan är tangentiella skivor i ett Fibonaccigitter. Ljuset är inbakat i
    // färgen: ett varmt sken snett uppifrån och en kall kantglöd bakifrån.
    const ljus = (() => { const v = [-0.5, 0.7, 0.6], l = Math.hypot(...v); return v.map((x) => x / l); })();
    const planet = ({ p, radie, palett, band = 5, lutning = 0.3, ring = null, pinne = true }) => {
      const n = 5000, gyllene = Math.PI * (3 - Math.sqrt(5));
      const avst = radie * Math.sqrt(4 * Math.PI / n);
      const cl = Math.cos(lutning), sl = Math.sin(lutning);
      for (let i = 0; i < n; i++) {
        const y = 1 - 2 * (i + 0.5) / n, rr = Math.sqrt(1 - y * y), v = i * gyllene;
        const nrm = [Math.cos(v) * rr, y, Math.sin(v) * rr];
        // banden följer planetens egen, lutade axel
        const lat = nrm[1] * cl - nrm[0] * sl;
        const lon = Math.atan2(nrm[2], nrm[0] * cl + nrm[1] * sl);
        const t = 0.5 + 0.5 * Math.sin(lat * band * Math.PI + 0.6 * Math.sin(lon * 3 + lat * 7));
        const bas = blanda(palett[0], palett[1], t);
        const skugga = 0.16 + 0.84 * Math.max(0, nrm[0] * ljus[0] + nrm[1] * ljus[1] + nrm[2] * ljus[2]);
        const kant = Math.pow(1 - Math.abs(nrm[2]), 3) * Math.max(0, -nrm[0] * 0.3 + 0.7);
        const c = bas.map((x, k) => Math.min(1, x * skugga + kant * [0.15, 0.5, 0.75][k] * 0.5));
        lagg([p[0] + nrm[0] * radie, p[1] + nrm[1] * radie, p[2] + nrm[2] * radie],
          [avst * 0.62, avst * 0.62, avst * 0.12], c, 0.97, franZ(nrm));
      }
      if (ring) {
        const rn = [Math.sin(ring.lutning), Math.cos(ring.lutning), 0];
        const q = franZ(rn);
        const u = [Math.cos(ring.lutning), -Math.sin(ring.lutning), 0], w = [0, 0, 1];
        for (let i = 0; i < 3500; i++) {
          const rad = radie * (ring.inre + (ring.yttre - ring.inre) * r()), v = r() * 2 * Math.PI;
          const a = Math.cos(v) * rad, b = Math.sin(v) * rad;
          const t = (rad / radie - ring.inre) / (ring.yttre - ring.inre);
          const c = blanda(ring.palett[0], ring.palett[1], 0.5 + 0.5 * Math.sin(t * 19));
          lagg([p[0] + u[0] * a + w[0] * b, p[1] + u[1] * a + w[1] * b, p[2] + u[2] * a + w[2] * b],
            [radie * 0.035, radie * 0.035, radie * 0.004], c, 0.55, q);
        }
      }
      if (pinne) {
        const topp = p[1] - radie;
        const n2 = Math.max(2, Math.round((topp - y0) / 1));
        for (let i = 0; i <= n2; i++) {
          lagg([p[0], y0 + (topp - y0) * i / n2, p[2]], [0.14, 0.6, 0.14], hex('#c9d4ff'), 0.7);
        }
        // skugga på golvet
        for (let i = 0; i < 160; i++) {
          const v = r() * 2 * Math.PI, rad = Math.sqrt(r()) * radie * 0.9;
          lagg([p[0] + Math.cos(v) * rad, y0 + 0.3, p[2] + Math.sin(v) * rad],
            [radie * 0.18, 0.1, radie * 0.18], [0, 0, 0], 0.18);
        }
      }
    };

    planet({ p: [-0.18 * B, 0.12 * H, -0.28 * D], radie: 0.2 * m, palett: [hex('#f3c58a'), hex('#a8572e')], band: 6 });
    planet({
      p: [0.16 * B, -0.14 * H, 0.02 * D], radie: 0.13 * m, palett: [hex('#fff0b8'), hex('#d7a54f')], band: 3,
      ring: { inre: 1.45, yttre: 2.2, lutning: 0.45, palett: [hex('#ffe3a3'), hex('#8a6a45')] },
    });
    planet({ p: [0.27 * B, 0.33 * H, -0.42 * D], radie: 0.09 * m, palett: [hex('#ff7a6b'), hex('#7a1d2e')], band: 4 });
    planet({ p: [-0.24 * B, -0.36 * H, -0.18 * D], radie: 0.11 * m, palett: [hex('#7ef0b0'), hex('#1d6b5a')], band: 5, lutning: -0.5 });
    // månen framför glaset
    planet({ p: [0.02 * B, 0.27 * H, D / 2 + 0.16 * m], radie: 0.075 * m, palett: [hex('#e8f4ff'), hex('#7d9cc8')], band: 2, pinne: false });

    // ---- Damm i luften ----------------------------------------------------
    for (let i = 0; i < 700; i++) {
      const p = [x0 + r() * B, y0 + r() * H, z0 + r() * (D + 0.25 * m)];
      const s = 0.08 + 0.14 * r();
      lagg(p, [s, s, s], blanda(hex('#ffffff'), djupfarg(Math.min(p[2], z1)), 0.4), 0.15 + 0.5 * r());
    }

    const antal = pos.length / 3;
    return {
      scen: {
        antal,
        pos: Float32Array.from(pos),
        skala: Float32Array.from(skala),
        rot: Float32Array.from(rot),
        farg: Uint8Array.from(farg, (v) => Math.max(0, Math.min(255, Math.round(v)))),
      },
      djup: -D / 2,
      rumsdjup: D,
    };
  }

  return { neonrummet, slump, franZ };
});
