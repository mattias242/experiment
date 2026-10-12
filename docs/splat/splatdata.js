// Inläsning av Gaussian splats (.splat och .ply) och packning till det
// format som renderaren läser ur en textur.
// Delas mellan webbläsaren (app.js) och Node (testerna). Kör: node --test
//
// Internt beskrivs en scen av fyra parallella listor, en post per splat:
//   pos   Float32Array(3n)  mittpunkt
//   skala Float32Array(3n)  standardavvikelse längs splattens egna axlar
//   rot   Float32Array(4n)  rotation som enhetskvaternion (w, x, y, z)
//   farg  Uint8Array(4n)    rgba, där a är täckningen (redan genom sigmoid)
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Splatdata = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // Fel som går att visa för användaren som de är.
  class Splatfel extends Error {}

  const SH_C0 = 0.28209479177387814; // nollte ordningens sfäriska harmoniska

  const tomScen = (antal) => ({
    antal,
    pos: new Float32Array(antal * 3),
    skala: new Float32Array(antal * 3),
    rot: new Float32Array(antal * 4),
    farg: new Uint8Array(antal * 4),
  });

  const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));

  // ---- .splat -------------------------------------------------------------
  // antimatter15:s råformat: 32 byte per splat. Position och skala som
  // float32, färg som rgba-byte, rotation som fyra byte (w, x, y, z) där
  // 128 betyder noll.

  function lasSplat(buffer) {
    if (buffer.byteLength === 0 || buffer.byteLength % 32 !== 0) {
      throw new Splatfel('Filen ser inte ut som en .splat-fil (storleken går inte jämnt ut på 32 byte per splat).');
    }
    const antal = buffer.byteLength / 32;
    const f = new Float32Array(buffer, 0, antal * 8);
    const u = new Uint8Array(buffer);
    const scen = tomScen(antal);
    for (let i = 0; i < antal; i++) {
      for (let k = 0; k < 3; k++) {
        scen.pos[i * 3 + k] = f[i * 8 + k];
        scen.skala[i * 3 + k] = f[i * 8 + 3 + k];
      }
      for (let k = 0; k < 4; k++) scen.farg[i * 4 + k] = u[i * 32 + 24 + k];
      let w = (u[i * 32 + 28] - 128) / 128, x = (u[i * 32 + 29] - 128) / 128;
      let y = (u[i * 32 + 30] - 128) / 128, z = (u[i * 32 + 31] - 128) / 128;
      const l = Math.hypot(w, x, y, z) || 1;
      scen.rot.set([w / l, x / l, y / l, z / l], i * 4);
    }
    return scen;
  }

  function skrivSplat(scen) {
    const buffer = new ArrayBuffer(scen.antal * 32);
    const f = new Float32Array(buffer);
    const u = new Uint8Array(buffer);
    for (let i = 0; i < scen.antal; i++) {
      for (let k = 0; k < 3; k++) {
        f[i * 8 + k] = scen.pos[i * 3 + k];
        f[i * 8 + 3 + k] = scen.skala[i * 3 + k];
      }
      for (let k = 0; k < 4; k++) {
        u[i * 32 + 24 + k] = scen.farg[i * 4 + k];
        u[i * 32 + 28 + k] = byte(scen.rot[i * 4 + k] * 128 + 128);
      }
    }
    return buffer;
  }

  // ---- .ply ---------------------------------------------------------------
  // Formatet som originalkoden för 3D Gaussian Splatting skriver, och som
  // Polycam, Luma, Postshot, Scaniverse m.fl. exporterar: en vertex per splat
  // med x/y/z, f_dc_0–2 (färgen som sfärisk harmonisk), opacity (före sigmoid),
  // scale_0–2 (logaritmerade) och rot_0–3 (kvaternion, w först). Högre ordningars
  // harmoniska (f_rest_*) hoppas över – de styr hur färgen skiftar med
  // betraktningsvinkeln, och utan dem blir det fortfarande rätt färg rakt fram.
  //
  // Vanliga punktmoln (bara x/y/z och red/green/blue) läses också, och får då
  // en automatisk storlek.

  const PLYTYPER = {
    char: [1, 'getInt8'], int8: [1, 'getInt8'],
    uchar: [1, 'getUint8'], uint8: [1, 'getUint8'],
    short: [2, 'getInt16'], int16: [2, 'getInt16'],
    ushort: [2, 'getUint16'], uint16: [2, 'getUint16'],
    int: [4, 'getInt32'], int32: [4, 'getInt32'],
    uint: [4, 'getUint32'], uint32: [4, 'getUint32'],
    float: [4, 'getFloat32'], float32: [4, 'getFloat32'],
    double: [8, 'getFloat64'], float64: [8, 'getFloat64'],
  };

  function lasPlyhuvud(bytes) {
    const n = Math.min(bytes.length, 1 << 16);
    let text = '';
    for (let i = 0; i < n; i++) text += String.fromCharCode(bytes[i]);
    const slut = text.indexOf('end_header');
    if (!text.startsWith('ply') || slut < 0) throw new Splatfel('Filen ser inte ut som en PLY-fil.');
    const radslut = text.indexOf('\n', slut);
    const rader = text.slice(0, slut).split(/\r?\n/).map((r) => r.trim()).filter(Boolean);

    const element = [];
    let format = null;
    for (const rad of rader.slice(1)) {
      const d = rad.split(/\s+/);
      if (d[0] === 'format') format = d[1];
      else if (d[0] === 'element') element.push({ namn: d[1], antal: Number(d[2]), egenskaper: [], lista: false });
      else if (d[0] === 'property' && element.length) {
        const el = element[element.length - 1];
        if (d[1] === 'list') el.lista = true;
        else {
          if (!PLYTYPER[d[1]]) throw new Splatfel(`PLY-filen har en okänd datatyp: ${d[1]}.`);
          el.egenskaper.push({ namn: d[2], typ: d[1] });
        }
      }
    }
    if (format !== 'binary_little_endian') {
      throw new Splatfel('Bara binära PLY-filer (binary_little_endian) stöds – den här är ' + (format || 'okänd') + '.');
    }
    return { element, start: radslut + 1 };
  }

  function lasPly(buffer) {
    const bytes = new Uint8Array(buffer);
    const { element, start } = lasPlyhuvud(bytes);

    let offset = start;
    let vertex = null;
    for (const el of element) {
      if (el.namn === 'vertex') { vertex = el; break; }
      if (el.lista) throw new Splatfel('PLY-filen har listor före punkterna och kan inte läsas.');
      offset += el.antal * el.egenskaper.reduce((s, e) => s + PLYTYPER[e.typ][0], 0);
    }
    if (!vertex) throw new Splatfel('PLY-filen innehåller inga punkter.');
    if (vertex.lista) throw new Splatfel('PLY-filens punkter innehåller listor och kan inte läsas.');

    const lage = {};
    let steg = 0;
    for (const e of vertex.egenskaper) {
      lage[e.namn] = { offset: steg, metod: PLYTYPER[e.typ][1], typ: e.typ };
      steg += PLYTYPER[e.typ][0];
    }
    if (lage.packed_position) {
      throw new Splatfel('Komprimerade PLY-filer (från SuperSplat/PlayCanvas) stöds inte – exportera som vanlig PLY.');
    }
    if (!lage.x || !lage.y || !lage.z) throw new Splatfel('PLY-filens punkter saknar x, y och z.');

    const antal = vertex.antal;
    if (offset + antal * steg > bytes.length) throw new Splatfel('PLY-filen är avkortad – den slutar innan alla punkter kommit.');

    const dv = new DataView(buffer);
    const lasare = (namn) => {
      const l = lage[namn];
      if (!l) return null;
      const skala = (l.typ === 'uchar' || l.typ === 'uint8') ? 1 / 255 : 1;
      return (bas) => dv[l.metod](bas + l.offset, true) * skala;
    };
    const [x, y, z] = ['x', 'y', 'z'].map(lasare);
    const dc = ['f_dc_0', 'f_dc_1', 'f_dc_2'].map(lasare);
    const rgb = ['red', 'green', 'blue'].map(lasare);
    const opacitet = lasare('opacity');
    const skalor = ['scale_0', 'scale_1', 'scale_2'].map(lasare);
    const rot = ['rot_0', 'rot_1', 'rot_2', 'rot_3'].map(lasare);
    const harDc = dc.every(Boolean), harRgb = rgb.every(Boolean);
    const harSkala = skalor.every(Boolean), harRot = rot.every(Boolean);

    const scen = tomScen(antal);
    for (let i = 0; i < antal; i++) {
      const bas = offset + i * steg;
      scen.pos[i * 3] = x(bas); scen.pos[i * 3 + 1] = y(bas); scen.pos[i * 3 + 2] = z(bas);

      for (let k = 0; k < 3; k++) {
        const c = harDc ? 0.5 + SH_C0 * dc[k](bas) : harRgb ? rgb[k](bas) : 0.8;
        scen.farg[i * 4 + k] = byte(c * 255);
      }
      scen.farg[i * 4 + 3] = opacitet ? byte(255 / (1 + Math.exp(-opacitet(bas)))) : 255;

      if (harSkala) for (let k = 0; k < 3; k++) scen.skala[i * 3 + k] = Math.exp(skalor[k](bas));

      if (harRot) {
        const q = rot.map((r) => r(bas));
        const l = Math.hypot(...q) || 1;
        for (let k = 0; k < 4; k++) scen.rot[i * 4 + k] = q[k] / l;
      } else scen.rot[i * 4] = 1;
    }

    // Ett punktmoln har ingen storlek per punkt. Gör varje punkt ungefär så
    // stor som avståndet till grannarna, så att ytorna sluter sig.
    if (!harSkala) {
      const { r50 } = ramaIn(scen);
      const s = (r50 || 1) * 1.5 / Math.sqrt(antal);
      scen.skala.fill(s);
    }
    return scen;
  }

  // Vilket format en fil har avgörs av innehållet, inte av ändelsen – filer
  // byter gärna namn på vägen.
  function lasFil(buffer) {
    const b = new Uint8Array(buffer, 0, Math.min(3, buffer.byteLength));
    if (b[0] === 0x70 && b[1] === 0x6c && b[2] === 0x79) return lasPly(buffer); // "ply"
    return lasSplat(buffer);
  }

  // ---- Inramning ----------------------------------------------------------

  // Var scenens tyngdpunkt ligger och hur stor den är. Medianer i stället för
  // medelvärden och extremvärden: tränade scener har nästan alltid lösa
  // "floaters" långt ute och en himmel av jättesplattar runt omkring, och de
  // ska inte få flytta mitten eller krympa motivet.
  function ramaIn(scen, maxUrval = 60000) {
    const n = scen.antal;
    const steg = Math.max(1, Math.floor(n / maxUrval));
    let urval = [];
    for (let i = 0; i < n; i += steg) if (scen.farg[i * 4 + 3] >= 64) urval.push(i);
    if (urval.length < 16) { urval = []; for (let i = 0; i < n; i += steg) urval.push(i); }

    const median = (a) => { a.sort(); return a.length ? a[a.length >> 1] : 0; };
    const axel = (k) => Float32Array.from(urval, (i) => scen.pos[i * 3 + k]);
    const centrum = [median(axel(0)), median(axel(1)), median(axel(2))];
    const avstand = Float32Array.from(urval, (i) => Math.hypot(
      scen.pos[i * 3] - centrum[0], scen.pos[i * 3 + 1] - centrum[1], scen.pos[i * 3 + 2] - centrum[2]));
    avstand.sort();
    const kvantil = (q) => avstand.length ? avstand[Math.min(avstand.length - 1, Math.floor(q * avstand.length))] : 0;
    return { centrum, r50: kvantil(0.5), r90: kvantil(0.9) };
  }

  // ---- Packning -----------------------------------------------------------

  const f32 = new Float32Array(1);
  const i32 = new Int32Array(f32.buffer);

  // float32 → float16-bitar. Kovariansen får plats som halvprecision och då
  // ryms en hel splat i två texlar.
  function tillHalv(v) {
    f32[0] = v;
    const x = i32[0];
    const tecken = (x >>> 16) & 0x8000;
    const e = (x >>> 23) & 0xff;
    const mantissa = x & 0x7fffff;
    if (e === 0xff) return tecken | 0x7c00 | (mantissa ? 0x200 : 0);
    const exp = e - 127 + 15;
    if (exp >= 31) return tecken | 0x7bff; // för stort: största ändliga värdet
    if (exp <= 0) {
      if (exp < -10) return tecken;
      return tecken | ((((mantissa | 0x800000) >> (1 - exp)) + 0x1000) >> 13);
    }
    return tecken | ((exp << 10) + ((mantissa + 0x1000) >> 13));
  }

  function franHalv(h) {
    const tecken = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const m = h & 0x3ff;
    if (exp === 0) return tecken * m * 2 ** -24;
    if (exp === 31) return m ? NaN : tecken * Infinity;
    return tecken * (1 + m / 1024) * 2 ** (exp - 15);
  }

  const TEXBREDD = 2048; // texlar per rad; två per splat ger 1024 splattar per rad

  // Packar scenen till texturdata och flyttar samtidigt in den i
  // fönstrets koordinater: p' = skala · R · (p − centrum). Kovariansen
  // Σ = M Mᵀ med M = skala · R · R(q) · diag(s) räknas här en gång för alla, så
  // att grafikkortet bara behöver projicera den.
  //
  // Per splat, 2 texlar à 4 × uint32:
  //   [x, y, z, rgba]  [Σxx|Σxy, Σxz|Σyy, Σyz|Σzz, 0]   (| = två halvfloats)
  function packa(scen, { centrum = [0, 0, 0], skala = 1, rotation = [1, 0, 0, 0, 1, 0, 0, 0, 1] } = {}) {
    const n = scen.antal;
    const hojd = Math.max(1, Math.ceil(n / (TEXBREDD / 2)));
    const data = new Uint32Array(TEXBREDD * hojd * 4);
    const dataF = new Float32Array(data.buffer);
    const positioner = new Float32Array(n * 3);
    const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = rotation; // radvis

    for (let i = 0; i < n; i++) {
      const px = scen.pos[i * 3] - centrum[0];
      const py = scen.pos[i * 3 + 1] - centrum[1];
      const pz = scen.pos[i * 3 + 2] - centrum[2];
      const x = skala * (r0 * px + r1 * py + r2 * pz);
      const y = skala * (r3 * px + r4 * py + r5 * pz);
      const z = skala * (r6 * px + r7 * py + r8 * pz);
      positioner[i * 3] = x; positioner[i * 3 + 1] = y; positioner[i * 3 + 2] = z;
      dataF[i * 8] = x; dataF[i * 8 + 1] = y; dataF[i * 8 + 2] = z;
      data[i * 8 + 3] = (scen.farg[i * 4] | (scen.farg[i * 4 + 1] << 8) |
        (scen.farg[i * 4 + 2] << 16) | (scen.farg[i * 4 + 3] << 24)) >>> 0;

      const w = scen.rot[i * 4], qx = scen.rot[i * 4 + 1], qy = scen.rot[i * 4 + 2], qz = scen.rot[i * 4 + 3];
      const sx = scen.skala[i * 3] * skala, sy = scen.skala[i * 3 + 1] * skala, sz = scen.skala[i * 3 + 2] * skala;
      // R(q) · diag(s), rad för rad
      const a0 = (1 - 2 * (qy * qy + qz * qz)) * sx, a1 = 2 * (qx * qy - w * qz) * sy, a2 = 2 * (qx * qz + w * qy) * sz;
      const b0 = 2 * (qx * qy + w * qz) * sx, b1 = (1 - 2 * (qx * qx + qz * qz)) * sy, b2 = 2 * (qy * qz - w * qx) * sz;
      const c0 = 2 * (qx * qz - w * qy) * sx, c1 = 2 * (qy * qz + w * qx) * sy, c2 = (1 - 2 * (qx * qx + qy * qy)) * sz;
      // M = R_fönster · R(q) · diag(s)
      const m00 = r0 * a0 + r1 * b0 + r2 * c0, m01 = r0 * a1 + r1 * b1 + r2 * c1, m02 = r0 * a2 + r1 * b2 + r2 * c2;
      const m10 = r3 * a0 + r4 * b0 + r5 * c0, m11 = r3 * a1 + r4 * b1 + r5 * c1, m12 = r3 * a2 + r4 * b2 + r5 * c2;
      const m20 = r6 * a0 + r7 * b0 + r8 * c0, m21 = r6 * a1 + r7 * b1 + r8 * c1, m22 = r6 * a2 + r7 * b2 + r8 * c2;
      const xx = m00 * m00 + m01 * m01 + m02 * m02;
      const xy = m00 * m10 + m01 * m11 + m02 * m12;
      const xz = m00 * m20 + m01 * m21 + m02 * m22;
      const yy = m10 * m10 + m11 * m11 + m12 * m12;
      const yz = m10 * m20 + m11 * m21 + m12 * m22;
      const zz = m20 * m20 + m21 * m21 + m22 * m22;
      data[i * 8 + 4] = (tillHalv(xx) | (tillHalv(xy) << 16)) >>> 0;
      data[i * 8 + 5] = (tillHalv(xz) | (tillHalv(yy) << 16)) >>> 0;
      data[i * 8 + 6] = (tillHalv(yz) | (tillHalv(zz) << 16)) >>> 0;
    }
    return { antal: n, data, bredd: TEXBREDD, hojd, positioner };
  }

  // Tränade scener (COLMAP, originalkoden för 3DGS och det mesta som bygger på
  // den) har y nedåt och z framåt, sett från den första kamerabilden. Ett halvt
  // varv runt x-axeln ger fönstrets y uppåt och z mot betraktaren, och då tittar
  // man in i scenen åt samma håll som den första bilden togs.
  const COLMAP_TILL_FONSTER = [1, 0, 0, 0, -1, 0, 0, 0, -1];

  return {
    Splatfel, SH_C0, tomScen, lasSplat, skrivSplat, lasPly, lasFil, ramaIn,
    tillHalv, franHalv, packa, TEXBREDD, COLMAP_TILL_FONSTER,
  };
});
