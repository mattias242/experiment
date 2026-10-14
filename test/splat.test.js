// BDD-tester för splatfönstret: fönstermatematiken, filinläsningen,
// demoscenen och djupsorteringen. Kör: node --test
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const F = require("../docs/splat/fonster.js");
const S = require("../docs/splat/splatdata.js");
const { neonrummet } = require("../docs/splat/demoscen.js");
const { sorteraDjup } = require("../docs/splat/sortering.js");

const nara = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const ndc = (oga, p, bredd = 65, hojd = 140) =>
  F.projicera(F.multiplicera(F.fonsterprojektion(oga, bredd, hojd), F.vymatris(oga)), p);

describe("Egenskap: skärmen beter sig som ett fönster", () => {
  const ogon = [
    { x: 0, y: 0, z: 300 },
    { x: 80, y: -40, z: 250 },
    { x: -120, y: 90, z: 600 },
  ];

  it("Givet var huvudet än är, så hamnar skärmens hörn exakt i bildens hörn", () => {
    for (const oga of ogon) {
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const [x, y] = ndc(oga, [sx * 65 / 2, sy * 140 / 2, 0]);
        assert.ok(nara(x, sx, 1e-5) && nara(y, sy, 1e-5), `hörnet (${sx}, ${sy}) hamnade i (${x}, ${y})`);
      }
    }
  });

  it("Givet att huvudet flyttas åt höger, så följer det som ligger bakom glaset med", () => {
    const fore = ndc({ x: 0, y: 0, z: 300 }, [0, 0, -200])[0];
    const efter = ndc({ x: 50, y: 0, z: 300 }, [0, 0, -200])[0];
    assert.ok(efter > fore, `${fore} → ${efter}`);
  });

  it("Givet att huvudet flyttas åt höger, så glider det som sticker ut ur glaset åt andra hållet", () => {
    const fore = ndc({ x: 0, y: 0, z: 300 }, [0, 0, 40])[0];
    const efter = ndc({ x: 50, y: 0, z: 300 }, [0, 0, 40])[0];
    assert.ok(efter < fore, `${fore} → ${efter}`);
  });

  it("Givet en punkt i själva glaset, så står den still hur huvudet än rör sig", () => {
    const p = [10, -20, 0];
    const a = ndc({ x: 0, y: 0, z: 300 }, p), b = ndc({ x: -70, y: 30, z: 450 }, p);
    assert.ok(nara(a[0], b[0], 1e-5) && nara(a[1], b[1], 1e-5));
  });

  it("Givet att man lutar sig närmare, så syns mer av det som ligger bakom glaset", () => {
    // En punkt utanför fönsterkanten, långt bak, kommer in i bild när ögat närmar sig.
    const p = [60, 0, -300];
    assert.ok(Math.abs(ndc({ x: 0, y: 0, z: 600 }, p)[0]) > 1);
    assert.ok(Math.abs(ndc({ x: 0, y: 0, z: 150 }, p)[0]) < 1);
  });
});

