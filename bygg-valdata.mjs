// Bygger datafilerna till förändringskartan (docs/karta.html).
//
//   node bygg-valdata.mjs                  hämtar allt och skriver docs/valdata/
//   node bygg-valdata.mjs --rakning=S      slutligt resultat i stället för preliminärt
//   node bygg-valdata.mjs --parallellt=6   snällare mot val.se
//
// Källa: Valmyndighetens valpresentation (resultat.val.se), samma filer som
// webbplatsen resultat.val.se själv läser. Varje valdistrikt hämtas som en egen
// fil eftersom det bara är på den nivån som antalet röstberättigade och flaggan
// "jämförbar" finns med – och båda behövs för att kunna väga ihop distrikten.
//
// Resultatet blir tre filer:
//   valdata/meta.json         partier, räkningsläge, namn på valkretsar/kommuner
//   valdata/valdistrikt.json  röster per parti och distrikt, 2026 och 2022
//   valdata/geografi-*.json   skrivs av bygg-valgeografi.mjs, inte här
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BAS = process.env.VAL_API || 'https://resultat.val.se';
const VALTILLFALLE = 'val2026';
const UTMAPP = path.join(import.meta.dirname, 'docs', 'valdata');

const flagga = (namn, standard) => {
  const träff = process.argv.find((a) => a.startsWith(`--${namn}=`));
  return träff ? träff.slice(namn.length + 3) : standard;
};

const RAKNING = flagga('rakning', 'P');          // P = preliminär, S = slutlig
const PARALLELLT = Number(flagga('parallellt', 10));

// --- Hämtning ---------------------------------------------------------------

