// Förändringskartan: ritar skillnaden mellan riksdagsvalen 2026 och 2022.
// Ingen server, inga bibliotek – TopoJSON avkodas och ritas på en canvas här.
// Räknandet ligger i kartlogik.js, som också testas från Node.
'use strict';

(function () {
  const K = window.Kartlogik;
  const $ = (id) => document.getElementById(id);

  const MAPP = 'valdata/';
  const HAV = '#eaeef2';
  const INGEN_JAMFORELSE = '#f2f0ec';    // finns men saknar 2022-siffror
  const INTE_RAKNAT = '#e2e5ea';
  const UTANFOR = '#dfe3e9';             // utanför det valda området

  // ---- Läge ---------------------------------------------------------------

  const lage = {
    matt: 0,                     // index i partilistan, eller 'valdeltagande'
    niva: 'valkrets',            // valkrets | kommun | valdistrikt
    omrade: { typ: 'riket', kod: null },
    skala: 'auto',
    vald: null,                  // { niva, kod }
    sortering: 'ned',
  };

  let meta = null;
  let omraden = null;
  let distriktPerKod = new Map();

  // Varje nivå fylls på av laddaLager med { laddar, enheter: [...], perKod: Map }
  const lager = {
    valkrets: { fil: 'geografi-valkrets.json', objekt: 'valkrets' },
    kommun: { fil: 'geografi-kommun.json', objekt: 'kommun' },
    valdistrikt: { fil: 'geografi-valdistrikt.json', objekt: 'valdistrikt' },
  };

  const NIVANAMN = { valkrets: 'Region', kommun: 'Kommun', valdistrikt: 'Valdistrikt' };
  const NIVANAMN_FLER = { valkrets: 'regioner', kommun: 'kommuner', valdistrikt: 'valdistrikt' };

  // ---- Hämtning -----------------------------------------------------------

  async function hamtaJson(fil) {
    const svar = await fetch(MAPP + fil);
    if (!svar.ok) throw new Error(`Kunde inte hämta ${fil} (HTTP ${svar.status})`);
    return svar.json();
  }

  // ---- TopoJSON -----------------------------------------------------------

  // Avkodar ett TopoJSON till ringar i SWEREF 99 TM (meter). Kartan ritas i den
  // projektionen rakt av – den är gjord för Sverige, så norr är upp och avstånd
  // stämmer utan att vi behöver räkna om något.
  function avkodaTopo(topo, objektnamn) {
    const [sx, sy] = topo.transform.scale;
    const [tx, ty] = topo.transform.translate;

    const bagar = topo.arcs.map((bage) => {
      const ut = new Float64Array(bage.length * 2);
      let x = 0;
      let y = 0;
      for (let i = 0; i < bage.length; i++) {
        x += bage[i][0];
        y += bage[i][1];
        ut[2 * i] = x * sx + tx;
        ut[2 * i + 1] = y * sy + ty;
      }
      return ut;
    });

    // En ring är en lista bågindex; negativa index betyder "samma båge baklänges".
    // Sista punkten i en båge är samma som första i nästa, så den hoppas över.
    const ring = (index) => {
      const punkter = [];
      for (const i of index) {
        const baklanges = i < 0;
        const b = bagar[baklanges ? ~i : i];
        const n = b.length / 2;
        for (let steg = 0; steg < n; steg++) {
          if (punkter.length && steg === 0) continue;
          const j = baklanges ? n - 1 - steg : steg;
          punkter.push(b[2 * j], b[2 * j + 1]);
        }
      }
      return Float64Array.from(punkter);
    };

    return topo.objects[objektnamn].geometries.map((g) => {
      const ringar = g.type === 'MultiPolygon'
        ? g.arcs.flat().map(ring)
        : (g.arcs || []).map(ring);
      return { ringar, props: g.properties || {} };
    });
  }

  function byggEnhet(ringar, props) {
    const bana = new Path2D();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of ringar) {
      if (r.length < 6) continue;
      bana.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) bana.lineTo(r[i], r[i + 1]);
      bana.closePath();
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < minX) minX = r[i];
        if (r[i] > maxX) maxX = r[i];
        if (r[i + 1] < minY) minY = r[i + 1];
        if (r[i + 1] > maxY) maxY = r[i + 1];
      }
    }
    return { ringar, bana, ruta: [minX, minY, maxX, maxY], props };
  }

  async function laddaLager(niva) {
    const l = lager[niva];
    if (l.enheter) return l;
    if (!l.laddar) {
      l.laddar = (async () => {
        const behov = [hamtaJson(l.fil)];
        if (niva === 'valdistrikt' && !distriktPerKod.size) {
          behov.push(hamtaJson('valdistrikt.json'));
        }
        const [topo, distrikt] = await Promise.all(behov);
        if (distrikt) fyllDistrikt(distrikt);
        l.enheter = avkodaTopo(topo, l.objekt).map((f) => {
          const e = byggEnhet(f.ringar, f.props);
          if (niva === 'valkrets') {
            e.kod = f.props.Riksdagsvalkretskod;
            e.namn = f.props.Riksdagsvalkrets;
          } else if (niva === 'kommun') {
            e.kod = f.props.Kommunkod;
            e.namn = f.props.Kommun;
            e.vk = f.props.Riksdagsvalkretskod;
          } else {
            e.kod = f.props.Valdistriktskod;
            const d = distriktPerKod.get(e.kod);
            e.namn = d ? d.n : e.kod;
            e.km = e.kod.slice(0, 4);
            e.vk = d ? d.vk : null;
          }
          e.data = dataFor(niva, e.kod);
          return e;
        });
        l.perKod = new Map(l.enheter.map((e) => [e.kod, e]));
        return l;
      })();
    }
    return l.laddar;
  }

  function fyllDistrikt(distrikt) {
    distriktPerKod = new Map(distrikt.map((d) => [d.k, d]));
  }

  const dataFor = (niva, kod) => {
    if (niva === 'valkrets') return omraden.vk[kod] || null;
    if (niva === 'kommun') return omraden.km[kod] || null;
    return distriktPerKod.get(kod) || null;
  };

  // ---- Vilka enheter som visas -------------------------------------------

  function synligaEnheter() {
    const l = lager[lage.niva];
    if (!l.enheter) return [];
    const o = lage.omrade;
    if (o.typ === 'riket') return l.enheter;
    if (o.typ === 'valkrets') {
      if (lage.niva === 'valkrets') return l.enheter.filter((e) => e.kod === o.kod);
      return l.enheter.filter((e) => e.vk === o.kod);
    }
    // kommun
    if (lage.niva === 'valdistrikt') return l.enheter.filter((e) => e.km === o.kod);
    if (lage.niva === 'kommun') return l.enheter.filter((e) => e.kod === o.kod);
    return l.enheter.filter((e) => e.kod === kommunensValkrets(o.kod));
  }

  const kommunensValkrets = (kommunkod) =>
    (omraden.km[kommunkod] && omraden.km[kommunkod].vk) || null;

  // ---- Duken --------------------------------------------------------------

  const duk = $('duk');
  const ctx = duk.getContext('2d');
  const vy = { x: 0, y: 0, k: 1 };            // mittpunkt i meter + meter→pixel
  let bredd = 0;
  let hojd = 0;
  let hovrad = null;

  function matDuken() {
    const dpr = window.devicePixelRatio || 1;
    const r = duk.getBoundingClientRect();
    bredd = Math.max(1, Math.round(r.width));
    hojd = Math.max(1, Math.round(r.height));
    duk.width = Math.round(bredd * dpr);
    duk.height = Math.round(hojd * dpr);
  }

  function passaIn(enheter, marginal = 0.94) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const e of enheter) {
      if (!Number.isFinite(e.ruta[0])) continue;
      minX = Math.min(minX, e.ruta[0]);
      minY = Math.min(minY, e.ruta[1]);
      maxX = Math.max(maxX, e.ruta[2]);
      maxY = Math.max(maxY, e.ruta[3]);
    }
    if (!Number.isFinite(minX)) return;
    vy.x = (minX + maxX) / 2;
    vy.y = (minY + maxY) / 2;
    vy.k = Math.min(bredd / Math.max(maxX - minX, 1), hojd / Math.max(maxY - minY, 1)) * marginal;
  }

  const tillVarld = (px, py) => [
    (px - bredd / 2) / vy.k + vy.x,
    vy.y - (py - hojd / 2) / vy.k,
  ];

  // Hur många procentenheter skalan sträcker sig åt vardera hållet. Räknas på
  // hela landet, inte på det man råkar ha på skärmen, så att en färg betyder
  // samma sak före och efter att man zoomat in.
  const skalcache = new Map();
  function skalansMax() {
    if (lage.skala !== 'auto') return Number(lage.skala);
    const nyckel = `${lage.niva}/${lage.matt}`;
    const alla = lager[lage.niva].enheter;
    if (!alla || !alla.length) return 5;      // hunnit fråga innan lagret laddats
    if (!skalcache.has(nyckel)) {
      skalcache.set(nyckel, K.automatiskSkala(
        alla.map((e) => K.forandring(e.data, lage.matt)),
        alla.map((e) => (e.data && e.data.rb) || 1),
      ));
    }
    return skalcache.get(nyckel);
  }

  function fargFor(enhet, max) {
    const d = enhet.data;
    if (!d) return INTE_RAKNAT;
    if (lage.niva === 'valdistrikt' && !d.c) return INTE_RAKNAT;
    const f = K.forandring(d, lage.matt);
    return f === null ? INGEN_JAMFORELSE : K.farg(f, max);
  }

  function rita() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = HAV;
    ctx.fillRect(0, 0, bredd, hojd);

    const enheter = synligaEnheter();
    if (!enheter.length) return;
    const max = skalansMax();
    const iOmradet = new Set(enheter);

    const [v0x, v0y] = tillVarld(0, hojd);
    const [v1x, v1y] = tillVarld(bredd, 0);
    const inom = (r) => r[2] >= v0x && r[0] <= v1x && r[3] >= v0y && r[1] <= v1y;

    // Norr är upp: y växer uppåt i SWEREF men nedåt på skärmen.
    ctx.setTransform(dpr * vy.k, 0, 0, -dpr * vy.k,
      dpr * (bredd / 2 - vy.x * vy.k), dpr * (hojd / 2 + vy.y * vy.k));

    // Resten av landet ritas i grått under. Utan det svävar ett inzoomat
    // område fritt i havet och det går inte att se var i Sverige man är.
    const ritade = [];
    for (const e of lager[lage.niva].enheter) {
      if (!inom(e.ruta)) continue;
      const valt = iOmradet.has(e);
      if (valt) ritade.push(e);
      ctx.fillStyle = valt ? fargFor(e, max) : UTANFOR;
      ctx.fill(e.bana);
    }

    // Tunna gränser bara när de hinner synas – annars blir kartan ett grått nät.
    if (ritade.length <= 1600) {
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = 0.7 / vy.k;
      for (const e of ritade) ctx.stroke(e.bana);
    }

    // Överordnade gränser ovanpå, så att man ser var kommunen slutar.
    const over = lage.niva === 'valdistrikt' ? 'kommun'
      : lage.niva === 'kommun' ? 'valkrets' : null;
    if (over && lager[over].enheter) {
      ctx.strokeStyle = 'rgba(40,54,72,.4)';
      ctx.lineWidth = 1.1 / vy.k;
      for (const e of lager[over].enheter) {
        if (inom(e.ruta)) ctx.stroke(e.bana);
      }
    }

    for (const [enhet, farg, tjocklek] of [
      [hovrad, '#1c2733', 1.8],
      [valdEnhet(), '#2f5aa8', 2.6],
    ]) {
      if (!enhet) continue;
      ctx.strokeStyle = farg;
      ctx.lineWidth = tjocklek / vy.k;
      ctx.stroke(enhet.bana);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ritLegend(max);
  }

  const valdEnhet = () => {
    if (!lage.vald || lage.vald.niva !== lage.niva) return null;
    const l = lager[lage.niva];
    return (l.perKod && l.perKod.get(lage.vald.kod)) || null;
  };

  // ---- Träffsökning -------------------------------------------------------

  function iRing(ring, x, y) {
    let inne = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const yi = ring[i + 1];
      const yj = ring[j + 1];
      if ((yi > y) !== (yj > y)) {
        const t = (y - yi) / (yj - yi);
        if (x < ring[i] + t * (ring[j] - ring[i])) inne = !inne;
      }
    }
    return inne;
  }

  function enhetVid(px, py) {
    const [x, y] = tillVarld(px, py);
    const enheter = synligaEnheter();  // grå områden utanför urvalet svarar inte
    for (let i = enheter.length - 1; i >= 0; i--) {
      const e = enheter[i];
      const r = e.ruta;
      if (x < r[0] || x > r[2] || y < r[1] || y > r[3]) continue;
      let inne = false;
      for (const ring of e.ringar) if (iRing(ring, x, y)) inne = !inne;
      if (inne) return e;
    }
    return null;
  }

  // ---- Legend -------------------------------------------------------------

  function ritLegend(max) {
    const steg = [];
    for (let i = 0; i <= 40; i++) {
      const v = -max + (2 * max * i) / 40;
      steg.push(`${K.farg(v, max)} ${(i / 40) * 100}%`);
    }
    $('legend-stapel').style.background = `linear-gradient(to right, ${steg.join(',')})`;
    $('legend-min').textContent = `−${formateraTal(max)}`;
    $('legend-max').textContent = `+${formateraTal(max)}`;
    $('legend-noll').textContent = '0';
    $('legend-skalinfo').textContent = lage.skala === 'auto'
      ? `Skalan slutar vid ±${formateraTal(max)} procentenheter, satt efter hur ` +
        `mycket ${NIVANAMN_FLER[lage.niva]} i landet skiljer sig åt. Områden ` +
        'utanför skalan får den kraftigaste färgen.'
      : `Skalan slutar vid ±${formateraTal(max)} procentenheter. Områden utanför ` +
        'skalan får den kraftigaste färgen.';
  }

  const formateraTal = (v) => String(v).replace('.', ',');
  const heltal = (v) => (v === null || v === undefined
    ? '–' : Math.round(v).toLocaleString('sv-SE'));
  const procent = (v) => (v === null || v === undefined
    ? '–' : `${v.toFixed(1).replace('.', ',')} %`);

  const mattnamn = () => (lage.matt === 'valdeltagande'
    ? 'Valdeltagande' : meta.partier[lage.matt].kort);
  const mattnamnLangt = () => (lage.matt === 'valdeltagande'
    ? 'valdeltagandet' : meta.partier[lage.matt].namn);

  // ---- Verktygstips -------------------------------------------------------

  const tips = $('verktygstips');

  function visaTips(enhet, px, py) {
    if (!enhet) { tips.hidden = true; return; }
    const d = enhet.data;
    const f = d ? K.forandring(d, lage.matt) : null;
    const rader = [`<b>${htmlsakert(enhet.namn)}</b>`];
    if (!d || (lage.niva === 'valdistrikt' && !d.c)) {
      rader.push('<span class="svag">Inte färdigräknat</span>');
    } else if (f === null) {
      rader.push('<span class="svag">Saknar jämförbara siffror från 2022</span>');
    } else {
      const nu = lage.matt === 'valdeltagande'
        ? K.valdeltagande(d, 'nu') : K.andel(d.r[lage.matt], d.g);
      const fore = lage.matt === 'valdeltagande'
        ? K.valdeltagande(d, 'fore') : K.andel(d.r0[lage.matt], d.g0);
      rader.push(`<span class="tal">${mattnamn()}: ${procent(fore)} → ${procent(nu)}</span>`);
      rader.push(`<span class="tal ${f >= 0 ? 'upp' : 'ner'}">` +
        `${K.formateraForandring(f)} procentenheter</span>`);
    }
    if (d && d.rb) rader.push(`<span class="svag tal">${heltal(d.rb)} röstberättigade</span>`);
    tips.innerHTML = rader.join('<br>');
    tips.hidden = false;
    const r = tips.getBoundingClientRect();
    const x = Math.min(Math.max(px + 14, 6), bredd - r.width - 6);
    const y = Math.min(Math.max(py + 14, 6), hojd - r.height - 6);
    tips.style.left = `${x}px`;
    tips.style.top = `${y}px`;
  }

  const htmlsakert = (s) => String(s).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- Panelen till höger -------------------------------------------------

  function ritDetalj() {
    const ruta = $('detalj');
    const vald = lage.vald;
    if (!vald) {
      ruta.innerHTML = '<h2>Inget område valt</h2>' +
        '<p class="tomtval">Klicka på kartan eller i tabellen för att se alla ' +
        'partiers förändring i ett område.</p>';
      return;
    }
    const d = dataFor(vald.niva, vald.kod);
    const namn = namnFor(vald.niva, vald.kod);
    if (!d) { ruta.innerHTML = `<h2>${htmlsakert(namn)}</h2>` +
      '<p class="tomtval">Inga siffror.</p>'; return; }

    const f = K.forandring(d, lage.matt);
    const delar = [];
    delar.push(`<h2>${htmlsakert(namn)}</h2>`);
    delar.push(`<p class="plats">${htmlsakert(platsrad(vald))}</p>`);
    delar.push(`<div class="detalj-stor ${f === null ? '' : f >= 0 ? 'upp' : 'ner'}">` +
      `${K.formateraForandring(f)}<small>procentenheter ${htmlsakert(mattnamn())}</small></div>`);

    delar.push('<ul class="detalj-fakta">');
    delar.push(rad('Röstberättigade 2026', heltal(d.rb)));
    delar.push(rad('Valdeltagande 2026', procent(K.valdeltagande(d, 'nu'))));
    delar.push(rad('Valdeltagande 2022', procent(K.valdeltagande(d, 'fore'))));
    delar.push(rad('Förändring valdeltagande',
      `${K.formateraForandring(K.forandringValdeltagande(d))} p.e.`));
    if (d.utanJamforelse) {
      delar.push(rad('Distrikt utan 2022-siffror', heltal(d.utanJamforelse)));
    }
    delar.push('</ul>');

    delar.push('<table class="partitabell"><thead><tr>' +
      '<th>Parti</th><th>2022</th><th>2026</th><th>Ändring</th></tr></thead><tbody>');
    const rader = meta.partier.map((p, i) => ({
      p,
      i,
      nu: K.andel(d.r[i], d.g),
      fore: K.andel(d.r0[i], d.g0),
      f: K.forandringParti(d, i),
    })).sort((a, b) => (b.nu || 0) - (a.nu || 0));
    for (const r of rader) {
      delar.push(`<tr${r.i === lage.matt ? ' class="vald"' : ''}>` +
        `<td><span class="partiprick" style="background:${htmlsakert(r.p.farg)}"></span>` +
        `${htmlsakert(r.p.kort)}</td>` +
        `<td>${procent(r.fore)}</td><td>${procent(r.nu)}</td>` +
        `<td class="${r.f === null ? '' : r.f >= 0 ? 'upp' : 'ner'}">` +
        `${K.formateraForandring(r.f)}</td></tr>`);
    }
    delar.push('</tbody></table>');
    ruta.innerHTML = delar.join('');
  }

  const rad = (etikett, varde) =>
    `<li><span>${htmlsakert(etikett)}</span><span>${htmlsakert(varde)}</span></li>`;

  function namnFor(niva, kod) {
    const l = lager[niva];
    if (l.perKod && l.perKod.get(kod)) return l.perKod.get(kod).namn;
    const d = dataFor(niva, kod);
    return (d && (d.namn || d.n)) || kod;
  }

  function platsrad(vald) {
    if (vald.niva === 'valkrets') return 'Riksdagsvalkrets';
    if (vald.niva === 'kommun') {
      const vk = kommunensValkrets(vald.kod);
      return `Kommun i ${namnFor('valkrets', vk)}`;
    }
    const d = distriktPerKod.get(vald.kod);
    if (!d) return 'Valdistrikt';
    return `Valdistrikt i ${namnFor('kommun', d.km)}, ${namnFor('valkrets', d.vk)}`;
  }

  // ---- Tabellen -----------------------------------------------------------

  function ritTabell() {
    const enheter = synligaEnheter();
    const max = enheter.length ? skalansMax() : 5;
    const rader = enheter.map((e) => ({ e, f: K.forandring(e.data, lage.matt) }));

    if (lage.sortering === 'namn') {
      rader.sort((a, b) => a.e.namn.localeCompare(b.e.namn, 'sv'));
    } else {
      const tecken = lage.sortering === 'ned' ? -1 : 1;
      rader.sort((a, b) => {
        if (a.f === null) return 1;
        if (b.f === null) return -1;
        return tecken * (a.f - b.f);
      });
    }

    const visa = rader.slice(0, 200);
    const kropp = visa.map(({ e, f }) => {
      const d = e.data;
      const nu = !d ? null : lage.matt === 'valdeltagande'
        ? K.valdeltagande(d, 'nu') : K.andel(d.r[lage.matt], d.g);
      const fore = !d ? null : lage.matt === 'valdeltagande'
        ? K.valdeltagande(d, 'fore') : K.andel(d.r0[lage.matt], d.g0);
      const valdNu = lage.vald && lage.vald.niva === lage.niva && lage.vald.kod === e.kod;
      return `<tr data-kod="${htmlsakert(e.kod)}"${valdNu ? ' class="vald"' : ''}>` +
        `<td><span class="prick" style="background:${fargFor(e, max)}"></span>` +
        `${htmlsakert(e.namn)}</td>` +
        `<td class="hoger">${procent(fore)}</td>` +
        `<td class="hoger">${procent(nu)}</td>` +
        `<td class="hoger ${f === null ? '' : f >= 0 ? 'upp' : 'ner'}">` +
        `${K.formateraForandring(f)}</td>` +
        `<td class="hoger">${heltal(d && d.rb)}</td></tr>`;
    }).join('');

    $('tabell').querySelector('tbody').innerHTML = kropp ||
      '<tr><td colspan="5">Inga områden att visa.</td></tr>';
    $('listrubrik').textContent =
      `${NIVANAMN[lage.niva]}er sorterade efter ${mattnamn()}`;
    $('tabellcaption').textContent =
      `Förändring i ${mattnamnLangt()} per ${NIVANAMN[lage.niva].toLowerCase()}`;
    $('listfot').textContent = visa.length < rader.length
      ? `Visar ${visa.length} av ${rader.length} ${NIVANAMN_FLER[lage.niva]}. ` +
        'Zooma in eller filtrera för att se färre.'
      : `${rader.length} ${NIVANAMN_FLER[lage.niva]}.`;
  }

  // ---- Brödsmulan ---------------------------------------------------------

  function ritBrodsmula() {
    const delar = [];
    const o = lage.omrade;
    const knapp = (text, handelse, nu) => (nu
      ? `<span class="nu">${htmlsakert(text)}</span>`
      : `<button type="button" data-hopp="${handelse}">${htmlsakert(text)}</button>`);

    delar.push(knapp('Hela riket', 'riket', o.typ === 'riket'));
    if (o.typ === 'valkrets') {
      delar.push('<span class="pil">›</span>');
      delar.push(knapp(namnFor('valkrets', o.kod), `valkrets:${o.kod}`, true));
    } else if (o.typ === 'kommun') {
      const vk = kommunensValkrets(o.kod);
      delar.push('<span class="pil">›</span>');
      delar.push(knapp(namnFor('valkrets', vk), `valkrets:${vk}`, false));
      delar.push('<span class="pil">›</span>');
      delar.push(knapp(namnFor('kommun', o.kod), `kommun:${o.kod}`, true));
    }
    $('brodsmula').innerHTML = delar.join(' ');
  }

  // ---- Kontroller --------------------------------------------------------

  function byggKontroller() {
    const matt = $('matt');
    matt.innerHTML = meta.partier
      .map((p, i) => `<option value="${i}">${htmlsakert(p.kort)} – ${htmlsakert(p.namn)}</option>`)
      .join('') +
      '<option value="valdeltagande">Valdeltagande</option>';
    matt.value = String(lage.matt);

    const vk = $('filter-valkrets');
    vk.innerHTML = '<option value="">Alla regioner</option>' +
      meta.valkretsar.map((v) =>
        `<option value="${htmlsakert(v.kod)}">${htmlsakert(v.namn)}</option>`).join('');

    fyllKommunfilter();

    fyllSoklista();
  }

  // Söklistan får alla kommuner och valkretsar, men bara valdistrikten i det
  // område man tittar på – alla 6 626 på en gång gör listan oanvändbar.
  function fyllSoklista() {
    const rader = [
      ...meta.valkretsar.map((v) => `${v.namn} (region)`),
      ...meta.kommuner.map((k) => `${k.namn} (kommun)`),
    ];
    if (lage.niva === 'valdistrikt' && lage.omrade.typ !== 'riket') {
      for (const e of synligaEnheter()) {
        rader.push(`${e.namn} (${namnFor('kommun', e.km)})`);
      }
    }
    $('soklista').innerHTML = rader
      .map((r) => `<option value="${htmlsakert(r)}"></option>`).join('');
  }

  function fyllKommunfilter() {
    const vald = lage.omrade.typ === 'valkrets' ? lage.omrade.kod
      : lage.omrade.typ === 'kommun' ? kommunensValkrets(lage.omrade.kod) : '';
    const lista = meta.kommuner
      .filter((k) => !vald || (omraden.km[k.kod] && omraden.km[k.kod].vk === vald))
      .sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));
    $('filter-kommun').innerHTML = '<option value="">Alla kommuner</option>' +
      lista.map((k) => `<option value="${htmlsakert(k.kod)}">${htmlsakert(k.namn)}</option>`).join('');
    $('filter-kommun').value = lage.omrade.typ === 'kommun' ? lage.omrade.kod : '';
    $('filter-valkrets').value = vald || '';
  }

  function stallInNivaknappar() {
    for (const b of document.querySelectorAll('.niva-knapp')) {
      b.setAttribute('aria-pressed', String(b.dataset.niva === lage.niva));
    }
    for (const b of document.querySelectorAll('.list-knapp')) {
      b.setAttribute('aria-pressed', String(b.dataset.sort === lage.sortering));
    }
    $('matt-hjalp').textContent = lage.matt === 'valdeltagande'
      ? 'Förändring i andelen röstberättigade som röstade, i procentenheter.'
      : `Förändring i ${meta.partier[lage.matt].namn}s andel av rösterna, ` +
        'i procentenheter.';
  }

  // ---- Uppdatering --------------------------------------------------------

  let ritarSnart = false;
  function begarRitning() {
    if (ritarSnart) return;
    ritarSnart = true;
    requestAnimationFrame(() => { ritarSnart = false; rita(); });
  }

  async function uppdatera({ passa = false } = {}) {
    // Överordnade gränser ritas ovanpå, så de nivåerna laddas med.
    const behov = new Set([lage.niva, 'valkrets']);
    if (lage.niva === 'valdistrikt') behov.add('kommun');
    await Promise.all([...behov].map(laddaLager));

    for (const niva of Object.keys(lager)) {
      const l = lager[niva];
      if (l.enheter) for (const e of l.enheter) e.data = dataFor(niva, e.kod);
    }

    $('kartladdare').hidden = true;
    if (passa) passaIn(synligaEnheter());
    stallInNivaknappar();
    ritBrodsmula();
    fyllSoklista();
    ritDetalj();
    ritTabell();
    begarRitning();
    skrivHash();
  }

  // ---- Navigering ---------------------------------------------------------

  function gaTill(omrade, niva, { vald = null } = {}) {
    lage.omrade = omrade;
    lage.niva = niva;
    lage.vald = vald;
    fyllKommunfilter();
    uppdatera({ passa: true });
  }

  function klickaEnhet(e) {
    if (lage.niva === 'valkrets') {
      gaTill({ typ: 'valkrets', kod: e.kod }, 'kommun',
        { vald: { niva: 'valkrets', kod: e.kod } });
    } else if (lage.niva === 'kommun') {
      gaTill({ typ: 'kommun', kod: e.kod }, 'valdistrikt',
        { vald: { niva: 'kommun', kod: e.kod } });
    } else {
      lage.vald = { niva: 'valdistrikt', kod: e.kod };
      ritDetalj();
      ritTabell();
      begarRitning();
      skrivHash();
    }
  }

  // ---- Hash ---------------------------------------------------------------

  function skrivHash() {
    const p = new URLSearchParams();
    p.set('matt', lage.matt === 'valdeltagande' ? 'vd' : meta.partier[lage.matt].kort);
    p.set('niva', lage.niva);
    if (lage.omrade.typ !== 'riket') p.set('omrade', `${lage.omrade.typ}:${lage.omrade.kod}`);
    if (lage.skala !== 'auto') p.set('skala', lage.skala);
    if (lage.vald) p.set('vald', `${lage.vald.niva}:${lage.vald.kod}`);
    const ny = `#${p.toString()}`;
    if (location.hash !== ny) history.replaceState(null, '', ny);
  }

  function lasHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const matt = p.get('matt');
    if (matt === 'vd') lage.matt = 'valdeltagande';
    else if (matt) {
      const i = meta.partier.findIndex((x) => x.kort === matt);
      if (i >= 0) lage.matt = i;
    }
    if (['valkrets', 'kommun', 'valdistrikt'].includes(p.get('niva'))) lage.niva = p.get('niva');
    const omrade = (p.get('omrade') || '').split(':');
    if (omrade[0] === 'valkrets' || omrade[0] === 'kommun') {
      lage.omrade = { typ: omrade[0], kod: omrade[1] };
    }
    if (p.get('skala')) lage.skala = p.get('skala');
    const vald = (p.get('vald') || '').split(':');
    if (lager[vald[0]]) lage.vald = { niva: vald[0], kod: vald[1] };
  }

  // ---- Händelser ----------------------------------------------------------

  function kopplaHandelser() {
    $('matt').addEventListener('change', (e) => {
      lage.matt = e.target.value === 'valdeltagande' ? 'valdeltagande' : Number(e.target.value);
      stallInNivaknappar();
      ritDetalj();
      ritTabell();
      begarRitning();
      skrivHash();
    });

    $('skala').addEventListener('change', (e) => {
      lage.skala = e.target.value;
      ritTabell();
      begarRitning();
      skrivHash();
    });

    for (const b of document.querySelectorAll('.niva-knapp')) {
      b.addEventListener('click', () => {
        const niva = b.dataset.niva;
        // Man kan inte titta på kommunnivå inifrån en enskild kommun.
        let omrade = lage.omrade;
        if (omrade.typ === 'kommun' && niva !== 'valdistrikt') {
          omrade = { typ: 'valkrets', kod: kommunensValkrets(omrade.kod) };
        }
        if (omrade.typ === 'valkrets' && niva === 'valkrets') omrade = { typ: 'riket', kod: null };
        gaTill(omrade, niva);
      });
    }

    for (const b of document.querySelectorAll('.list-knapp')) {
      b.addEventListener('click', () => {
        lage.sortering = b.dataset.sort;
        stallInNivaknappar();
        ritTabell();
      });
    }

    $('filter-valkrets').addEventListener('change', (e) => {
      const kod = e.target.value;
      if (!kod) gaTill({ typ: 'riket', kod: null }, 'valkrets');
      else gaTill({ typ: 'valkrets', kod }, 'kommun');
    });

    $('filter-kommun').addEventListener('change', (e) => {
      const kod = e.target.value;
      if (!kod) {
        const vk = $('filter-valkrets').value;
        gaTill(vk ? { typ: 'valkrets', kod: vk } : { typ: 'riket', kod: null },
          vk ? 'kommun' : 'valkrets');
      } else {
        gaTill({ typ: 'kommun', kod }, 'valdistrikt',
          { vald: { niva: 'kommun', kod } });
      }
    });

    $('aterstall').addEventListener('click', () => {
      gaTill({ typ: 'riket', kod: null }, 'valkrets');
    });

    $('sok').addEventListener('change', (e) => sok(e.target.value));

    $('brodsmula').addEventListener('click', (e) => {
      const knapp = e.target.closest('[data-hopp]');
      if (!knapp) return;
      const [typ, kod] = knapp.dataset.hopp.split(':');
      if (typ === 'riket') gaTill({ typ: 'riket', kod: null }, 'valkrets');
      else if (typ === 'valkrets') gaTill({ typ: 'valkrets', kod }, 'kommun');
      else gaTill({ typ: 'kommun', kod }, 'valdistrikt');
    });

    $('tabell').addEventListener('click', (e) => {
      const rad = e.target.closest('tr[data-kod]');
      if (!rad) return;
      const enhet = lager[lage.niva].perKod.get(rad.dataset.kod);
      if (enhet) klickaEnhet(enhet);
    });

    $('zoom-in').addEventListener('click', () => zooma(1.5, bredd / 2, hojd / 2));
    $('zoom-ut').addEventListener('click', () => zooma(1 / 1.5, bredd / 2, hojd / 2));
    $('zoom-passa').addEventListener('click', () => {
      passaIn(synligaEnheter());
      begarRitning();
    });

    kopplaDuk();

    window.addEventListener('resize', () => {
      const gammal = { ...vy };
      matDuken();
      Object.assign(vy, gammal);
      begarRitning();
    });
  }

  function zooma(faktor, px, py) {
    const [fx, fy] = tillVarld(px, py);
    vy.k = Math.max(0.00002, Math.min(0.05, vy.k * faktor));
    const [nx, ny] = tillVarld(px, py);
    vy.x += fx - nx;
    vy.y += fy - ny;
    begarRitning();
  }

  function kopplaDuk() {
    let drar = null;
    let flyttat = 0;
    // Pekpunkter som ligger kvar på duken, för att kunna nypa med två fingrar.
    const fingrar = new Map();
    let nyp = null;

    const avstand = () => {
      const [a, b] = [...fingrar.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const mitt = () => {
      const [a, b] = [...fingrar.values()];
      return [(a.x + b.x) / 2, (a.y + b.y) / 2];
    };

    duk.addEventListener('pointerdown', (e) => {
      duk.setPointerCapture(e.pointerId);
      fingrar.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (fingrar.size === 2) {
        drar = null;
        nyp = avstand();
        return;
      }
      drar = { x: e.offsetX, y: e.offsetY };
      flyttat = 0;
      duk.classList.add('drar');
    });

    duk.addEventListener('pointermove', (e) => {
      if (fingrar.has(e.pointerId)) fingrar.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (fingrar.size === 2) {
        const nu = avstand();
        if (nyp > 0 && nu > 0) {
          const [mx, my] = mitt();
          zooma(nu / nyp, mx, my);
        }
        nyp = nu;
        tips.hidden = true;
        return;
      }
      if (drar) {
        const dx = e.offsetX - drar.x;
        const dy = e.offsetY - drar.y;
        flyttat += Math.abs(dx) + Math.abs(dy);
        vy.x -= dx / vy.k;
        vy.y += dy / vy.k;
        drar = { x: e.offsetX, y: e.offsetY };
        tips.hidden = true;
        begarRitning();
        return;
      }
      const traff = enhetVid(e.offsetX, e.offsetY);
      if (traff !== hovrad) { hovrad = traff; begarRitning(); }
      visaTips(traff, e.offsetX, e.offsetY);
    });

    const slapp = (e) => {
      fingrar.delete(e.pointerId);
      if (fingrar.size < 2) nyp = null;
      if (!drar) return;
      duk.classList.remove('drar');
      const stilla = flyttat < 5;
      drar = null;
      if (!stilla) return;
      const traff = enhetVid(e.offsetX, e.offsetY);
      if (traff) klickaEnhet(traff);
    };
    duk.addEventListener('pointerup', slapp);
    duk.addEventListener('pointercancel', (e) => {
      fingrar.delete(e.pointerId);
      nyp = null;
      drar = null;
      duk.classList.remove('drar');
    });

    duk.addEventListener('pointerleave', () => {
      tips.hidden = true;
      if (hovrad) { hovrad = null; begarRitning(); }
    });

    duk.addEventListener('wheel', (e) => {
      e.preventDefault();
      zooma(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.offsetX, e.offsetY);
    }, { passive: false });

    duk.addEventListener('keydown', (e) => {
      const steg = 60 / vy.k;
      if (e.key === 'ArrowLeft') vy.x -= steg;
      else if (e.key === 'ArrowRight') vy.x += steg;
      else if (e.key === 'ArrowUp') vy.y += steg;
      else if (e.key === 'ArrowDown') vy.y -= steg;
      else if (e.key === '+' || e.key === '=') zooma(1.4, bredd / 2, hojd / 2);
      else if (e.key === '-') zooma(1 / 1.4, bredd / 2, hojd / 2);
      else return;
      e.preventDefault();
      begarRitning();
    });
  }

  // Sökrutan matar från söklistan, där varje rad har sin sort inom parentes:
  // "Karlshamn (kommun)", "Mörrum östra (Karlshamn)". Skriver man bara ett namn
  // letar vi i tur och ordning bland kommuner, regioner och valdistrikt.
  function sok(text) {
    const parentes = /\s*\(([^)]*)\)\s*$/.exec(text);
    const sort = parentes ? parentes[1].trim().toLowerCase() : '';
    const fras = text.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
    if (!fras) return;

    const traffa = (lista, namn) => lista.find((x) => namn(x).toLowerCase() === fras)
      || lista.find((x) => namn(x).toLowerCase().startsWith(fras));

    if (sort !== 'region') {
      const kommun = traffa(meta.kommuner, (k) => k.namn);
      if (kommun && (sort === 'kommun' || sort === '' || !distriktPerKod.size)) {
        gaTill({ typ: 'kommun', kod: kommun.kod }, 'valdistrikt',
          { vald: { niva: 'kommun', kod: kommun.kod } });
        return;
      }
    }

    if (sort === '' || sort === 'region') {
      const valkrets = traffa(meta.valkretsar, (v) => v.namn);
      if (valkrets) {
        gaTill({ typ: 'valkrets', kod: valkrets.kod }, 'kommun',
          { vald: { niva: 'valkrets', kod: valkrets.kod } });
        return;
      }
      if (sort === 'region') return;
    }

    // Valdistriktsnamn finns först när distriktsdatat är hämtat.
    if (!distriktPerKod.size) {
      laddaLager('valdistrikt').then(() => sok(text));
      return;
    }
    const distrikt = traffa([...distriktPerKod.values()], (d) => d.n);
    if (distrikt) {
      gaTill({ typ: 'kommun', kod: distrikt.km }, 'valdistrikt',
        { vald: { niva: 'valdistrikt', kod: distrikt.k } });
    }
  }

  // ---- Text som beror på datat -------------------------------------------

  function fyllText() {
    const kvar = meta.antalValdistriktSomSkaRaknas - meta.antalValdistriktRaknade;
    $('underrubrik').textContent =
      `Riksdagsvalet ${meta.valdatum.slice(0, 4)} jämfört med ${meta.tidigareValdatum.slice(0, 4)}`;

    if (meta.rakningstillfalle !== 'slutlig') {
      const banner = $('rakningsbanner');
      banner.hidden = false;
      banner.textContent =
        `Preliminärt valresultat. ${meta.antalValdistriktRaknade.toLocaleString('sv-SE')} av ` +
        `${meta.antalValdistriktSomSkaRaknas.toLocaleString('sv-SE')} valdistrikt är räknade` +
        (kvar > 0 ? ` – ${kvar.toLocaleString('sv-SE')} återstår.` : '.') +
        ` Senast uppdaterat hos Valmyndigheten: ${meta.senasteUppdateringstid}.`;
    }

    const ojamforbara = meta.distriktOjamforbara;
    $('om-jamforbarhet').textContent =
      `Valdistrikt ritas om mellan valen. Där gränserna ändrats finns inga ` +
      `jämförbara siffror för 2022, och distriktet lämnas ofärgat på kartan. ` +
      `I det här valet gäller det ${ojamforbara.toLocaleString('sv-SE')} av ` +
      `${meta.antalValdistriktSomSkaRaknas.toLocaleString('sv-SE')} distrikt – ` +
      `där ingår också uppsamlingsdistrikten, dit sena brev- och budröster går ` +
      `och som inte har någon egen geografi.`;

    $('om-kalla').textContent =
      `Siffrorna hämtades från Valmyndigheten ${new Date(meta.hamtat).toLocaleString('sv-SE')} ` +
      `och gäller det ${meta.rakningstillfalle}a valresultatet i valet till riksdagen ` +
      `${meta.valdatum}, jämfört med valet ${meta.tidigareValdatum}.`;
  }

  // ---- Start --------------------------------------------------------------

  async function start() {
    matDuken();
    try {
      [meta, omraden] = await Promise.all([hamtaJson('meta.json'), hamtaJson('omraden.json')]);
    } catch (fel) {
      $('kartladdare').textContent = `Kunde inte läsa valdata: ${fel.message}`;
      return;
    }
    // Utan val i adressen visas partiet som ökat mest i riket. Då har kartan
    // både orange och lila områden från början, i stället för att bli enfärgad
    // som den blir för partiet som backat mest.
    lage.matt = meta.partier
      .map((p, i) => [i, p.andel - p.andelFore])
      .sort((a, b) => b[1] - a[1])[0][0];

    lasHash();
    byggKontroller();
    fyllText();
    kopplaHandelser();
    $('matt').value = lage.matt === 'valdeltagande' ? 'valdeltagande' : String(lage.matt);
    $('skala').value = lage.skala;
    await uppdatera({ passa: true });
  }

  start();
})();