describe("Egenskap: huvudets läge ur ansiktslandmärkena", () => {
  // Ett tänkt ansikte: ögonvrårna placeras kring (u, v) i bilden med ett visst
  // avstånd mellan ögonen, och resten av de 478 punkterna i mitten.
  const ansikte = (u, v, ogonavstandPx, bredd = 640, { djupskillnad = 0, vridning = 1 } = {}) => {
    const lm = Array.from({ length: 478 }, () => ({ x: u, y: v, z: 0 }));
    const halv = (ogonavstandPx * vridning) / 2 / bredd;
    const vrå = 7 / bredd;
    lm[33] = { x: u - halv - vrå, y: v, z: -djupskillnad };
    lm[133] = { x: u - halv + vrå, y: v, z: -djupskillnad };
    lm[362] = { x: u + halv - vrå, y: v, z: djupskillnad };
    lm[263] = { x: u + halv + vrå, y: v, z: djupskillnad };
    return lm;
  };
  const f = (bredd, hojd, fov = 75) => (Math.hypot(bredd, hojd) / 2) / Math.tan(fov * Math.PI / 360);

  it("Givet ögon som ser 63 mm isär ut på ett känt avstånd, så räknas just det avståndet fram", () => {
    const avstand = 350, px = f(640, 480) * 63 / avstand;
    const o = F.uppskattaOgon(ansikte(0.5, 0.5, px), 640, 480);
    assert.ok(nara(o.z, avstand, 0.01), `fick ${o.z}`);
    assert.ok(nara(o.x, 0, 1e-9) && nara(o.y, 0, 1e-9));
  });

  it("Givet att man flyttar sig mot skärmens högerkant, så hamnar man till vänster i den ospeglade bilden men åt höger i resultatet", () => {
    const o = F.uppskattaOgon(ansikte(0.3, 0.5, 100), 640, 480);
    assert.ok(o.x > 0, `x = ${o.x}`);
    const speglad = F.uppskattaOgon(ansikte(0.3, 0.5, 100), 640, 480, { spegla: true });
    assert.ok(nara(speglad.x, -o.x));
  });

  it("Givet att man höjer huvudet, så blir y positivt", () => {
    assert.ok(F.uppskattaOgon(ansikte(0.5, 0.3, 100), 640, 480).y > 0);
  });

  it("Givet att man vrider på huvudet, så tycks man inte komma längre bort", () => {
    // Vridet 40°: ögonen ser närmare varandra ut i sidled, men djupskillnaden
    // mellan dem kompenserar.
    const v = 40 * Math.PI / 180, px = 100;
    const rakt = F.uppskattaOgon(ansikte(0.5, 0.5, px), 640, 480);
    const vridet = F.uppskattaOgon(ansikte(0.5, 0.5, px, 640, {
      vridning: Math.cos(v), djupskillnad: (px / 2) * Math.sin(v) / 640,
    }), 640, 480);
    assert.ok(Math.abs(vridet.z - rakt.z) / rakt.z < 0.01, `${rakt.z} → ${vridet.z}`);
  });

  it("Givet för få landmärken eller ihopklämda ögon, så ges inget svar i stället för ett galet", () => {
    assert.equal(F.uppskattaOgon([], 640, 480), null);
    assert.equal(F.uppskattaOgon(ansikte(0.5, 0.5, 0), 640, 480), null);
  });

  it("Givet ett stående eller liggande grepp, så sitter kameran vid telefonens överkant", () => {
    assert.deepEqual(F.kameraposition(0, 65, 140, 0), { x: 0, y: 70 });
    assert.deepEqual(F.kameraposition(90, 140, 65, 0), { x: -70, y: 0 });
    assert.deepEqual(F.kameraposition(-90, 140, 65, 0), { x: 70, y: 0 });
    assert.deepEqual(F.kameraposition(180, 65, 140, 0), { x: 0, y: -70 });
  });
});

describe("Egenskap: rörelsen jämnas ut utan att släpa", () => {
  it("Givet ett huvud som står still med brus, så darrar resultatet mycket mindre än mätningarna", () => {
    const filter = new F.EnEuroFilter({ minGrans: 1, beta: 0.02 });
    let s = 1, utSumma = 0, inSumma = 0;
    const brus = () => { s = (s * 16807) % 2147483647; return (s / 2147483647 - 0.5) * 10; };
    for (let i = 0; i < 300; i++) {
      const matt = 20 + brus();
      const ut = filter.filtrera(matt, i / 30);
      if (i > 60) { inSumma += (matt - 20) ** 2; utSumma += (ut - 20) ** 2; }
    }
    assert.ok(utSumma < inSumma / 5, `brus in ${inSumma}, ut ${utSumma}`);
  });

  it("Givet en snabb rörelse, så hänger resultatet med inom några bildrutor", () => {
    const filter = new F.EnEuroFilter({ minGrans: 1, beta: 0.02 });
    let ut = 0;
    for (let i = 0; i < 30; i++) ut = filter.filtrera(0, i / 30);
    for (let i = 30; i < 36; i++) ut = filter.filtrera(100, i / 30);
    assert.ok(ut > 80, `efter 6 bildrutor: ${ut}`);
  });

  it("Givet att mätningarna kommer glesare än bildrutorna, så skjuts läget fram längs rörelsen – men högst en bit", () => {
    const filter = new F.EnEuroFilter({ minGrans: 1, beta: 0.02 });
    for (let i = 0; i < 30; i++) filter.filtrera(i * 5, i / 30); // 150 mm/s
    const nu = filter.x;
    assert.ok(filter.framat(29 / 30 + 0.02) > nu);
    assert.ok(nara(filter.framat(29 / 30 + 10), filter.framat(29 / 30 + 0.05)));
  });
});