async function hamta(stig, försök = 3) {
  for (let i = 1; ; i++) {
    try {
      const svar = await fetch(`${BAS}${stig}`, { headers: { Accept: 'application/json' } });
      // Uppsamlingsdistrikten – dit sena brevröster och budröster går – får sin
      // fil först när de räknats, på onsdagen efter valet. Fram till dess är de
      // 404 och ska behandlas som "inte räknat", inte som ett fel.
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

// Kör jobben några i taget så att vi inte spränger val.se med 6 000 samtidiga
// anrop. Rapporterar framsteg på stderr eftersom hämtningen tar minuter.
async function iTur(jobb, antal, etikett) {
  const svar = new Array(jobb.length);
  let nästa = 0;
  let klara = 0;
  const arbetare = Array.from({ length: antal }, async () => {
    while (nästa < jobb.length) {
      const i = nästa++;
      svar[i] = await jobb[i]();
      if (++klara % 250 === 0 || klara === jobb.length) {
        process.stderr.write(`\r${etikett}: ${klara}/${jobb.length}`);
      }
    }
  });
  await Promise.all(arbetare);
  process.stderr.write('\n');
  return svar;
}

// --- Partier ----------------------------------------------------------------

// Partiordningen i meta.json styr hur rösterna ligger i valdistrikt.json. Vi
// tar med alla partier som fått röster i riket – de allra minsta blir noll i de
// flesta distrikt, och nollor kostar nästan ingenting efter komprimering.
function partierFran(riket) {
  return riket.rosterPaverkaMandat.partiroster
    .map((p) => ({
      kod: p.partikod,
      kort: p.partiforkortning,
      namn: p.partibeteckning,
      farg: p.fargkod,
      roster: p.antalRoster,
      andel: p.andelRoster,
      andelFore: p.andelRosterForegaendeVal,
    }))
    .sort((a, b) => b.roster - a.roster);
}

// --- Huvudflöde -------------------------------------------------------------

const geografi = await hamta(`/data/valgeografi/valgeografi_${VALTILLFALLE}.json`);
const riksdag = geografi.valgeografi.find((v) => v.kod === 'RD');
if (!riksdag) throw new Error('Hittade ingen valtyp RD i valgeografin');

const riket = await resultat('RD');
const partier = partierFran(riket);
const partiIndex = new Map(partier.map((p, i) => [p.kod, i]));

const valkretsar = [];
const distriktJobb = [];
// Kommunens egen resultatfil, per kommunkod. Den behövs för att kommun- och
// valkretsnivån ska visa exakt samma siffror som val.se: summerar man i stället
// ihop valdistrikten tappar man både uppsamlingsdistrikten och alla distrikt
// vars gränser ritats om sedan 2022 (de saknar jämförelsetal helt).
const kommunStig = new Map();

// Trädet under en valtyp är olika djupt på olika håll: de flesta valkretsar har
// kommuner under sig, men i Stockholm, Göteborg och Malmö ligger valdistrikten
// direkt under valkretsen, och på några håll finns ett extra steg med
// kommunvalkretsar. Vi går därför ned tills vi hittar VALDISTRIKT, och bygger
// filnamnet av koderna på vägen ned – precis som resultat.val.se gör.
function gaNed(nod, stigKoder, vk) {
  for (const barn of nod.valgeografi ?? []) {
    const stig = [...stigKoder, barn.kod];
    if (barn.typ === 'VALDISTRIKT') {
      distriktJobb.push(async () => ({
        vd: barn,
        vk,
        r: await resultat(stig.join('_')),
      }));
    } else {
      if (barn.typ === 'KOMMUN') kommunStig.set(barn.kod, stig.join('_'));
      gaNed(barn, stig, vk);
    }
  }
}

for (const vk of riksdag.valgeografi) {
  valkretsar.push({ kod: vk.kod, namn: vk.namn });
  gaNed(vk, ['RD', vk.kod], vk);
}

// Kommunnamnen finns inte alltid i riksdagsträdet – i Stockholm, Göteborg och
// Malmö ligger valdistrikten direkt under valkretsen. Kommunvalet har däremot
// alltid steget LÄN → KOMMUN, så vi hämtar namnen därifrån.
const kommuner = [];
for (const lan of geografi.valgeografi.find((v) => v.kod === 'KF')?.valgeografi ?? []) {
  for (const km of lan.valgeografi ?? []) {
    if (km.typ === 'KOMMUN') kommuner.push({ kod: km.kod, namn: km.namn, lan: lan.kod });
  }
}

// Gotland, Malmö, Stockholm och Göteborg saknar KOMMUN-nod i riksdagsträdet:
// där sammanfaller kommunen med hela valkretsen, så valkretsens fil duger.
const KOMMUN_AR_VALKRETS = { '0980': '09', '1280': '11', '0180': '01', '1480': '16' };
for (const [kommunkod, valkretskod] of Object.entries(KOMMUN_AR_VALKRETS)) {
  if (!kommunStig.has(kommunkod)) kommunStig.set(kommunkod, `RD_${valkretskod}`);
}

process.stderr.write(`${valkretsar.length} valkretsar, ${kommuner.length} kommuner, ` +
  `${distriktJobb.length} valdistrikt\n`);

// Siffrorna kommer som "1 260" med hårt mellanslag. Tomt fält = inte räknat än.
const tal = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// Plocka ut det vi behöver ur en resultatfil, oavsett vilken nivå den gäller.
function sammandrag(r, extra = {}) {
  const nu = new Array(partier.length).fill(0);
  const fore = new Array(partier.length).fill(0);
  for (const p of r?.rosterPaverkaMandat?.partiroster ?? []) {
    const i = partiIndex.get(p.partikod);
    if (i === undefined) continue;           // parti som bara finns lokalt
    nu[i] = p.antalRoster ?? 0;
    fore[i] = p.antalRosterForegaendeVal ?? 0;
  }
  return {
    ...extra,
    rb: tal(r?.antalRostberattigade) ?? 0,             // röstberättigade 2026
    rb0: tal(r?.antalRostberattigadeForegaendeVal) ?? 0,  // …och 2022
    t: tal(r?.totaltAntalRoster) ?? 0,                 // alla röster, även blanka
    t0: tal(r?.totaltAntalRosterForegaendeVal) ?? 0,
    g: r?.rosterPaverkaMandat?.antalRoster ?? 0,       // giltiga partiröster
    g0: r?.rosterPaverkaMandat?.antalRosterForegaendeVal ?? 0,
    raknade: r?.antalValdistriktRaknade ?? 0,
    skaRaknas: r?.antalValdistriktSomSkaRaknas ?? 0,
    r: nu,
    r0: fore,
  };
}

const omradeJobb = [
  ...valkretsar.map((vk) => async () =>
    ['vk', vk.kod, sammandrag(await resultat(`RD_${vk.kod}`), { namn: vk.namn })]),
  ...kommuner.map((km) => async () =>
    ['km', km.kod, sammandrag(await resultat(kommunStig.get(km.kod)),
      { namn: km.namn, vk: null })]),
];
const omradeSvar = await iTur(omradeJobb, PARALLELLT, 'Områden');

const hämtade = await iTur(distriktJobb, PARALLELLT, 'Valdistrikt');
const distrikt = hämtade.map(({ vd, vk, r }) => {
  const { raknade, skaRaknas, ...s } = sammandrag(r, {
    k: vd.kod,
    n: vd.namn,
    km: vd.kod.slice(0, 4),   // valdistriktskoden inleds med kommunkoden
    vk: vk.kod,
  });
  return {
    ...s,
    j: r?.jamforbar ? 1 : 0,   // finns jämförbara 2022-siffror för distriktet?
    c: raknade > 0 ? 1 : 0,    // räknat än?
  };
});

const räknade = distrikt.filter((d) => d.c).length;
const ojämförbara = distrikt.filter((d) => !d.j).length;

// Områdesnivåerna: riket, de 29 valkretsarna och de 290 kommunerna, var och en
// med Valmyndighetens egna summor. Kommunerna får sin valkretskod från det
// första valdistriktet i kommunen – Stockholm och Göteborg ligger i flera
// valkretsar, och då pekar kommunen på den valkrets där den har flest distrikt.
const valkretsPerKommun = new Map();
for (const d of distrikt) {
  const räkning = valkretsPerKommun.get(d.km) ?? new Map();
  räkning.set(d.vk, (räkning.get(d.vk) ?? 0) + 1);
  valkretsPerKommun.set(d.km, räkning);
}
const störstaValkrets = (kommunkod) => {
  const räkning = valkretsPerKommun.get(kommunkod);
  if (!räkning) return null;
  return [...räkning].sort((a, b) => b[1] - a[1])[0][0];
};

const omraden = { riket: sammandrag(riket, { namn: 'Hela riket' }), vk: {}, km: {} };
for (const [nivå, kod, värde] of omradeSvar) {
  if (nivå === 'km') värde.vk = störstaValkrets(kod);
  omraden[nivå][kod] = värde;
}

const meta = {
  kalla: 'Valmyndigheten (resultat.val.se)',
  hamtat: new Date().toISOString(),
  valtillfalle: VALTILLFALLE,
  valtyp: 'RD',
  valdatum: riket.valdatum,
  tidigareValdatum: riket.tidigareValdatum,
  rakningstillfalle: riket.rakningstillfalle,
  senasteUppdateringstid: riket.senasteUppdateringstid,
  antalValdistriktRaknade: riket.antalValdistriktRaknade,
  antalValdistriktSomSkaRaknas: riket.antalValdistriktSomSkaRaknas,
  distriktMedGeometri: distrikt.length,
  distriktRaknade: räknade,
  distriktOjamforbara: ojämförbara,
  valdeltagande: riket.valdeltagande,
  valdeltagandeForegaendeVal: riket.valdeltagandeForegaendeVal,
  partier,
  valkretsar,
  kommuner,
};

await mkdir(UTMAPP, { recursive: true });
await writeFile(path.join(UTMAPP, 'meta.json'), JSON.stringify(meta));
await writeFile(path.join(UTMAPP, 'valdistrikt.json'), JSON.stringify(distrikt));
await writeFile(path.join(UTMAPP, 'omraden.json'), JSON.stringify(omraden));

process.stderr.write(
  `Klart: ${distrikt.length} distrikt (${räknade} räknade, ${ojämförbara} utan ` +
  `jämförbart 2022), ${Object.keys(omraden.km).length} kommuner, ` +
  `${Object.keys(omraden.vk).length} valkretsar, ${partier.length} partier.\n`);
