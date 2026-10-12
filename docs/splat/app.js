// Splatfönstret: kopplar ihop ansiktsspårningen, scenerna och renderaren.
'use strict';

(() => {
  const F = window.Fonster, S = window.Splatdata, Demo = window.Demoscen;
  const $ = (id) => document.getElementById(id);
  const klamra = (v, min, max) => Math.min(max, Math.max(min, v));
  const tal = (v, d = 0) => v.toFixed(d).replace('.', ',').replace('-', '−');

  const HF = 'https://huggingface.co/cakewalk/splat-data/resolve/main/';
  const SCENER = [
    { id: 'neon', namn: 'Neonrummet', info: 'Byggs direkt' },
    { id: 'gosedjur', namn: 'Gosedjur', info: '9 MB', url: HF + 'plush.splat' },
    { id: 'sko', namn: 'Sko', info: '9 MB', url: HF + 'nike.splat' },
    { id: 'tag', namn: 'Tåg', info: '33 MB', url: HF + 'train.splat' },
  ];
  const BAKGRUND = [5 / 255, 6 / 255, 12 / 255];
  const NARA = 10; // mm från ögat
  const pekskarm = matchMedia('(pointer: coarse)').matches;
  // Hur långt bort huvudet antas vara när det inte syns.
  const STANDARDAVSTAND = pekskarm ? 320 : 600;

  // ---- Inställningar, sparade i webbläsaren --------------------------------

  const STANDARD = { effekt: 1.5, kvalitet: 1.5, visaKamera: false, spegla: false };
  const inst = (() => {
    try { return { ...STANDARD, ...JSON.parse(localStorage.getItem('splatfonstret') || '{}') }; }
    catch { return { ...STANDARD }; }
  })();
  const sparaInst = () => {
    try { localStorage.setItem('splatfonstret', JSON.stringify(inst)); } catch { /* privat läge */ }
  };

  // ---- Meddelanden och status ------------------------------------------------

  let meddelandeTimer = null;
  function visaMeddelande(text, typ = 'info', ms = 7000) {
    const m = $('meddelande');
    m.textContent = text;
    m.dataset.typ = typ;
    m.hidden = false;
    clearTimeout(meddelandeTimer);
    if (ms) meddelandeTimer = setTimeout(() => { m.hidden = true; }, ms);
  }
  $('meddelande').addEventListener('click', () => { $('meddelande').hidden = true; });

  const STATUSTEXT = {
    av: 'Ingen kamera – tryck för att starta',
    startar: 'Startar …',
    letar: 'Letar efter ditt ansikte …',
    foljer: 'Följer dig · tryck för att centrera',
    nekad: 'Kameran nekad',
    fel: 'Kamerafel',
  };

  // ---- Renderaren ------------------------------------------------------------

  const canvas = $('duk');
  let renderare;
  try {
    renderare = new Renderare(canvas);
  } catch (e) {
    $('start').hidden = true;
    visaMeddelande('Den här webbläsaren kan inte rita 3D-grafik (WebGL2 saknas eller är avstängt).', 'fel', 0);
    return;
  }

  const lage = {
    scen: null,      // { id, namn, antal, djup }
    vy: null,        // { yaw, pitch, vand, djup, storlek } – användarens justeringar
    oga: { x: 0, y: 0, z: STANDARDAVSTAND },
    neutral: null,   // huvudets viloläge, som räknas som "rakt framför"
    senastAnsikte: -Infinity,
    aterfunnet: -Infinity,
    sparning: null,
    status: 'av',
    smutsig: true,
    mus: null,
    demoLiggande: null,
  };

  const skarm = () => F.skarmstorlek(canvas.clientWidth, canvas.clientHeight, pekskarm);
  const skarmvinkel = () => {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return typeof window.orientation === 'number' ? window.orientation : 0;
  };

  function sattStatus(l, text) {
    lage.status = l;
    $('status').dataset.lage = l;
    $('statustext').textContent = text || STATUSTEXT[l];
    visaForhandsvisning();
  }

  // ---- Sorteringen -----------------------------------------------------------
  // Kameran vrids aldrig, bara flyttas, så ordningen bakifrån och fram ändras
  // inte när huvudet rör sig. Den behöver bara räknas om när scenen vrids.

  const sorterare = new Worker('sortering.js');
  let generation = 0, vantarSortering = false, sorteradRad = null;
  sorterare.onmessage = (e) => {
    const m = e.data;
    if (m.generation !== generation) return;
    vantarSortering = false;
    renderare.sattOrdning(m.ordning);
    lage.smutsig = true;
  };

  function kanskeSortera(mv) {
    const rad = [mv[2], mv[6], mv[10]];
    const storlek = Math.abs(rad[0]) + Math.abs(rad[1]) + Math.abs(rad[2]);
    const andring = sorteradRad
      ? Math.abs(rad[0] - sorteradRad[0]) + Math.abs(rad[1] - sorteradRad[1]) + Math.abs(rad[2] - sorteradRad[2])
      : Infinity;
    if (andring <= 1e-3 * storlek || vantarSortering) return;
    vantarSortering = true;
    sorteradRad = rad;
    sorterare.postMessage({ typ: 'sortera', mv: Float32Array.from(mv), generation });
  }

  // ---- Scenerna --------------------------------------------------------------

  function installeraScen({ id, namn, scen, bakning, djup }) {
    const packad = S.packa(scen, bakning);
    renderare.laddaScen(packad);
    generation++;
    vantarSortering = false;
    sorteradRad = null;
    sorterare.postMessage({ typ: 'data', positioner: packad.positioner, antal: packad.antal, generation },
      [packad.positioner.buffer]);
    lage.scen = { id, namn, antal: packad.antal, djup };
    aterstallVy();
    markeraScen(id);
  }

  function visaDemo() {
    const s = skarm();
    const { scen, djup } = Demo.neonrummet(s.bredd, s.hojd);
    installeraScen({ id: 'neon', namn: 'Neonrummet', scen, bakning: {}, djup });
    lage.demoLiggande = s.bredd > s.hojd;
  }

  let laddningsnummer = 0;
  const mb = (b) => tal(b / 1048576, b < 10485760 ? 1 : 0) + ' MB';

  function visaLaddning(text, andel) {
    $('laddning').hidden = false;
    $('laddningstext').textContent = text;
    $('stapelfyllning').style.width = andel === null ? '100%' : `${Math.round(andel * 100)}%`;
    $('stapelfyllning').style.opacity = andel === null ? '0.35' : '1';
  }
  const doljLaddning = () => { $('laddning').hidden = true; };

  async function laddaFranUrl(id, namn, url) {
    const nr = ++laddningsnummer;
    const vad = namn.toLowerCase();
    visaLaddning(`Hämtar ${vad} …`, 0);
    try {
      const svar = await fetch(url);
      if (!svar.ok) throw new S.Splatfel(`Kunde inte hämta ${vad} – servern svarade ${svar.status}.`);
      const total = Number(svar.headers.get('content-length')) || 0;
      let buffer;
      if (svar.body && svar.body.getReader) {
        const lasare = svar.body.getReader();
        const delar = [];
        let fatt = 0;
        for (;;) {
          const { done, value } = await lasare.read();
          if (done) break;
          if (nr !== laddningsnummer) { lasare.cancel(); return; }
          delar.push(value);
          fatt += value.length;
          visaLaddning(`Hämtar ${vad} … ${mb(fatt)}${total ? ' av ' + mb(total) : ''}`, total ? fatt / total : null);
        }
        const alla = new Uint8Array(fatt);
        let o = 0;
        for (const d of delar) { alla.set(d, o); o += d.length; }
        buffer = alla.buffer;
      } else {
        buffer = await svar.arrayBuffer();
      }
      if (nr !== laddningsnummer) return;
      await laddaBuffert(buffer, id, namn, nr);
    } catch (e) {
      if (nr !== laddningsnummer) return;
      misslyckad(e, `Kunde inte hämta ${vad}. Kontrollera uppkopplingen och försök igen.`);
    }
  }

  async function laddaFil(fil) {
    const nr = ++laddningsnummer;
    visaLaddning(`Läser ${fil.name} …`, null);
    try {
      const buffer = await fil.arrayBuffer();
      if (nr !== laddningsnummer) return;
      await laddaBuffert(buffer, 'egen', fil.name, nr);
    } catch (e) {
      if (nr !== laddningsnummer) return;
      misslyckad(e, `Kunde inte läsa ${fil.name}.`);
    }
  }

  function misslyckad(e, standardtext) {
    doljLaddning();
    console.error(e);
    visaMeddelande(e instanceof S.Splatfel ? e.message : standardtext, 'fel');
    markeraScen(lage.scen && lage.scen.id);
  }

  // Tränade scener har ingen naturlig storlek eller placering. Motivet görs
  // ungefär lika stort som skärmens kortsida och läggs strax bakom glaset.
  async function laddaBuffert(buffer, id, namn, nr) {
    visaLaddning('Förbereder splattarna …', null);
    await new Promise((r) => setTimeout(r, 30)); // låt texten hinna synas
    if (nr !== laddningsnummer) return;
    const scen = S.lasFil(buffer);
    if (scen.antal > renderare.maxSplattar) {
      throw new S.Splatfel(`Scenen har ${scen.antal.toLocaleString('sv-SE')} splattar – fler än den här enheten kan rita.`);
    }
    const { centrum, r50 } = S.ramaIn(scen);
    const s = skarm();
    const mal = 0.4 * Math.min(s.bredd, s.hojd);
    installeraScen({
      id, namn, scen,
      bakning: { centrum, skala: mal / (r50 || 1), rotation: S.COLMAP_TILL_FONSTER },
      djup: -mal * 1.15,
    });
    doljLaddning();
  }

  function valjScen(def) {
    if (lage.scen && lage.scen.id === def.id && $('laddning').hidden) return;
    markeraScen(def.id);
    if (def.url) {
      laddaFranUrl(def.id, def.namn, def.url);
    } else {
      ++laddningsnummer;
      doljLaddning();
      visaDemo();
    }
  }

  function markeraScen(id) {
    for (const el of $('scener').children) {
      const vald = el.dataset.id === id;
      el.dataset.vald = String(vald);
      if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(vald));
    }
  }

  function byggScenval() {
    const lista = $('scener');
    for (const def of SCENER) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.id = def.id;
      b.append(document.createElement('span'), document.createElement('small'));
      b.children[0].textContent = def.namn;
      b.children[1].textContent = def.info;
      b.addEventListener('click', () => valjScen(def));
      lista.append(b);
    }
    const fil = document.createElement('label');
    fil.className = 'chip';
    fil.dataset.id = 'egen';
    fil.tabIndex = 0;
    fil.innerHTML = '<span>Egen fil …</span><small>.splat eller .ply</small><input type="file" accept=".splat,.ply">';
    const input = fil.querySelector('input');
    input.addEventListener('change', () => {
      if (input.files[0]) { markeraScen('egen'); laddaFil(input.files[0]); }
      input.value = '';
    });
    fil.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    lista.append(fil);
  }

  // ---- Vyn: användarens vridning, storlek och djup ---------------------------

  function aterstallVy() {
    lage.vy = { yaw: 0, pitch: 0, vand: false, djup: 0, storlek: 0 };
    lage.smutsig = true;
    synkaReglage();
  }

  function modellmatris() {
    const v = lage.vy;
    return F.kedja(
      F.forflyttning(0, 0, (lage.scen ? lage.scen.djup : 0) + v.djup),
      F.skalning(2 ** v.storlek),
      F.rotationX(v.pitch),
      F.rotationY(v.yaw),
      v.vand ? F.rotationX(Math.PI) : F.identitet()
    );
  }

  // ---- Ansiktsspårningen -----------------------------------------------------

  const filter = {
    x: new F.EnEuroFilter({ minGrans: 1.0, beta: 0.02 }),
    y: new F.EnEuroFilter({ minGrans: 1.0, beta: 0.02 }),
    // avståndet är det brusigaste måttet och får jämnas ut mer
    z: new F.EnEuroFilter({ minGrans: 0.5, beta: 0.01 }),
  };

  function narResultat({ landmarken, bredd, hojd, tid }) {
    const t = tid / 1000;
    const kam = landmarken && F.uppskattaOgon(landmarken, bredd, hojd, { spegla: inst.spegla });
    if (!kam) {
      $('ogonpunkt').hidden = true;
      if (lage.status === 'foljer' && t - lage.senastAnsikte > 0.6) sattStatus('letar');
      return;
    }
    if (t - lage.senastAnsikte > 1) { filter.x.nollstall(); filter.y.nollstall(); filter.z.nollstall(); }
    if (t - lage.senastAnsikte > 0.6) lage.aterfunnet = t;
    const s = skarm();
    const kp = F.kameraposition(skarmvinkel(), s.bredd, s.hojd);
    filter.x.filtrera(kam.x + kp.x, t);
    filter.y.filtrera(kam.y + kp.y, t);
    filter.z.filtrera(kam.z, t);
    lage.senastAnsikte = t;
    if (lage.status !== 'foljer') sattStatus('foljer');

    if (inst.visaKamera) {
      const u = (landmarken[33].x + landmarken[263].x) / 2, v = (landmarken[33].y + landmarken[263].y) / 2;
      const p = $('ogonpunkt');
      p.style.left = `${(1 - u) * 100}%`; // förhandsvisningen är spegelvänd
      p.style.top = `${v * 100}%`;
      p.hidden = false;
    }
  }

  function narSparningsLage(l, detalj) {
    if (l === 'startar') sattStatus('startar', 'Startar kameran …');
    else if (l === 'modell') sattStatus('startar', 'Laddar ansiktsmodellen …');
    else if (l === 'letar') sattStatus('letar');
    else if (l === 'fel') {
      console.error(detalj);
      sattStatus('fel', 'Spårningen stannade');
    }
  }

  async function startaKamera() {
    $('start').hidden = true;
    if (lage.sparning) return;
    const video = $('kamera');
    lage.sparning = new Ansiktssparning(video, { narResultat, narLage: narSparningsLage });
    try {
      await lage.sparning.starta();
      lage.neutral = null;
      behallSkarmen();
    } catch (e) {
      console.error(e);
      lage.sparning.stoppa();
      lage.sparning = null;
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        sattStatus('nekad');
        visaMeddelande('Kameran nekades, så bilden rör sig av sig själv i stället. Tillåt kameran för sidan i webbläsarens inställningar och tryck på statusraden för att försöka igen.', 'fel', 10000);
      } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError' || e.name === 'NotReadableError') {
        sattStatus('fel', 'Hittar ingen kamera');
      } else if (e.name === 'IngenKamera') {
        sattStatus('fel', 'Kameran kräver https');
        visaMeddelande(e.message, 'fel');
      } else {
        sattStatus('fel', 'Spårningen startade inte');
        visaMeddelande('Ansiktsmodellen kunde inte laddas. Kontrollera uppkopplingen och försök igen.', 'fel');
      }
    }
  }

  function centrera() {
    lage.neutral = null;
    visaMeddelande('Centrerat – huvudets läge just nu räknas som rakt framför.', 'info', 2500);
  }

  function visaForhandsvisning() {
    const syns = inst.visaKamera && !!lage.sparning && lage.sparning.aktiv;
    $('forhandsvisning').classList.toggle('dold', !syns);
    if (!syns) $('ogonpunkt').hidden = true;
  }

  $('kamera').addEventListener('loadedmetadata', (e) => {
    const v = e.target;
    if (v.videoWidth) $('forhandsvisning').style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
  });

  // Skärmen ska inte slockna medan man tittar – man rör den ju inte.
  let skarmlas = null;
  async function behallSkarmen() {
    try {
      if ('wakeLock' in navigator && !document.hidden && !skarmlas) {
        skarmlas = await navigator.wakeLock.request('screen');
        skarmlas.addEventListener('release', () => { skarmlas = null; });
      }
    } catch { /* inte så viktigt */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && lage.sparning && lage.sparning.aktiv) behallSkarmen();
  });

  // ---- Ögat, varje bildruta ----------------------------------------------------

  function uppdateraOga(t, dt, s) {
    const sparar = lage.sparning && lage.sparning.aktiv;
    if (sparar && t - lage.senastAnsikte < 0.6 && filter.x.x !== null) {
      const x = filter.x.framat(t), y = filter.y.framat(t), z = filter.z.framat(t);
      if (!lage.neutral) lage.neutral = { x, y };
      const mal = {
        x: (x - lage.neutral.x) * inst.effekt,
        y: (y - lage.neutral.y) * inst.effekt,
        z: klamra(z, 120, 1500),
      };
      // Precis när ansiktet hittats igen glider bilden dit i stället för att hoppa.
      const k = t - lage.aterfunnet < 0.4 ? 1 - Math.exp(-dt * 12) : 1;
      const o = lage.oga;
      lage.oga = { x: o.x + (mal.x - o.x) * k, y: o.y + (mal.y - o.y) * k, z: o.z + (mal.z - o.z) * k };
      return;
    }
    let mal;
    if (sparar) mal = { x: 0, y: 0, z: lage.oga.z };        // tappat ansiktet: glid mot mitten
    else if (lage.mus) mal = { x: lage.mus.x * s.bredd * 0.8, y: lage.mus.y * s.hojd * 0.5, z: STANDARDAVSTAND };
    else mal = { x: Math.sin(t * 0.55) * s.bredd * 0.6, y: Math.sin(t * 0.37) * s.hojd * 0.18, z: STANDARDAVSTAND };
    const k = 1 - Math.exp(-dt * (sparar ? 1.5 : 5));
    const o = lage.oga;
    lage.oga = { x: o.x + (mal.x - o.x) * k, y: o.y + (mal.y - o.y) * k, z: o.z + (mal.z - o.z) * k };
  }

  let forraTid = null, bilder = 0, bildtakt = 0, taktTid = 0, senastRitat = null;

  function ruta(nu) {
    requestAnimationFrame(ruta);
    const t = nu / 1000;
    const dt = forraTid === null ? 0 : Math.min(0.1, Math.max(0, t - forraTid));
    forraTid = t;
    if (renderare.anpassa(Math.min(window.devicePixelRatio || 1, inst.kvalitet))) lage.smutsig = true;

    const s = skarm();
    if (lage.scen && lage.scen.id === 'neon' && (s.bredd > s.hojd) !== lage.demoLiggande) visaDemo();

    uppdateraOga(t, dt, s);
    const o = lage.oga;
    if (!senastRitat || Math.abs(o.x - senastRitat.x) + Math.abs(o.y - senastRitat.y) + Math.abs(o.z - senastRitat.z) > 0.005) {
      lage.smutsig = true;
    }

    if (t - taktTid > 0.5) {
      bildtakt = bilder / (t - taktTid);
      bilder = 0;
      taktTid = t;
      if (!$('installningar').hidden) visaTeknik();
    }
    if (!lage.smutsig || !lage.scen) return;

    const mv = F.multiplicera(F.vymatris(o), modellmatris());
    kanskeSortera(mv);
    const fram = 0.6 * Math.min(s.bredd, s.hojd); // så långt ut ur glaset får scenen sticka
    renderare.rita({
      projektion: F.fonsterprojektion(o, s.bredd, s.hojd, NARA, 1e6),
      modellvy: mv,
      narmast: Math.min(fram - o.z, -NARA),
      bakgrund: BAKGRUND,
    });
    senastRitat = { ...o };
    lage.smutsig = false;
    bilder++;
  }

  function visaTeknik() {
    const o = lage.oga, delar = [];
    if (lage.scen) delar.push(`${lage.scen.antal.toLocaleString('sv-SE')} splattar`);
    delar.push(`${Math.round(bildtakt)} bilder/s`);
    delar.push(`ögat ${tal(o.x)}, ${tal(o.y)}, ${tal(o.z)} mm`);
    if (lage.sparning && lage.sparning.delegat) {
      delar.push(`ansiktsmodellen på ${lage.sparning.delegat === 'GPU' ? 'grafikprocessorn' : 'processorn'}`);
    }
    $('teknik').textContent = delar.join(' · ');
  }

  // ---- Gester ----------------------------------------------------------------

  const pekare = new Map();
  let gest = null, senastTryck = 0, tryckTimer = null;
  const avstandMellan = () => {
    const [a, b] = [...pekare.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pekare.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pekare.size === 1) gest = { typ: 'vrid', x: e.clientX, y: e.clientY, tid: e.timeStamp, flyttat: false };
    else if (pekare.size === 2) gest = { typ: 'nyp', avstand: avstandMellan(), storlek: lage.vy.storlek };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pekare.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        lage.mus = { x: (e.clientX / innerWidth - 0.5) * 2, y: -(e.clientY / innerHeight - 0.5) * 2 };
      }
      return;
    }
    const forra = pekare.get(e.pointerId);
    pekare.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gest) return;
    if (gest.typ === 'vrid') {
      if (!gest.flyttat && Math.hypot(e.clientX - gest.x, e.clientY - gest.y) > 8) gest.flyttat = true;
      if (gest.flyttat) {
        lage.vy.yaw += (e.clientX - forra.x) * 0.008;
        lage.vy.pitch = klamra(lage.vy.pitch + (e.clientY - forra.y) * 0.008, -1.4, 1.4);
        lage.smutsig = true;
      }
    } else if (gest.typ === 'nyp' && pekare.size === 2) {
      lage.vy.storlek = klamra(gest.storlek + Math.log2(avstandMellan() / gest.avstand), -3, 3);
      lage.smutsig = true;
      synkaReglage();
    }
  });

  const slapp = (e) => {
    if (!pekare.has(e.pointerId)) return;
    pekare.delete(e.pointerId);
    const tryck = e.type === 'pointerup' && gest && gest.typ === 'vrid' && !gest.flyttat && e.timeStamp - gest.tid < 350;
    if (tryck) {
      // Ett tryck döljer knapparna, två snabba återställer vyn.
      if (e.timeStamp - senastTryck < 320) {
        clearTimeout(tryckTimer);
        senastTryck = 0;
        aterstallVy();
      } else {
        senastTryck = e.timeStamp;
        tryckTimer = setTimeout(() => {
          if ($('installningar').hidden) document.body.classList.toggle('lugn');
          else oppnaInstallningar(false);
        }, 320);
      }
    }
    // Efter en nypning får det kvarvarande fingret vrida, men inte räknas som tryck.
    gest = pekare.size === 1 ? { typ: 'vrid', x: 0, y: 0, tid: 0, flyttat: true } : null;
  };
  canvas.addEventListener('pointerup', slapp);
  canvas.addEventListener('pointercancel', slapp);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') lage.mus = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    lage.vy.storlek = klamra(lage.vy.storlek - e.deltaY * 0.002, -3, 3);
    lage.smutsig = true;
    synkaReglage();
  }, { passive: false });

  // ---- Inställningspanelen ---------------------------------------------------

  function synkaReglage() {
    if (!lage.vy) return;
    $('effekt').value = inst.effekt;
    $('effektVarde').textContent = tal(inst.effekt, 1) + '×';
    $('djup').value = lage.vy.djup;
    $('djupVarde').textContent = `${tal(lage.vy.djup)} mm`;
    $('storlek').value = lage.vy.storlek;
    $('storlekVarde').textContent = `${Math.round(2 ** lage.vy.storlek * 100)} %`;
    $('kvalitet').value = String(inst.kvalitet);
    $('visaKamera').checked = inst.visaKamera;
    $('spegla').checked = inst.spegla;
  }

  function oppnaInstallningar(oppen) {
    $('installningar').hidden = !oppen;
    $('oppnaInstallningar').setAttribute('aria-expanded', String(oppen));
    if (oppen) { document.body.classList.remove('lugn'); synkaReglage(); visaTeknik(); }
  }

  $('oppnaInstallningar').addEventListener('click', () => oppnaInstallningar($('installningar').hidden));
  $('stangInstallningar').addEventListener('click', () => oppnaInstallningar(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') oppnaInstallningar(false); });

  $('effekt').addEventListener('input', (e) => { inst.effekt = Number(e.target.value); sparaInst(); synkaReglage(); });
  $('djup').addEventListener('input', (e) => { lage.vy.djup = Number(e.target.value); lage.smutsig = true; synkaReglage(); });
  $('storlek').addEventListener('input', (e) => { lage.vy.storlek = Number(e.target.value); lage.smutsig = true; synkaReglage(); });
  $('kvalitet').addEventListener('change', (e) => { inst.kvalitet = Number(e.target.value); sparaInst(); lage.smutsig = true; });
  $('visaKamera').addEventListener('change', (e) => { inst.visaKamera = e.target.checked; sparaInst(); visaForhandsvisning(); });
  $('spegla').addEventListener('change', (e) => { inst.spegla = e.target.checked; sparaInst(); lage.neutral = null; });
  $('centrera').addEventListener('click', centrera);
  $('vand').addEventListener('click', () => { lage.vy.vand = !lage.vy.vand; lage.smutsig = true; });
  $('aterstall').addEventListener('click', aterstallVy);

  $('status').addEventListener('click', () => {
    if (lage.sparning) centrera();
    else startaKamera();
  });
  $('startaKamera').addEventListener('click', startaKamera);
  $('utanKamera').addEventListener('click', () => { $('start').hidden = true; });

  // ---- Start -----------------------------------------------------------------

  byggScenval();
  sattStatus('av');
  const fraga = new URLSearchParams(location.search);
  const forvald = SCENER.find((d) => d.id === fraga.get('scen'));
  visaDemo();
  if (fraga.get('url')) {
    const url = fraga.get('url');
    markeraScen('egen');
    laddaFranUrl('egen', decodeURIComponent(url.split('/').pop().split('?')[0]) || 'Scenen', url);
  } else if (forvald && forvald.url) {
    valjScen(forvald);
  }
  requestAnimationFrame(ruta);
})();