// En splat i taget, för att bygga testfiler.
const splat = (pos, skala, farg, rot = [1, 0, 0, 0]) => ({ pos, skala, farg, rot });
const scenAv = (lista) => {
  const s = S.tomScen(lista.length);
  lista.forEach((p, i) => {
    s.pos.set(p.pos, i * 3); s.skala.set(p.skala, i * 3);
    s.farg.set(p.farg, i * 4); s.rot.set(p.rot, i * 4);
  });
  return s;
};

// Bygger en PLY-fil som originalkoden för 3DGS skriver den, med f_rest-fält
// som ska hoppas över.
function plyfil(punkter, { extraFore = null, format = "binary_little_endian" } = {}) {
  const egenskaper = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2",
    ...Array.from({ length: 45 }, (_, i) => `f_rest_${i}`),
    "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  let huvud = `ply\nformat ${format} 1.0\n`;
  if (extraFore) huvud += `element ${extraFore.namn} ${extraFore.antal}\nproperty uchar a\n`;
  huvud += `element vertex ${punkter.length}\n` + egenskaper.map((e) => `property float ${e}\n`).join("") + "end_header\n";
  const fore = extraFore ? extraFore.antal : 0;
  const buf = new ArrayBuffer(huvud.length + fore + punkter.length * egenskaper.length * 4);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < huvud.length; i++) u8[i] = huvud.charCodeAt(i);
  const dv = new DataView(buf);
  punkter.forEach((p, i) => {
    const varden = { ...p, nx: 0, ny: 0, nz: 0 };
    egenskaper.forEach((e, k) => {
      dv.setFloat32(huvud.length + fore + (i * egenskaper.length + k) * 4, varden[e] ?? 9.99, true);
    });
  });
  return buf;
}

