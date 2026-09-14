// Bygger datafilerna till förändringskartan (docs/karta.html).
//
//   node bygg-valdata.mjs                  hämtar alla tre valen till docs/valdata/
//   node bygg-valdata.mjs --val=KF         bara kommunvalet
//   node bygg-valdata.mjs --rakning=S      slutligt resultat i stället för preliminärt
//   node bygg-valdata.mjs --parallellt=6   snällare mot val.se
//
// Källa: Valmyndighetens valpresentation (resultat.val.se), samma filer som
// webbplatsen resultat.val.se själv läser. Varje valdistrikt hämtas som en egen
// fil eftersom det bara är på den nivån som antalet röstberättigade och flaggan
// "jämförbar" finns med – och båda behövs för att kunna väga ihop distrikten.
//
// Per val skrivs tre filer under docs/valdata/<val>/:
//   meta.json         partier, räkningsläge, namn på län/valkretsar och kommuner
//   omraden.json      färdiga summor för riket, toppnivån och kommunerna
//   valdistrikt.json  röster per parti och distrikt, 2026 och 2022
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Sammanvägningen delas med webbappen, så att kartan och de förberäknade
// summorna räknar på exakt samma sätt.
const { summera } = createRequire(import.meta.url)('./docs/kartlogik.js');

const BAS = process.env.VAL_API || 'https://resultat.val.se';
const VALTILLFALLE = 'val2026';
const UTMAPP = path.join(import.meta.dirname, 'docs', 'valdata');

const flagga = (namn, standard) => {
  const träff = process.argv.find((a) => a.startsWith(`--${namn}=`));
  return träff ? träff.slice(namn.length + 3) : standard;
};

const RAKNING = flagga('rakning', 'P');          // P = preliminär, S = slutlig
const PARALLELLT = Number(flagga('parallellt', 10));

// De tre valen. Toppnivån heter olika saker i olika val: riksdagsvalet delas in
// i 29 valkretsar, regionvalet i 20 regioner (Gotland har ingen – där sköter
// kommunen regionens uppgifter) och kommunvalet i 21 län.
const VALTYPER = [
  { kod: 'RD', namn: 'Riksdagen', kort: 'Riksdag', topp: 'valkrets', toppNamn: 'Valkrets', toppNamnFler: 'valkretsar' },
  { kod: 'RF', namn: 'Regionfullmäktige', kort: 'Region', topp: 'lan', toppNamn: 'Region', toppNamnFler: 'regioner' },
  { kod: 'KF', namn: 'Kommunfullmäktige', kort: 'Kommun', topp: 'lan', toppNamn: 'Län', toppNamnFler: 'län' },
];

const VALDA = flagga('val', '').split(',').filter(Boolean);
const KÖRS = VALDA.length ? VALTYPER.filter((v) => VALDA.includes(v.kod)) : VALTYPER;

// --- Hämtning ---------------------------------------------------------------

