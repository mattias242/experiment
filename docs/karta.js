// Förändringskartan: ritar skillnaden mellan valen 2026 och 2022, för valet
// till riksdagen, regionfullmäktige eller kommunfullmäktige.
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
    val: 'RD',                   // RD = riksdag, RF = region, KF = kommun
    matt: null,                  // partikod, eller 'valdeltagande'
    niva: 'topp',                // topp | kommun | valdistrikt
    omrade: { typ: 'riket', kod: null },
    skala: 'auto',
    vald: null,                  // { niva, kod }
    sortering: 'ned',
  };

  let valen = [];                // innehållet i valdata/val.json
  const valcache = new Map();    // valtyp -> { meta, omraden, distriktPerKod }
  let data = null;               // det val som visas just nu

  // Geometrin är densamma i alla tre valen – det är samma valdistrikt och
  // samma kommuner. Bara toppnivån skiljer: riksdagsvalet delas in i
  // valkretsar, region- och kommunvalet i län.
  const lager = {
    valkrets: { fil: 'geografi-valkrets.json', objekt: 'valkrets', kodfalt: 'Riksdagsvalkretskod', namnfalt: 'Riksdagsvalkrets' },
    lan: { fil: 'geografi-lan.json', objekt: 'lan', kodfalt: 'Länskod', namnfalt: 'Län' },
    kommun: { fil: 'geografi-kommun.json', objekt: 'kommun', kodfalt: 'Kommunkod', namnfalt: 'Kommun' },
    valdistrikt: { fil: 'geografi-valdistrikt.json', objekt: 'valdistrikt', kodfalt: 'Valdistriktskod' },
  };

  // Vilket geometrilager en nivå ritas ur.
  const geoNamn = (niva) => (niva === 'topp'
    ? (data.meta.toppNivan === 'lan' ? 'lan' : 'valkrets')
    : niva);
  const geoLager = (niva) => lager[geoNamn(niva)];

  const nivanamn = (niva) => (niva === 'topp' ? data.meta.toppNamn
    : niva === 'kommun' ? 'Kommun' : 'Valdistrikt');
  const nivanamnFler = (niva) => (niva === 'topp' ? data.meta.toppNamnFler
    : niva === 'kommun' ? 'kommuner' : 'valdistrikt');

  // ---- Hämtning -----------------------------------------------------------

  async function hamtaJson(fil) {
    const svar = await fetch(MAPP + fil);
    if (!svar.ok) throw new Error(`Kunde inte hämta ${fil} (HTTP ${svar.status})`);
    return svar.json();
  }

  async function laddaVal(valtyp) {
    if (!valcache.has(valtyp)) {
      const [meta, omraden, distrikt] = await Promise.all([
        hamtaJson(`${valtyp}/meta.json`),
        hamtaJson(`${valtyp}/omraden.json`),
        hamtaJson(`${valtyp}/valdistrikt.json`),
      ]);
      valcache.set(valtyp, {
        meta,
        omraden,
        distriktPerKod: new Map(distrikt.map((d) => [d.k, d])),
        partiPerKod: new Map(meta.partier.map((p) => [p.kod, p])),
        kommunPerKod: new Map(meta.kommuner.map((k) => [k.kod, k])),
      });
    }
    return valcache.get(valtyp);
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

  function byggEnhet(ringar) {
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
    return { ringar, bana, ruta: [minX, minY, maxX, maxY] };
  }

  async function laddaGeografi(namn) {
    const l = lager[namn];
    if (l.enheter) return l;
    if (!l.laddar) {
      l.laddar = (async () => {
        const topo = await hamtaJson(l.fil);
        l.enheter = avkodaTopo(topo, l.objekt).map((f) => {
          const e = byggEnhet(f.ringar);
          e.kod = f.props[l.kodfalt];
          e.geonamn = l.namnfalt ? f.props[l.namnfalt] : null;
          return e;
        });
        l.perKod = new Map(l.enheter.map((e) => [e.kod, e]));
        return l;
      })();
    }
    return l.laddar;
  }

  // Binder om varje yta mot det val som visas just nu: samma kommunyta har
  // olika siffror i riksdags-, region- och kommunvalet.
  function bindData() {
    for (const niva of ['topp', 'kommun', 'valdistrikt']) {
      const l = geoLager(niva);
      if (!l.enheter) continue;
      for (const e of l.enheter) {
        e.data = dataFor(niva, e.kod);
        e.iValet = ingarIValet(niva, e.kod);
        e.namn = namnFor(niva, e.kod) || e.geonamn || e.kod;
        if (niva === 'kommun') {
          e.tp = (data.kommunPerKod.get(e.kod) || {}).tp ?? null;
        } else if (niva === 'valdistrikt') {
          e.km = e.kod.slice(0, 4);
          e.tp = e.data ? e.data.tp : null;
        }
      }
    }
  }

  // Geometrin är densamma i alla tre valen, men allt ingår inte i alla val:
  // Gotland har inget regionfullmäktigeval. Sådana ytor ritas i grått som
  // resten av landet utanför urvalet, och räknas inte som områden i valet.
  function ingarIValet(niva, kod) {
    if (niva === 'topp') return data.meta.toppnivan.some((t) => t.kod === kod);
    if (niva === 'kommun') return data.kommunPerKod.has(kod);
    return data.distriktPerKod.has(kod);
  }

  const dataFor = (niva, kod) => {
    if (niva === 'topp') return data.omraden.tp[kod] || null;
    if (niva === 'kommun') return data.omraden.km[kod] || null;
    return data.distriktPerKod.get(kod) || null;
  };

  function namnFor(niva, kod) {
    const d = dataFor(niva, kod);
    if (d) return d.namn || d.n;
    if (niva === 'kommun') return (data.kommunPerKod.get(kod) || {}).namn;
    if (niva === 'topp') {
      const t = data.meta.toppnivan.find((x) => x.kod === kod);
      if (t) return t.namn;
    }
    const l = geoLager(niva);
    const e = l.perKod && l.perKod.get(kod);
    return (e && e.geonamn) || kod;
  }

  const kommunensTopp = (kommunkod) =>
    (data.kommunPerKod.get(kommunkod) || {}).tp ?? null;

  // ---- Vilka enheter som visas -------------------------------------------

  // Ytorna i det område man tittar på, inklusive de som inte ingår i valet –
  // de ska gå att peka på och få en förklaring, men inte räknas eller färgas.
  function iOmradet() {
    const l = geoLager(lage.niva);
    if (!l.enheter) return [];
    const o = lage.omrade;
    if (o.typ === 'riket') return l.enheter;
    if (o.typ === 'topp') {
      if (lage.niva === 'topp') return l.enheter.filter((e) => e.kod === o.kod);
      return l.enheter.filter((e) => e.tp === o.kod);
    }
    if (lage.niva === 'valdistrikt') return l.enheter.filter((e) => e.km === o.kod);
    if (lage.niva === 'kommun') return l.enheter.filter((e) => e.kod === o.kod);
    return l.enheter.filter((e) => e.kod === kommunensTopp(o.kod));
  }

  const synligaEnheter = () => iOmradet().filter((e) => e.iValet);

  // Området som helhet – det som partilistan och sammanfattningen räknas på.
  function aktivtOmrade() {
    const o = lage.omrade;
    if (o.typ === 'riket') return data.omraden.riket;
    if (o.typ === 'topp') return data.omraden.tp[o.kod] || null;
    return data.omraden.km[o.kod] || null;
  }

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
  const skalgrund = new Map();   // vad skalan räknades på, för legendtexten
  function skalansMax() {
    if (lage.skala !== 'auto') return Number(lage.skala);
    const nyckel = `${lage.val}/${lage.niva}/${lage.matt}`;
    const alla = geoLager(lage.niva).enheter;
    if (!alla || !alla.length) return 5;      // hunnit fråga innan lagret laddats
    if (!skalcache.has(nyckel)) {
      // Skalan räknas bara på de områden där partiet faktiskt stått på
      // valsedeln något av åren. För de stora partierna är det hela landet,
      // men ett lokalt parti finns i en enda kommun – räknades skalan på alla
      // 6 626 valdistrikt skulle de 6 600 nollorna trycka ned den till ±1 och
      // göra kommunen till en enda orange klump.
      const harRoster = (e) => e.data
        && ((e.data.r[lage.matt] || 0) > 0 || (e.data.r0[lage.matt] || 0) > 0);
      const urval = lage.matt === 'valdeltagande' ? alla : alla.filter(harRoster);
      const underlag = urval.length ? urval : alla;
      skalgrund.set(nyckel, underlag.length < alla.length * 0.5
        ? `de ${nivanamnFler(lage.niva)} där ${mattnamn()} ställt upp`
        : `${nivanamnFler(lage.niva)} i landet`);
      skalcache.set(nyckel, K.automatiskSkala(
        underlag.map((e) => K.forandring(e.data, lage.matt)),
        underlag.map((e) => (e.data && e.data.rb) || 1),
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
    const medIUrvalet = new Set(enheter);

    const [v0x, v0y] = tillVarld(0, hojd);
    const [v1x, v1y] = tillVarld(bredd, 0);
    const inom = (r) => r[2] >= v0x && r[0] <= v1x && r[3] >= v0y && r[1] <= v1y;

    // Norr är upp: y växer uppåt i SWEREF men nedåt på skärmen.
    ctx.setTransform(dpr * vy.k, 0, 0, -dpr * vy.k,
      dpr * (bredd / 2 - vy.x * vy.k), dpr * (hojd / 2 + vy.y * vy.k));

    // Resten av landet ritas i grått under. Utan det svävar ett inzoomat
    // område fritt i havet och det går inte att se var i Sverige man är.
    const ritade = [];
    for (const e of geoLager(lage.niva).enheter) {
      if (!inom(e.ruta)) continue;
      const valt = medIUrvalet.has(e);
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
      : lage.niva === 'kommun' ? 'topp' : null;
    if (over && geoLager(over).enheter) {
      ctx.strokeStyle = 'rgba(40,54,72,.4)';
      ctx.lineWidth = 1.1 / vy.k;
      for (const e of geoLager(over).enheter) {
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
    const l = geoLager(lage.niva);
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
    const enheter = iOmradet();  // grå områden utanför urvalet svarar inte
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
    const grund = skalgrund.get(`${lage.val}/${lage.niva}/${lage.matt}`)
      || `${nivanamnFler(lage.niva)} i landet`;
    $('legend-skalinfo').textContent = lage.skala === 'auto'
      ? `Skalan slutar vid ±${formateraTal(max)} procentenheter, satt efter hur ` +
        `mycket ${grund} skiljer sig åt. Områden utanför skalan får den ` +
        'kraftigaste färgen.'
      : `Skalan slutar vid ±${formateraTal(max)} procentenheter. Områden utanför ` +
        'skalan får den kraftigaste färgen.';
  }

  const formateraTal = (v) => String(v).replace('.', ',');
  const heltal = (v) => (v === null || v === undefined
    ? '–' : Math.round(v).toLocaleString('sv-SE'));
  const procent = (v) => (v === null || v === undefined
    ? '–' : `${v.toFixed(1).replace('.', ',')} %`);

  const partiet = (kod) => data.partiPerKod.get(kod) || { kod, kort: kod, namn: kod, farg: '#9aa4b0' };
  const mattnamn = () => (lage.matt === 'valdeltagande'
    ? 'Valdeltagande' : partiet(lage.matt).kort);
  const mattnamnLangt = () => (lage.matt === 'valdeltagande'
    ? 'valdeltagandet' : partiet(lage.matt).namn);

  // Andelen för ett mått i ett område, ett av åren.
  const andelen = (d, ar) => {
    if (!d) return null;
    if (lage.matt === 'valdeltagande') return K.valdeltagande(d, ar);
    return ar === 'fore'
      ? K.andel(d.r0[lage.matt] || 0, d.g0)
      : K.andel(d.r[lage.matt] || 0, d.g);
  };

  // Gotland har inget regionfullmäktigeval – kommunen sköter regionens
  // uppgifter där. Det är inte "saknas data", det är "finns inget val".
  const utanValForklaring = () => (lage.val === 'RF'
    ? 'Gotland har inget regionfullmäktigeval – kommunen sköter regionens uppgifter.'
    : `Området ingår inte i valet till ${data.meta.valtypNamn.toLowerCase()}.`);
  const saknarVal = (enhet) => !enhet.iValet;

  // ---- Verktygstips -------------------------------------------------------

  const tips = $('verktygstips');

  function visaTips(enhet, px, py) {
    if (!enhet) { tips.hidden = true; return; }
    const d = enhet.data;
    const f = d ? K.forandring(d, lage.matt) : null;
    const rader = [`<b>${htmlsakert(enhet.namn)}</b>`];
    if (saknarVal(enhet)) {
      rader.push(`<span class="svag">${htmlsakert(utanValForklaring())}</span>`);
    } else if (!d || (lage.niva === 'valdistrikt' && !d.c)) {
      rader.push('<span class="svag">Inte färdigräknat</span>');
    } else if (f === null) {
      rader.push('<span class="svag">Saknar jämförbara siffror från 2022</span>');
    } else {
      rader.push(`<span class="tal">${mattnamn()}: ${procent(andelen(d, 'fore'))} ` +
        `→ ${procent(andelen(d, 'nu'))}</span>`);
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
    if (!d) {
      ruta.innerHTML = `<h2>${htmlsakert(namn)}</h2><p class="tomtval">` +
        htmlsakert(ingarIValet(vald.niva, vald.kod)
          ? 'Inga siffror för det här området.'
          : utanValForklaring()) + '</p>';
      return;
    }

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
    if (d.ad) delar.push(rad('Valdistrikt', `${heltal(d.ad)}${d.uj ? ` (${heltal(d.uj)} utan 2022)` : ''}`));
    delar.push('</ul>');

    delar.push('<table class="partitabell"><thead><tr>' +
      '<th>Parti</th><th>2022</th><th>2026</th><th>Ändring</th></tr></thead><tbody>');
    const koder = new Set([...Object.keys(d.r), ...Object.keys(d.r0)]);
    const rader = [...koder].map((kod) => ({
      p: partiet(kod),
      nu: K.andel(d.r[kod] || 0, d.g),
      fore: K.andel(d.r0[kod] || 0, d.g0),
      f: K.forandringParti(d, kod),
    })).sort((a, b) => (b.nu || 0) - (a.nu || 0));
    for (const r of rader) {
      delar.push(`<tr${r.p.kod === lage.matt ? ' class="vald"' : ''}>` +
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

  function platsrad(vald) {
    if (vald.niva === 'topp') return data.meta.toppNamn;
    if (vald.niva === 'kommun') {
      const tp = kommunensTopp(vald.kod);
      return tp ? `Kommun i ${namnFor('topp', tp)}` : 'Kommun';
    }
    const d = data.distriktPerKod.get(vald.kod);
    if (!d) return 'Valdistrikt';
    return `Valdistrikt i ${namnFor('kommun', d.km)}, ${namnFor('topp', d.tp)}`;
  }

  // ---- Tabellen -----------------------------------------------------------

  function ritTabell() {
    const enheter = synligaEnheter();
    const max = enheter.length ? skalansMax() : 5;
    const rader = enheter.map((e) => ({ e, f: K.forandring(e.data, lage.matt) }));

    if (lage.sortering === 'namn') {
      rader.sort((a, b) => String(a.e.namn).localeCompare(String(b.e.namn), 'sv'));
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
      const valdNu = lage.vald && lage.vald.niva === lage.niva && lage.vald.kod === e.kod;
      return `<tr data-kod="${htmlsakert(e.kod)}"${valdNu ? ' class="vald"' : ''}>` +
        `<td><span class="prick" style="background:${fargFor(e, max)}"></span>` +
        `${htmlsakert(e.namn)}</td>` +
        `<td class="hoger">${procent(andelen(d, 'fore'))}</td>` +
        `<td class="hoger">${procent(andelen(d, 'nu'))}</td>` +
        `<td class="hoger ${f === null ? '' : f >= 0 ? 'upp' : 'ner'}">` +
        `${K.formateraForandring(f)}</td>` +
        `<td class="hoger">${heltal(d && d.rb)}</td></tr>`;
    }).join('');

    $('tabell').querySelector('tbody').innerHTML = kropp ||
      '<tr><td colspan="5">Inga områden att visa.</td></tr>';
    $('listrubrik').textContent =
      `${storBokstav(nivanamnFler(lage.niva))} sorterade efter ${mattnamn()}`;
    $('tabellcaption').textContent =
      `Förändring i ${mattnamnLangt()} per ${nivanamn(lage.niva).toLowerCase()}`;
    $('listfot').textContent = visa.length < rader.length
      ? `Visar ${visa.length} av ${rader.length} ${nivanamnFler(lage.niva)}. ` +
        'Zooma in eller filtrera för att se färre.'
      : `${rader.length} ${nivanamnFler(lage.niva)}.`;
  }

  const storBokstav = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---- Brödsmulan ---------------------------------------------------------

  function ritBrodsmula() {
    const delar = [];
    const o = lage.omrade;
    const knapp = (text, handelse, nu) => (nu
      ? `<span class="nu">${htmlsakert(text)}</span>`
      : `<button type="button" data-hopp="${handelse}">${htmlsakert(text)}</button>`);

    delar.push(knapp('Hela riket', 'riket', o.typ === 'riket'));
    if (o.typ === 'topp') {
      delar.push('<span class="pil">›</span>');
      delar.push(knapp(namnFor('topp', o.kod), `topp:${o.kod}`, true));
    } else if (o.typ === 'kommun') {
      const tp = kommunensTopp(o.kod);
      if (tp) {
        delar.push('<span class="pil">›</span>');
        delar.push(knapp(namnFor('topp', tp), `topp:${tp}`, false));
      }
      delar.push('<span class="pil">›</span>');
      delar.push(knapp(namnFor('kommun', o.kod), `kommun:${o.kod}`, true));
    }
    $('brodsmula').innerHTML = delar.join(' ');
  }

  // ---- Kontroller --------------------------------------------------------

  // Partilistan visar de partier som ställt upp i det område man tittar på,
  // störst först. Det är så lokala partier dyker upp: Stenungsundspartiet finns
  // i listan när man är i Stenungsund, men inte när man ser hela landet.
  function partierIOmradet() {
    const o = aktivtOmrade();
    const koder = o ? new Set([...Object.keys(o.r), ...Object.keys(o.r0)]) : new Set();
    if (lage.matt && lage.matt !== 'valdeltagande') koder.add(lage.matt);
    const roster = (kod) => (o ? (o.r[kod] || 0) : 0);
    return [...koder]
      .map((kod) => partiet(kod))
      .sort((a, b) => (a.kod === 'OVR') - (b.kod === 'OVR') || roster(b.kod) - roster(a.kod));
  }

  function byggValknappar() {
    $('valtyp').innerHTML = valen.map((v) =>
      `<button type="button" class="knapp valtyp-knapp" data-val="${htmlsakert(v.kod)}">` +
      `${htmlsakert(v.kort)}</button>`).join('');
    for (const b of $('valtyp').querySelectorAll('.valtyp-knapp')) {
      b.addEventListener('click', () => byggOmVal(b.dataset.val));
    }
  }

  function fyllMattlista() {
    const partier = partierIOmradet();
    $('matt').innerHTML = partier
      .map((p) => `<option value="${htmlsakert(p.kod)}">${htmlsakert(p.kort)} – ${htmlsakert(p.namn)}</option>`)
      .join('') +
      '<option value="valdeltagande">Valdeltagande</option>';
    $('matt').value = lage.matt;
  }

  function fyllOmradesfilter() {
    const tp = lage.omrade.typ === 'topp' ? lage.omrade.kod
      : lage.omrade.typ === 'kommun' ? kommunensTopp(lage.omrade.kod) : '';
    $('filter-topp-etikett').textContent = data.meta.toppNamn;
    $('filter-topp').innerHTML =
      `<option value="">Alla ${htmlsakert(data.meta.toppNamnFler)}</option>` +
      data.meta.toppnivan.map((t) =>
        `<option value="${htmlsakert(t.kod)}">${htmlsakert(t.namn)}</option>`).join('');
    $('filter-topp').value = tp || '';

    const lista = data.meta.kommuner
      .filter((k) => !tp || k.tp === tp)
      .slice()
      .sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));
    $('filter-kommun').innerHTML = '<option value="">Alla kommuner</option>' +
      lista.map((k) => `<option value="${htmlsakert(k.kod)}">${htmlsakert(k.namn)}</option>`).join('');
    $('filter-kommun').value = lage.omrade.typ === 'kommun' ? lage.omrade.kod : '';
  }

  // Söklistan får alla kommuner och toppnivåer, men bara valdistrikten i det
  // område man tittar på – alla 6 626 på en gång gör listan oanvändbar.
  function fyllSoklista() {
    const rader = [
      ...data.meta.toppnivan.map((t) => `${t.namn} (${data.meta.toppNamn.toLowerCase()})`),
      ...data.meta.kommuner.map((k) => `${k.namn} (kommun)`),
    ];
    if (lage.niva === 'valdistrikt' && lage.omrade.typ !== 'riket') {
      for (const e of synligaEnheter()) rader.push(`${e.namn} (${namnFor('kommun', e.km)})`);
    }
    $('soklista').innerHTML = rader
      .map((r) => `<option value="${htmlsakert(r)}"></option>`).join('');
  }

  function stallInKnappar() {
    for (const b of document.querySelectorAll('.valtyp-knapp')) {
      b.setAttribute('aria-pressed', String(b.dataset.val === lage.val));
    }
    for (const b of document.querySelectorAll('.niva-knapp')) {
      b.setAttribute('aria-pressed', String(b.dataset.niva === lage.niva));
    }
    for (const b of document.querySelectorAll('.list-knapp')) {
      b.setAttribute('aria-pressed', String(b.dataset.sort === lage.sortering));
    }
    $('niva-topp').textContent = data.meta.toppNamn;
    $('matt-hjalp').textContent = lage.matt === 'valdeltagande'
      ? `Förändring i andelen röstberättigade som röstade i valet till ` +
        `${data.meta.valtypNamn.toLowerCase()}, i procentenheter.`
      : `Förändring i ${partiet(lage.matt).namn}s andel av rösterna i valet till ` +
        `${data.meta.valtypNamn.toLowerCase()}, i procentenheter.`;
  }

  // ---- Uppdatering --------------------------------------------------------

  let ritarSnart = false;
  function begarRitning() {
    if (ritarSnart) return;
    ritarSnart = true;
    requestAnimationFrame(() => { ritarSnart = false; rita(); });
  }

  async function uppdatera({ passa = false } = {}) {
    // Överordnade gränser ritas ovanpå, så de lagren laddas med.
    const behov = new Set([geoNamn(lage.niva), geoNamn('topp')]);
    if (lage.niva === 'valdistrikt') behov.add('kommun');
    await Promise.all([...behov].map(laddaGeografi));
    bindData();

    $('kartladdare').hidden = true;
    if (passa) passaIn(synligaEnheter());
    stallInKnappar();
    ritBrodsmula();
    fyllMattlista();
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
    fyllOmradesfilter();
    uppdatera({ passa: true });
  }

  // Byter val. Samma parti behålls om det finns även i det nya valet – S är S i
  // alla tre valen – annars väljs det största. Området behålls också, så att
  // man kan jämföra samma kommun mellan valen.
  async function byggOmVal(valtyp) {
    if (valtyp === lage.val) return;
    $('kartladdare').hidden = false;
    $('kartladdare').textContent = 'Laddar valet …';
    const nytt = await laddaVal(valtyp);
    lage.val = valtyp;
    data = nytt;
    if (lage.matt !== 'valdeltagande' && !nytt.partiPerKod.has(lage.matt)) {
      lage.matt = nytt.meta.partier[0].kod;
    }
    // Gotland finns inte i regionvalet, och toppnivåkoderna betyder olika saker
    // i olika val – hamnar vi utanför kartan går vi tillbaka till hela riket.
    if (lage.omrade.typ === 'topp' && !nytt.omraden.tp[lage.omrade.kod]) {
      lage.omrade = { typ: 'riket', kod: null };
    }
    if (lage.omrade.typ === 'kommun' && !nytt.omraden.km[lage.omrade.kod]) {
      lage.omrade = { typ: 'riket', kod: null };
    }
    if (lage.vald && !dataFor(lage.vald.niva, lage.vald.kod)) lage.vald = null;
    fyllText();
    fyllOmradesfilter();
    await uppdatera({ passa: true });
  }

  function klickaEnhet(e) {
    if (!e.iValet) {
      lage.vald = { niva: lage.niva, kod: e.kod };
      ritDetalj();
      begarRitning();
      return;
    }
    if (lage.niva === 'topp') {
      gaTill({ typ: 'topp', kod: e.kod }, 'kommun', { vald: { niva: 'topp', kod: e.kod } });
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
    p.set('val', lage.val);
    p.set('matt', lage.matt === 'valdeltagande' ? 'vd' : lage.matt);
    p.set('niva', lage.niva);
    if (lage.omrade.typ !== 'riket') p.set('omrade', `${lage.omrade.typ}:${lage.omrade.kod}`);
    if (lage.skala !== 'auto') p.set('skala', lage.skala);
    if (lage.vald) p.set('vald', `${lage.vald.niva}:${lage.vald.kod}`);
    const ny = `#${p.toString()}`;
    if (location.hash !== ny) history.replaceState(null, '', ny);
  }

  function lasHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const val = p.get('val');
    if (valen.some((v) => v.kod === val)) lage.val = val;
    const matt = p.get('matt');
    if (matt) lage.matt = matt === 'vd' ? 'valdeltagande' : matt;
    if (['topp', 'kommun', 'valdistrikt'].includes(p.get('niva'))) lage.niva = p.get('niva');
    const omrade = (p.get('omrade') || '').split(':');
    if (omrade[0] === 'topp' || omrade[0] === 'kommun') {
      lage.omrade = { typ: omrade[0], kod: omrade[1] };
    }
    if (p.get('skala')) lage.skala = p.get('skala');
    const vald = (p.get('vald') || '').split(':');
    if (['topp', 'kommun', 'valdistrikt'].includes(vald[0])) {
      lage.vald = { niva: vald[0], kod: vald[1] };
    }
  }

  // ---- Händelser ----------------------------------------------------------

  function kopplaHandelser() {
    $('matt').addEventListener('change', (e) => {
      lage.matt = e.target.value;
      stallInKnappar();
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
          const tp = kommunensTopp(omrade.kod);
          omrade = tp ? { typ: 'topp', kod: tp } : { typ: 'riket', kod: null };
        }
        if (omrade.typ === 'topp' && niva === 'topp') omrade = { typ: 'riket', kod: null };
        gaTill(omrade, niva);
      });
    }

    for (const b of document.querySelectorAll('.list-knapp')) {
      b.addEventListener('click', () => {
        lage.sortering = b.dataset.sort;
        stallInKnappar();
        ritTabell();
      });
    }

    $('filter-topp').addEventListener('change', (e) => {
      const kod = e.target.value;
      if (!kod) gaTill({ typ: 'riket', kod: null }, 'topp');
      else gaTill({ typ: 'topp', kod }, 'kommun');
    });

    $('filter-kommun').addEventListener('change', (e) => {
      const kod = e.target.value;
      if (!kod) {
        const tp = $('filter-topp').value;
        gaTill(tp ? { typ: 'topp', kod: tp } : { typ: 'riket', kod: null },
          tp ? 'kommun' : 'topp');
      } else {
        gaTill({ typ: 'kommun', kod }, 'valdistrikt', { vald: { niva: 'kommun', kod } });
      }
    });

    $('aterstall').addEventListener('click', () => {
      gaTill({ typ: 'riket', kod: null }, 'topp');
    });

    $('sok').addEventListener('change', (e) => sok(e.target.value));

    $('brodsmula').addEventListener('click', (e) => {
      const knapp = e.target.closest('[data-hopp]');
      if (!knapp) return;
      const [typ, kod] = knapp.dataset.hopp.split(':');
      if (typ === 'riket') gaTill({ typ: 'riket', kod: null }, 'topp');
      else if (typ === 'topp') gaTill({ typ: 'topp', kod }, 'kommun');
      else gaTill({ typ: 'kommun', kod }, 'valdistrikt');
    });

    $('tabell').addEventListener('click', (e) => {
      const rad = e.target.closest('tr[data-kod]');
      if (!rad) return;
      const enhet = geoLager(lage.niva).perKod.get(rad.dataset.kod);
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
  // letar vi i tur och ordning bland kommuner, toppnivåer och valdistrikt.
  function sok(text) {
    const parentes = /\s*\(([^)]*)\)\s*$/.exec(text);
    const sort = parentes ? parentes[1].trim().toLowerCase() : '';
    const fras = text.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
    if (!fras) return;
    const toppsort = data.meta.toppNamn.toLowerCase();

    const traffa = (lista, namn) => lista.find((x) => namn(x).toLowerCase() === fras)
      || lista.find((x) => namn(x).toLowerCase().startsWith(fras));

    if (sort !== toppsort) {
      const kommun = traffa(data.meta.kommuner, (k) => k.namn);
      if (kommun && (sort === 'kommun' || sort === '')) {
        gaTill({ typ: 'kommun', kod: kommun.kod }, 'valdistrikt',
          { vald: { niva: 'kommun', kod: kommun.kod } });
        return;
      }
    }

    if (sort === '' || sort === toppsort) {
      const topp = traffa(data.meta.toppnivan, (t) => t.namn);
      if (topp) {
        gaTill({ typ: 'topp', kod: topp.kod }, 'kommun',
          { vald: { niva: 'topp', kod: topp.kod } });
        return;
      }
      if (sort === toppsort) return;
    }

    const distrikt = traffa([...data.distriktPerKod.values()], (d) => d.n);
    if (distrikt) {
      gaTill({ typ: 'kommun', kod: distrikt.km }, 'valdistrikt',
        { vald: { niva: 'valdistrikt', kod: distrikt.k } });
    }
  }

  // ---- Text som beror på datat -------------------------------------------

  function fyllText() {
    const m = data.meta;
    const kvar = m.antalValdistriktSomSkaRaknas - m.antalValdistriktRaknade;
    document.title = `Förändringskartan – ${m.valtypNamn} 2026 mot 2022`;
    $('underrubrik').textContent =
      `Valet till ${m.valtypNamn.toLowerCase()} ${m.valdatum.slice(0, 4)} ` +
      `jämfört med ${m.tidigareValdatum.slice(0, 4)}`;

    const banner = $('rakningsbanner');
    banner.hidden = m.rakningstillfalle === 'slutlig';
    if (!banner.hidden) {
      banner.textContent =
        `Preliminärt valresultat. ${m.antalValdistriktRaknade.toLocaleString('sv-SE')} av ` +
        `${m.antalValdistriktSomSkaRaknas.toLocaleString('sv-SE')} valdistrikt är räknade` +
        (kvar > 0 ? ` – ${kvar.toLocaleString('sv-SE')} återstår.` : '.') +
        ` Senast uppdaterat hos Valmyndigheten: ${m.senasteUppdateringstid}.`;
    }

    $('om-jamforbarhet').textContent =
      `Valdistrikt ritas om mellan valen. Där gränserna ändrats finns inga ` +
      `jämförbara siffror för 2022, och distriktet lämnas ofärgat på kartan. ` +
      `I valet till ${m.valtypNamn.toLowerCase()} gäller det ` +
      `${m.distriktOjamforbara.toLocaleString('sv-SE')} av ` +
      `${m.antalValdistriktSomSkaRaknas.toLocaleString('sv-SE')} distrikt – ` +
      `där ingår också uppsamlingsdistrikten, dit sena brev- och budröster går ` +
      `och som inte har någon egen geografi.`;

    $('om-kalla').textContent =
      `Siffrorna hämtades från Valmyndigheten ${new Date(m.hamtat).toLocaleString('sv-SE')} ` +
      `och gäller det ${m.rakningstillfalle}a resultatet i valet till ` +
      `${m.valtypNamn.toLowerCase()} ${m.valdatum}, jämfört med valet ${m.tidigareValdatum}.`;
  }

  // ---- Start --------------------------------------------------------------

  async function start() {
    matDuken();
    try {
      valen = (await hamtaJson('val.json')).val;
      lasHash();
      data = await laddaVal(lage.val);
    } catch (fel) {
      $('kartladdare').textContent = `Kunde inte läsa valdata: ${fel.message}`;
      return;
    }
    // Utan val i adressen visas partiet som ökat mest i landet. Då har kartan
    // både orange och lila områden från början, i stället för att bli enfärgad
    // som den blir för partiet som backat mest.
    if (!lage.matt) {
      const riket = data.omraden.riket;
      lage.matt = data.meta.partier
        .map((p) => [p.kod, (K.andel(riket.r[p.kod] || 0, riket.g) || 0)
          - (K.andel(riket.r0[p.kod] || 0, riket.g0) || 0)])
        .sort((a, b) => b[1] - a[1])[0][0];
    }
    byggValknappar();
    fyllText();
    fyllOmradesfilter();
    kopplaHandelser();
    $('skala').value = lage.skala;
    await uppdatera({ passa: true });
  }

  start();
})();