describe("Egenskap: splatfiler läses rätt", () => {
  it("Givet en .splat-fil, så kommer position, skala, färg och rotation tillbaka", () => {
    const q = [Math.SQRT1_2, 0, Math.SQRT1_2, 0];
    const fore = scenAv([splat([1, 2, 3], [0.1, 0.2, 0.3], [10, 20, 30, 200], q), splat([-1, 0, 5], [1, 1, 1], [255, 0, 0, 255])]);
    const efter = S.lasFil(S.skrivSplat(fore));
    assert.equal(efter.antal, 2);
    assert.deepEqual([...efter.pos], [...fore.pos]);
    assert.deepEqual([...efter.skala], [...fore.skala]);
    assert.deepEqual([...efter.farg], [...fore.farg]);
    for (let k = 0; k < 4; k++) assert.ok(nara(efter.rot[k], q[k], 0.01));
  });

  it("Givet en fil vars storlek inte går jämnt ut, så förklaras felet i stället för att något halvt visas", () => {
    assert.throws(() => S.lasFil(new ArrayBuffer(33)), S.Splatfel);
  });

  it("Givet en PLY från 3DGS, så blir täckning, skala och färg rätt omräknade", () => {
    const buf = plyfil([{ x: 1, y: 2, z: 3, f_dc_0: 0, f_dc_1: 1, f_dc_2: -1, opacity: 0, scale_0: Math.log(0.5), scale_1: 0, scale_2: Math.log(2), rot_0: 2, rot_1: 0, rot_2: 0, rot_3: 0 }]);
    const s = S.lasFil(buf);
    assert.equal(s.antal, 1);
    assert.deepEqual([...s.pos], [1, 2, 3]);
    assert.equal(s.farg[0], 128);                               // 0,5 + 0
    assert.equal(s.farg[1], Math.round((0.5 + S.SH_C0) * 255)); // f_dc = 1
    assert.equal(s.farg[2], Math.round((0.5 - S.SH_C0) * 255));
    assert.equal(s.farg[3], 128);                               // sigmoid(0) = 0,5
    assert.ok(nara(s.skala[0], 0.5) && nara(s.skala[1], 1) && nara(s.skala[2], 2));
    assert.deepEqual([...s.rot], [1, 0, 0, 0]);                 // normaliserad
  });

  it("Givet ett annat element före punkterna, så hoppas det över", () => {
    const buf = plyfil([{ x: 7, y: 8, z: 9 }], { extraFore: { namn: "kamera", antal: 5 } });
    assert.deepEqual([...S.lasFil(buf).pos], [7, 8, 9]);
  });

  it("Givet en text-PLY eller en komprimerad PLY, så sägs det rakt ut att den inte stöds", () => {
    assert.throws(() => S.lasFil(plyfil([{ x: 0, y: 0, z: 0 }], { format: "ascii" })), /binära/);
    const komp = new TextEncoder().encode("ply\nformat binary_little_endian 1.0\nelement chunk 1\nproperty float min_x\nelement vertex 1\nproperty uint packed_position\nend_header\n");
    const buf = new Uint8Array(komp.length + 8); buf.set(komp);
    assert.throws(() => S.lasFil(buf.buffer), /Komprimerade/);
  });

  it("Givet ett vanligt punktmoln utan storlek, så får punkterna en storlek ändå", () => {
    const huvud = "ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n";
    const buf = new ArrayBuffer(huvud.length + 3 * 15);
    new Uint8Array(buf).set(new TextEncoder().encode(huvud));
    const dv = new DataView(buf);
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((p, i) => {
      p.forEach((v, k) => dv.setFloat32(huvud.length + i * 15 + k * 4, v, true));
      dv.setUint8(huvud.length + i * 15 + 12, 255);
    });
    const s = S.lasFil(buf);
    assert.equal(s.farg[0], 255);
    assert.equal(s.farg[3], 255);
    assert.ok(s.skala[0] > 0);
  });
});

describe("Egenskap: scenen ramas in och packas", () => {
  it("Givet några lösa splattar långt ute, så flyttas varken mitten eller storleken nämnvärt", () => {
    const lista = [];
    for (let i = 0; i < 1000; i++) lista.push(splat([Math.sin(i), Math.cos(i * 1.3), Math.sin(i * 0.7)], [1, 1, 1], [0, 0, 0, 255]));
    const utan = S.ramaIn(scenAv(lista));
    for (let i = 0; i < 20; i++) lista.push(splat([500 + i, -800, 900], [1, 1, 1], [0, 0, 0, 255]));
    const med = S.ramaIn(scenAv(lista));
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(med.centrum[k] - utan.centrum[k]) < 0.05);
    assert.ok(Math.abs(med.r50 - utan.r50) / utan.r50 < 0.05);
  });

  it("Givet en avlång splat, så hamnar dess kovarians rätt i texturen efter flytt och skalning", () => {
    // Längs x med σ = 2, vriden 90° runt z så att den ligger längs y.
    const q = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const p = S.packa(scenAv([splat([4, 5, 6], [2, 0.5, 0.5], [1, 2, 3, 4], q)]), { centrum: [4, 5, 6], skala: 3 });
    const halvor = (u) => [S.franHalv(u & 0xffff), S.franHalv(u >>> 16)];
    const [xx, xy] = halvor(p.data[4]), [xz, yy] = halvor(p.data[5]), [yz, zz] = halvor(p.data[6]);
    assert.ok(nara(yy, 36, 0.05), `yy = ${yy}`);           // (3 · 2)²
    assert.ok(nara(xx, 2.25, 0.01) && nara(zz, 2.25, 0.01)); // (3 · 0,5)²
    assert.ok(nara(xy, 0, 1e-3) && nara(xz, 0, 1e-3) && nara(yz, 0, 1e-3));
    assert.deepEqual([...p.positioner], [0, 0, 0]);
    assert.equal(p.data[3], 1 | (2 << 8) | (3 << 16) | (4 << 24));
  });

  it("Givet COLMAP-axlar, så pekar y uppåt och scenen ligger framför betraktaren", () => {
    const p = S.packa(scenAv([splat([0, -1, 2], [1, 1, 1], [0, 0, 0, 255])]), { rotation: S.COLMAP_TILL_FONSTER });
    assert.deepEqual([...p.positioner], [0, 1, -2]);
  });

  it("Givet halvprecision, så överlever både små och stora tal omvandlingen", () => {
    for (const v of [0, 1, -2.5, 1e-3, 3e-5, 65504, 0.1234]) {
      const tillbaka = S.franHalv(S.tillHalv(v));
      assert.ok(Math.abs(tillbaka - v) <= Math.abs(v) * 1e-3 + 1e-7, `${v} → ${tillbaka}`);
    }
    assert.equal(S.franHalv(S.tillHalv(1e9)), 65504); // för stort blir det största som går
  });
});