async function hamta(stig, försök = 3) {
  for (let i = 1; ; i++) {
    try {
      const svar = await fetch(`${BAS}${stig}`, { headers: { Accept: 'application/json' } });
      // Allt har inte en egen fil: län saknar resultat i kommunvalet, och
      // uppsamlingsdistrikten – dit sena brev- och budröster går – får sin fil
      // först när de räknats, på onsdagen efter valet. Båda ska behandlas som
      // "finns inte", inte som ett fel.
      if (svar.status === 404) return null;
      if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
      return await svar.json();
    } catch (fel) {
      if (i >= försök) throw new Error(`${stig}: ${fel.message}`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

const resultat = (nyckel) =>
  hamta(`/data/resultat/${VALTILLFALLE}/${nyckel}_${RAKNING}.json`);

// Kör jobben några i taget så att vi inte spränger val.se med tusentals
// samtidiga anrop. Rapporterar framsteg på stderr eftersom det tar minuter.
async function iTur(jobb, antal, etikett) {
  const svar = new Array(jobb.length);
  let nästa = 0;
  let klara = 0;
  const arbetare = Array.from({ length: antal }, async () => {
    while (nästa < jobb.length) {
      const i = nästa++;
      svar[i] = await jobb[i]();
      if (++klara % 250 === 0 || klara === jobb.length) {
        process.stderr.write(`\r${etikett}: ${klara}/${jobb.length}   `);
      }
    }
  });
  await Promise.all(arbetare);
  process.stderr.write('\n');
  return svar;
}

// --- Läsning av en resultatfil ---------------------------------------------

// Siffrorna kommer som "1 260" med hårt mellanslag. Tomt fält = inte räknat än.
const tal = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// "Övriga anmälda partier" saknar partikod hos Valmyndigheten. Den samlar de
// partier som fått för få röster i just det området för att redovisas var för
// sig – alla andra partier står med sitt eget namn, hur små de än är.
const OVRIGA = 'OVR';
const partikod = (p) => p.partikod || OVRIGA;

// Alla partier vi stött på i det här valet, så att kartan kan visa namn och
// färg. Lokala partier har ingen färg hos Valmyndigheten; de får en dämpad
// egen färg ur partikoden så att de går att skilja åt i partitabellen.
function färgFörParti(kod, given) {
  if (given) return given;
  if (kod === OVRIGA) return '#9aa4b0';
  let h = 0;
  for (const tecken of kod) h = (h * 31 + tecken.charCodeAt(0)) % 360;
  return `hsl(${h} 32% 48%)`;
}

function sammandrag(r, partier, extra = {}) {
  const nu = {};
  const fore = {};
  for (const p of r?.rosterPaverkaMandat?.partiroster ?? []) {
    const kod = partikod(p);
    if (!partier.has(kod)) {
      partier.set(kod, {
        kod,
        kort: p.partiforkortning || 'ÖVR',
        namn: p.partibeteckning,
        farg: färgFörParti(kod, p.fargkod),
        roster: 0,
      });
    }
    if (p.antalRoster) nu[kod] = p.antalRoster;
    if (p.antalRosterForegaendeVal) fore[kod] = p.antalRosterForegaendeVal;
  }
  return {
    ...extra,
    rb: tal(r?.antalRostberattigade) ?? 0,               // röstberättigade 2026
    rb0: tal(r?.antalRostberattigadeForegaendeVal) ?? 0, // …och 2022
    t: tal(r?.totaltAntalRoster) ?? 0,                   // alla röster, även blanka
    t0: tal(r?.totaltAntalRosterForegaendeVal) ?? 0,
    g: r?.rosterPaverkaMandat?.antalRoster ?? 0,         // giltiga partiröster
    g0: r?.rosterPaverkaMandat?.antalRosterForegaendeVal ?? 0,
    raknade: r?.antalValdistriktRaknade ?? 0,
    skaRaknas: r?.antalValdistriktSomSkaRaknas ?? 0,
    r: nu,
    r0: fore,
  };
}

// --- Ett val ----------------------------------------------------------------

const geografi = await hamta(`/data/valgeografi/valgeografi_${VALTILLFALLE}.json`);

async function byggVal(valtyp) {
  const träd = geografi.valgeografi.find((v) => v.kod === valtyp.kod);
  if (!träd) throw new Error(`Hittade ingen valtyp ${valtyp.kod} i valgeografin`);

  // Gå igenom trädet en gång och notera, för varje nod, vilka kommuner som
  // finns under den. Träden är olika djupa på olika håll – regionvalkretsar och
  // kommunvalkretsar dyker upp lite varstans – och i storstäderna ligger
  // valdistrikten direkt under valkretsen utan någon KOMMUN-nod alls.
  const distrikt = [];
  const kommunNamn = new Map();
  // Noder som skulle kunna vara en hel kommun. Vilken som faktiskt är det
  // avgörs längre ned, genom att räkna valdistrikt.
  const kandidater = new Map();
  const kandidat = (kommunkod, stig, antalDistrikt, arKommunnod) => {
    if (!kandidater.has(kommunkod)) kandidater.set(kommunkod, []);
    kandidater.get(kommunkod).push({ stig, antalDistrikt, arKommunnod });
  };

  function gaNed(nod, stig, toppkod) {
    const kommuner = new Set();
    let antal = 0;
    for (const barn of nod.valgeografi ?? []) {
      const barnstig = [...stig, barn.kod];
      if (barn.typ === 'VALDISTRIKT') {
        distrikt.push({ kod: barn.kod, namn: barn.namn, stig: barnstig.join('_'), topp: toppkod });
        kommuner.add(barn.kod.slice(0, 4));
        antal += 1;
        continue;
      }
      const under = gaNed(barn, barnstig, toppkod);
      for (const k of under.kommuner) kommuner.add(k);
      antal += under.antal;
      if (barn.typ === 'KOMMUN') {
        kommunNamn.set(barn.kod, barn.namn);
        kandidat(barn.kod, barnstig.join('_'), under.antal, true);
      } else if (under.kommuner.size === 1) {
        // En nod som bara innehåller en enda kommun kan vara den kommunen – så
        // ser Stockholm, Göteborg och Malmö ut i riksdagsvalet, och Karlskrona
        // i regionvalet. Men en kommun kan också vara uppdelad på flera sådana
        // noder, och då täcker ingen av dem hela kommunen.
        const [enda] = under.kommuner;
        kandidat(enda, barnstig.join('_'), under.antal, false);
      }
    }
    return { kommuner, antal };
  }

  const toppnivå = [];
  for (const topp of träd.valgeografi) {
    const stig = `${valtyp.kod}_${topp.kod}`;
    toppnivå.push({ kod: topp.kod, namn: topp.namn, stig });
    const under = gaNed(topp, [valtyp.kod, topp.kod], topp.kod);
    // Samma regel för toppnivån: valkretsarna Gotlands län och Göteborgs
    // kommun rymmer var sin enda kommun.
    if (under.kommuner.size === 1) {
      const [enda] = under.kommuner;
      kandidat(enda, stig, under.antal, false);
    }
  }

  // En nod duger som kommunens resultat bara om den innehåller alla kommunens
  // valdistrikt. Annars finns ingen färdig summa och kommunen får summeras av
  // sina distrikt i stället.
  const distriktPerKommun = new Map();
  for (const d of distrikt) {
    distriktPerKommun.set(d.kod.slice(0, 4), (distriktPerKommun.get(d.kod.slice(0, 4)) ?? 0) + 1);
  }
  const kommunStig = new Map();
  for (const [kod, alternativ] of kandidater) {
    const hela = alternativ.filter((a) => a.antalDistrikt === distriktPerKommun.get(kod));
    const bäst = hela.find((a) => a.arKommunnod) ?? hela[0];
    if (bäst) kommunStig.set(kod, bäst.stig);
  }

  // Kommunnamnen står inte alltid i det här valets träd. Kommunvalet har alltid
  // steget LÄN → KOMMUN, så namnen hämtas därifrån.
  for (const lan of geografi.valgeografi.find((v) => v.kod === 'KF')?.valgeografi ?? []) {
    for (const km of lan.valgeografi ?? []) {
      if (km.typ === 'KOMMUN' && !kommunNamn.has(km.kod)) kommunNamn.set(km.kod, km.namn);
    }
  }

  const kommunkoder = [...new Set(distrikt.map((d) => d.kod.slice(0, 4)))].sort();
  process.stderr.write(`${valtyp.kod}: ${toppnivå.length} ${valtyp.toppNamnFler}, ` +
    `${kommunkoder.length} kommuner, ${distrikt.length} valdistrikt\n`);

  const partier = new Map();

  const distriktSvar = await iTur(
    distrikt.map((d) => async () => [d, await resultat(d.stig)]),
    PARALLELLT, `${valtyp.kod} valdistrikt`);

  const toppOchKommun = await iTur([
    ...toppnivå.map((t) => async () => ['topp', t, await resultat(t.stig)]),
    ...kommunkoder.filter((k) => kommunStig.has(k)).map((k) => async () =>
      ['kommun', { kod: k, namn: kommunNamn.get(k) || k }, await resultat(kommunStig.get(k))]),
  ], PARALLELLT, `${valtyp.kod} områden`);

  // Partiregistret fylls i den ordning filerna läses; toppnivån först ger de
  // stora partierna först, men ordningen som betyder något sätts nedan.
  const rader = distriktSvar.map(([d, r]) => {
    const { raknade, skaRaknas, ...s } = sammandrag(r, partier, {
      k: d.kod,
      n: d.namn,
      km: d.kod.slice(0, 4),   // valdistriktskoden inleds med kommunkoden
      tp: d.topp,
    });
    return { ...s, j: r?.jamforbar ? 1 : 0, c: raknade > 0 ? 1 : 0 };
  });

  const omraden = { riket: null, tp: {}, km: {} };
  for (const [niva, enhet, r] of toppOchKommun) {
    const nyckel = niva === 'topp' ? 'tp' : 'km';
    omraden[nyckel][enhet.kod] = r
      ? sammandrag(r, partier, { namn: enhet.namn })
      : null;                                   // fylls genom summering nedan
  }

  // Kommuner som inte har någon egen färdig summa hos Valmyndigheten summeras
  // av sina valdistrikt. Då tappas 2022-siffrorna för de distrikt som ritats
  // om, så området märks som summerat.
  for (const kod of kommunkoder) {
    if (omraden.km[kod]) continue;
    omraden.km[kod] = summera(rader.filter((d) => d.km === kod),
      { namn: kommunNamn.get(kod) || kod, summerad: true });
    process.stderr.write(`${valtyp.kod}: ${kommunNamn.get(kod) || kod} saknar egen ` +
      'resultatfil – summeras av sina valdistrikt\n');
  }

  // Kommunernas toppnivå, för filtrering i gränssnittet.
  const toppPerKommun = new Map();
  for (const d of rader) if (!toppPerKommun.has(d.km)) toppPerKommun.set(d.km, d.tp);
  for (const [kod, värde] of Object.entries(omraden.km)) {
    if (värde) värde.tp = toppPerKommun.get(kod) ?? null;
  }


  // Län saknar egen resultatfil i kommunvalet. Summera kommunerna i stället –
  // kommunerna täcker länet helt, så summan tappar ingenting.
  for (const t of toppnivå) {
    if (omraden.tp[t.kod]) continue;
    const delar = kommunkoder
      .filter((k) => toppPerKommun.get(k) === t.kod)
      .map((k) => omraden.km[k])
      .filter(Boolean);
    omraden.tp[t.kod] = summera(delar, { namn: t.namn, summerad: true });
  }
  omraden.riket = summera(Object.values(omraden.tp).filter(Boolean),
    { namn: 'Hela riket', summerad: true });

  // Hur många valdistrikt varje område består av, och hur många av dem som
  // saknar jämförbara 2022-siffror. Det förklarar varför ett områdes egen
  // siffra kan skilja sig från summan av dess distrikt.
  for (const [urval, mål] of [[(d) => d.km, omraden.km], [(d) => d.tp, omraden.tp]]) {
    for (const o of Object.values(mål)) if (o) { o.ad = 0; o.uj = 0; }
    for (const d of rader) {
      const o = mål[urval(d)];
      if (!o) continue;
      o.ad += 1;
      if (!d.j) o.uj += 1;
    }
  }
  omraden.riket.ad = rader.length;
  omraden.riket.uj = rader.filter((d) => !d.j).length;

  // Partiordningen: störst i landet först. Den styr hur partilistan visas.
  for (const [kod, n] of Object.entries(omraden.riket.r)) {
    if (partier.has(kod)) partier.get(kod).roster = n;
  }
  const partilista = [...partier.values()].sort((a, b) =>
    (a.kod === OVRIGA) - (b.kod === OVRIGA) || b.roster - a.roster);

  const ettDistrikt = distriktSvar.find(([, r]) => r)?.[1];
  const meta = {
    kalla: 'Valmyndigheten (resultat.val.se)',
    hamtat: new Date().toISOString(),
    valtillfalle: VALTILLFALLE,
    valtyp: valtyp.kod,
    valtypNamn: valtyp.namn,
    valtypKort: valtyp.kort,
    toppNivan: valtyp.topp,
    toppNamn: valtyp.toppNamn,
    toppNamnFler: valtyp.toppNamnFler,
    valdatum: ettDistrikt?.valdatum ?? null,
    tidigareValdatum: ettDistrikt?.tidigareValdatum ?? null,
    rakningstillfalle: RAKNING === 'S' ? 'slutlig' : 'preliminär',
    senasteUppdateringstid: ettDistrikt?.senasteUppdateringstid ?? null,
    antalValdistriktRaknade: rader.filter((d) => d.c).length,
    antalValdistriktSomSkaRaknas: rader.length,
    distriktOjamforbara: rader.filter((d) => !d.j).length,
    partier: partilista,
    toppnivan: toppnivå.map((t) => ({ kod: t.kod, namn: t.namn })),
    kommuner: kommunkoder.map((k) => ({
      kod: k, namn: kommunNamn.get(k) || k, tp: toppPerKommun.get(k) ?? null,
    })),
  };

  const mapp = path.join(UTMAPP, valtyp.kod);
  await mkdir(mapp, { recursive: true });
  await writeFile(path.join(mapp, 'meta.json'), JSON.stringify(meta));
  await writeFile(path.join(mapp, 'omraden.json'), JSON.stringify(omraden));
  await writeFile(path.join(mapp, 'valdistrikt.json'), JSON.stringify(rader));

  process.stderr.write(
    `${valtyp.kod} klart: ${rader.length} distrikt (${meta.antalValdistriktRaknade} räknade, ` +
    `${meta.distriktOjamforbara} utan jämförbart 2022), ${partilista.length} partier.\n`);
  return { valtyp, meta };
}

// --- Alla val ---------------------------------------------------------------

const byggda = [];
for (const valtyp of KÖRS) byggda.push(await byggVal(valtyp));

// En liten indexfil så att kartan vet vilka val som finns utan att gissa.
if (!VALDA.length) {
  await writeFile(path.join(UTMAPP, 'val.json'), JSON.stringify({
    hamtat: new Date().toISOString(),
    valtillfalle: VALTILLFALLE,
    val: byggda.map(({ valtyp, meta }) => ({
      kod: valtyp.kod,
      namn: valtyp.namn,
      kort: valtyp.kort,
      toppNivan: valtyp.topp,
      toppNamn: valtyp.toppNamn,
      toppNamnFler: valtyp.toppNamnFler,
      valdatum: meta.valdatum,
      tidigareValdatum: meta.tidigareValdatum,
      rakningstillfalle: meta.rakningstillfalle,
      antalValdistriktRaknade: meta.antalValdistriktRaknade,
      antalValdistriktSomSkaRaknas: meta.antalValdistriktSomSkaRaknas,
    })),
  }));
}