describe("Egenskap: splattarna ritas bakifrån och fram", () => {
  it("Givet en vy, så kommer den splat som ligger längst bort först", () => {
    const pos = Float32Array.from([0, 0, -10, 0, 0, -500, 0, 0, 5, 0, 0, -50]);
    const ordning = sorteraDjup(pos, 4, F.vymatris({ x: 0, y: 0, z: 300 }));
    assert.deepEqual([...ordning], [1, 3, 0, 2]);
  });

  it("Givet att huvudet bara flyttas, så ändras inte ordningen", () => {
    const pos = Float32Array.from(Array.from({ length: 300 }, (_, i) => Math.sin(i * 12.9898) * 100));
    const a = sorteraDjup(pos, 100, F.vymatris({ x: 0, y: 0, z: 300 }));
    const b = sorteraDjup(pos, 100, F.vymatris({ x: 90, y: -60, z: 200 }));
    assert.deepEqual([...a], [...b]);
  });
});

describe("Egenskap: demoscenen", () => {
  const { scen, djup, rumsdjup } = neonrummet(65, 140);

  it("Givet en telefonskärm, så blir rummet lika stort som skärmen med öppningen i glaset", () => {
    let maxX = 0, maxY = 0;
    for (let i = 0; i < scen.antal; i++) {
      maxX = Math.max(maxX, Math.abs(scen.pos[i * 3]));
      maxY = Math.max(maxY, Math.abs(scen.pos[i * 3 + 1]));
    }
    assert.ok(nara(maxX, 65 / 2, 1) && nara(maxY, 140 / 2, 1), `${maxX} × ${maxY}`);
    assert.equal(djup, -rumsdjup / 2);
  });

  it("Givet att något ska sticka ut ur glaset, så finns det splattar framför skärmen", () => {
    let framfor = 0;
    for (let i = 0; i < scen.antal; i++) if (scen.pos[i * 3 + 2] + djup > 2) framfor++;
    assert.ok(framfor > 1000, `${framfor} splattar framför glaset`);
  });

  it("Givet samma skärm två gånger, så blir scenen exakt likadan och utan trasiga tal", () => {
    const igen = neonrummet(65, 140).scen;
    assert.deepEqual(igen.pos, scen.pos);
    assert.ok(scen.pos.every(Number.isFinite) && scen.skala.every((v) => v > 0) && scen.rot.every(Number.isFinite));
    assert.ok(scen.antal > 30000 && scen.antal < 200000, `${scen.antal} splattar`);
  });
});

describe("Egenskap: den medföljande scenen", () => {
  it("Givet gosedjuret som visas först, så går filen att läsa och har rimliga värden", () => {
    const fs = require("node:fs");
    const b = fs.readFileSync(require("node:path").join(__dirname, "../docs/splat/scener/gosedjur.splat"));
    const scen = S.lasFil(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    assert.equal(scen.antal, 49602);
    assert.ok(scen.pos.every(Number.isFinite) && scen.skala.every((v) => v >= 0 && Number.isFinite(v)));
    const { r50 } = S.ramaIn(scen);
    assert.ok(r50 > 0);
  });
});
