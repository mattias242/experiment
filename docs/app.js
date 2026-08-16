// Din ledamot – så röstar riksdagsledamöterna från din valkrets.
// All data hämtas direkt från riksdagens öppna data (data.riksdagen.se) i
// besökarens webbläsare. Ingen server, ingen spårning.
'use strict';

const API = 'https://data.riksdagen.se';
const DEMO = new URLSearchParams(location.search).has('demo');
const DIAGNOS = new URLSearchParams(location.search).has('diagnos');
const DEMOSUFFIX = DEMO ? '?demo=1' : '';

// Fylls i när ledamotslistan hämtas, så att ?diagnos=1 kan visa vad API:et
// faktiskt svarade och varför filtret gjorde som det gjorde.
const diagnostik = { forsok: [], vald: null, orimligt: null };

// Utskottskod (prefixet i beteckningen, t.ex. "AU" i "AU4") → begripligt ämne.
const UTSKOTT = {
  AU:   { namn: 'arbetsmarknadsutskottet', amne: 'Jobb & arbetsmarknad' },
  CU:   { namn: 'civilutskottet', amne: 'Bostäder, familj & konsument' },
  FIU:  { namn: 'finansutskottet', amne: 'Ekonomi & statens budget' },
  FÖU:  { namn: 'försvarsutskottet', amne: 'Försvar & krisberedskap' },
  JUU:  { namn: 'justitieutskottet', amne: 'Lag & ordning' },
  KU:   { namn: 'konstitutionsutskottet', amne: 'Demokrati & grundlagar' },
  KRU:  { namn: 'kulturutskottet', amne: 'Kultur, idrott & föreningsliv' },
  MJU:  { namn: 'miljö- och jordbruksutskottet', amne: 'Miljö, klimat & jordbruk' },
  NU:   { namn: 'näringsutskottet', amne: 'Företagande & energi' },
  SKU:  { namn: 'skatteutskottet', amne: 'Skatter' },
  SFU:  { namn: 'socialförsäkringsutskottet', amne: 'Socialförsäkringar & migration' },
  SOU:  { namn: 'socialutskottet', amne: 'Vård & omsorg' },
  TU:   { namn: 'trafikutskottet', amne: 'Vägar, tåg & it' },
  UBU:  { namn: 'utbildningsutskottet', amne: 'Skola & utbildning' },
  UU:   { namn: 'utrikesutskottet', amne: 'Utrikespolitik & bistånd' },
  UFÖU: { namn: 'sammansatta utrikes- och försvarsutskottet', amne: 'Utrikes & försvar' },
};

// Partier i storleksordning (valet 2022) med vedertagna profilfärger.
// Färgen bär aldrig informationen ensam – partibokstaven står alltid i pricken.
const PARTIER = {
  S:  { namn: 'Socialdemokraterna', farg: '#E8112d', ljusText: true },
  SD: { namn: 'Sverigedemokraterna', farg: '#DDDD00', ljusText: false },
  M:  { namn: 'Moderaterna', farg: '#52BDEC', ljusText: false },
  V:  { namn: 'Vänsterpartiet', farg: '#AF1615', ljusText: true },
  C:  { namn: 'Centerpartiet', farg: '#009933', ljusText: true },
  KD: { namn: 'Kristdemokraterna', farg: '#2B2E83', ljusText: true },
  MP: { namn: 'Miljöpartiet', farg: '#83CF39', ljusText: false },
  L:  { namn: 'Liberalerna', farg: '#006AB3', ljusText: true },
};
const PARTIORDNING = Object.keys(PARTIER);

// Röstalternativ. Färgerna är kontrollerade för färgseende (CVD) och
// kombineras alltid med ikon + text.
const ROST = {
  'Ja':          { text: 'Ja', ikon: '✓', farg: '#0e7a4e' },
  'Nej':         { text: 'Nej', ikon: '✕', farg: '#c9366b' },
  'Avstår':      { text: 'Avstod', ikon: '–', farg: '#b77800' },
  'Frånvarande': { text: 'Frånvarande', ikon: '○', farg: '#667085' },
};
const ROSTORDNING = ['Ja', 'Nej', 'Avstår', 'Frånvarande'];

// ---------------------------------------------------------------- hjälpare

const $app = document.getElementById('app');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// API:et returnerar ett objekt i stället för en lista när träffen är enda.
const somLista = (x) => Array.isArray(x) ? x : (x == null ? [] : [x]);

function utskottFor(beteckning) {
  const prefix = String(beteckning || '').match(/^[A-Za-zÅÄÖåäö]+/);
  if (!prefix) return null;
  return UTSKOTT[prefix[0].toUpperCase()] || null;
}

function amneFor(beteckning) {
  const u = utskottFor(beteckning);
  return u ? u.amne : 'Övrigt';
}

function normaliseraRost(r) {
  const s = String(r || '').trim().toLowerCase();
  if (s === 'ja') return 'Ja';
  if (s === 'nej') return 'Nej';
  if (s.startsWith('avst')) return 'Avstår';
  return 'Frånvarande';
}

// Riksmötet börjar i mitten av september.
function aktuelltRiksmote(d = new Date()) {
  const start = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}
function riksmoten(antal = 4) {
  const [forsta] = aktuelltRiksmote().split('/');
  const lista = [];
  for (let i = 0; i < antal; i++) {
    const y = Number(forsta) - i;
    lista.push(`${y}/${String((y + 1) % 100).padStart(2, '0')}`);
  }
  return lista;
}

function datumText(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ------------------------------------------------------------- datalager

// Höj versionen när cachad data kan vara felaktig – gamla nycklar blir då
// oanvändbara i stället för att ligga kvar hos återvändande besökare.
// dl2: ledamotslistan filtrerades tidigare på ett sätt som släppte igenom
// avgångna ledamöter.
const CACHE_VERSION = 'dl2:';

const minne = new Map();

// Rensa bort data från tidigare cacheversioner.
try {
  for (const nyckel of Object.keys(localStorage)) {
    if (/^dl\d+:/.test(nyckel) && !nyckel.startsWith(CACHE_VERSION)) {
      localStorage.removeItem(nyckel);
    }
  }
} catch { /* lagring avstängd – strunt i det */ }

function cacheLas(nyckel, maxAlderMs) {
  if (minne.has(nyckel)) return minne.get(nyckel);
  try {
    const rad = localStorage.getItem(CACHE_VERSION + nyckel);
    if (!rad) return null;
    const { t, v } = JSON.parse(rad);
    if (Date.now() - t > maxAlderMs) return null;
    minne.set(nyckel, v);
    return v;
  } catch { return null; }
}

function cacheSkriv(nyckel, varde) {
  minne.set(nyckel, varde);
  try {
    localStorage.setItem(CACHE_VERSION + nyckel, JSON.stringify({ t: Date.now(), v: varde }));
  } catch { /* full eller avstängd lagring – strunt i det */ }
}

async function hamtaJson(url) {
  const svar = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!svar.ok) throw new Error(`Riksdagens API svarade ${svar.status} för ${url}`);
  return svar.json();
}

const TIMME = 3600e3, DYGN = 24 * TIMME;

// Riksdagens personlista kan frågas på flera sätt och vi vill inte hänga upp
// oss på ett enda statusvärde: "samtida" betyder t.ex. vår tids ledamöter –
// inklusive avgångna. Vi provar de snävaste frågorna först och låter
// Ledamotsfilter avgöra vem som faktiskt sitter i riksdagen i dag, utifrån
// ledamöternas kammaruppdrag. Ger en fråga ett orimligt antal går vi vidare.
const PERSONLISTOR = [
  '/personlista/?utformat=json&rdlstatus=tjanstgorande',
  '/personlista/?utformat=json&rdlstatus=tjanst',
  '/personlista/?utformat=json&rdlstatus=samtliga',
  '/personlista/?utformat=json',
];

async function hamtaLedamoter() {
  if (DEMO) return DEMO_DATA.personer;
  const nyckel = 'ledamoter';
  const cachad = cacheLas(nyckel, DYGN);
  if (cachad) return cachad;

  let bastaTraff = null, sistaFel = null;
  diagnostik.forsok = [];
  for (const stig of PERSONLISTOR) {
    try {
      const json = await hamtaJson(API + stig);
      const ipersonlistan = Ledamotsfilter.somLista(json?.personlista?.person);
      const personer = Ledamotsfilter.tjanstgorandeLedamoter(json);
      diagnostik.forsok.push({
        stig,
        isvaret: ipersonlistan.length,
        tjanstgorande: personer.length,
        harUppdragsdata: ipersonlistan.some((p) =>
          Ledamotsfilter.somLista(p?.personuppdrag?.uppdrag).length > 0),
      });
      if (Ledamotsfilter.rimligtAntal(personer.length)) {
        diagnostik.vald = stig;
        cacheSkriv(nyckel, personer);
        return personer;
      }
      // Ingen fråga har gett ett rimligt antal än. Behåll den som ligger
      // närmast riksdagens 349 mandat – inte den största, för en för lång
      // lista är just symtomet på att avgångna följt med.
      const avstand = Math.abs(personer.length - Ledamotsfilter.MANDAT);
      if (personer.length && (!bastaTraff || avstand < bastaTraff.avstand)) {
        bastaTraff = { personer, stig, avstand };
      }
      console.warn(`${stig} gav ${personer.length} tjänstgörande ledamöter ` +
        `(förväntat ~${Ledamotsfilter.MANDAT}) – provar nästa fråga.`);
    } catch (fel) {
      sistaFel = fel;
      diagnostik.forsok.push({ stig, fel: fel.message });
    }
  }
  if (bastaTraff) {
    // Visa datan, men dölj inte att den ser fel ut.
    diagnostik.vald = bastaTraff.stig;
    diagnostik.orimligt = bastaTraff.personer.length;
    return bastaTraff.personer;
  }
  throw sistaFel || new Error('Kunde inte hämta listan över riksdagsledamöter.');
}

async function hamtaRoster(iid, rm) {
  if (DEMO) return DEMO_DATA.roster[iid] || [];
  const nyckel = `roster:${iid}:${rm}`;
  const cachad = cacheLas(nyckel, 6 * TIMME);
  if (cachad) return cachad;
  const url = `${API}/voteringlista/?iid=${encodeURIComponent(iid)}` +
    `&rm=${encodeURIComponent(rm)}&sz=10000&utformat=json`;
  const json = await hamtaJson(url);
  const rader = somLista(json?.voteringlista?.votering).map((r) => ({
    votering_id: r.votering_id,
    rm: r.rm,
    beteckning: r.beteckning,
    punkt: r.punkt,
    rost: normaliseraRost(r.rost),
    avser: (r.avser || 'sakfrågan').toLowerCase(),
    datum: r.datum || String(r.systemdatum || '').slice(0, 10),
  })).filter((r) => r.votering_id);
  rader.sort((a, b) => (b.datum || '').localeCompare(a.datum || '') ||
    String(a.beteckning).localeCompare(String(b.beteckning), 'sv') ||
    Number(a.punkt) - Number(b.punkt));
  cacheSkriv(nyckel, rader);
  return rader;
}

// Betänkandenas titlar ("AU4" → "Arbetsrätt"), per riksmöte.
async function hamtaBetTitlar(rm) {
  if (DEMO) return DEMO_DATA.betTitlar;
  const nyckel = `bet:${rm}`;
  const cachad = cacheLas(nyckel, 7 * DYGN);
  if (cachad) return cachad;
  const titlar = {};
  try {
    for (let sida = 1; sida <= 6; sida++) {
      const url = `${API}/dokumentlista/?doktyp=bet&rm=${encodeURIComponent(rm)}` +
        `&sz=500&utformat=json&p=${sida}`;
      const json = await hamtaJson(url);
      const dok = somLista(json?.dokumentlista?.dokument);
      for (const d of dok) {
        const bet = d.beteckning || (d.dok_id || '').replace(/^[A-Z0-9]{4}/i, '');
        if (bet) {
          titlar[String(bet).toUpperCase()] = {
            titel: d.titel || '',
            dok_id: d.dok_id || d.id || '',
          };
        }
      }
      const sidor = Number(json?.dokumentlista?.['@sidor'] || 1);
      if (sida >= sidor || dok.length === 0) break;
    }
  } catch { /* titlar är trevligt men inte nödvändigt */ }
  cacheSkriv(nyckel, titlar);
  return titlar;
}

// Hela voteringen (alla 349 röster) → kompakt sammanställning per parti.
async function hamtaVoteringDetalj(voteringId) {
  if (DEMO) return DEMO_DATA.detaljer[voteringId] || null;
  const nyckel = `detalj:${voteringId}`;
  const cachad = cacheLas(nyckel, 30 * DYGN);
  if (cachad) return cachad;
  const json = await hamtaJson(`${API}/votering/${encodeURIComponent(voteringId)}/json`);
  const rot = json?.votering || json;
  const rader = somLista(rot?.dokvotering?.votering);
  const perParti = {};
  for (const rad of rader) {
    const parti = String(rad.parti || '-').toUpperCase();
    const rost = normaliseraRost(rad.rost);
    perParti[parti] ??= { Ja: 0, Nej: 0, 'Avstår': 0, 'Frånvarande': 0 };
    perParti[parti][rost]++;
  }
  const dok = rot?.dokument || {};
  const detalj = {
    perParti,
    dok_id: dok.dok_id || '',
    titel: dok.titel || '',
    organ: dok.organ || '',
  };
  if (Object.keys(perParti).length) cacheSkriv(nyckel, detalj);
  return detalj;
}

// Utskottets rubrik och förslag för varje beslutspunkt i ett betänkande.
async function hamtaPunktRubriker(dokId) {
  if (DEMO) return DEMO_DATA.punktRubriker[dokId] || {};
  if (!dokId) return {};
  const nyckel = `punkter:${dokId}`;
  const cachad = cacheLas(nyckel, 30 * DYGN);
  if (cachad) return cachad;
  const punkter = {};
  try {
    const json = await hamtaJson(`${API}/dokumentstatus/${encodeURIComponent(dokId)}.json`);
    const forslag = somLista(json?.dokumentstatus?.dokutskottsforslag?.utskottsforslag);
    for (const f of forslag) {
      if (f?.punkt != null) {
        punkter[String(f.punkt)] = {
          rubrik: f.rubrik || '',
          beslut: f.beslut || '',
        };
      }
    }
  } catch { /* fördjupningen är valfri */ }
  cacheSkriv(nyckel, punkter);
  return punkter;
}

// ------------------------------------------------------------------ vyer

function satteTitel(t) {
  document.title = t ? `${t} – Din ledamot` : 'Din ledamot – så röstar riksdagen, förklarat';
}

function visaLaddar(text) {
  $app.innerHTML = `<div class="laddar">${esc(text)}</div>`;
}

function visaFel(fel, forsokIgen) {
  console.error(fel);
  $app.innerHTML = `
    <div class="fel">
      <p><strong>Hoppsan – det gick inte att hämta data från riksdagen.</strong></p>
      <p>${esc(fel?.message || fel)}</p>
      <p>Riksdagens öppna data kan vara tillfälligt otillgängligt. Prova igen om en stund.</p>
      ${forsokIgen ? '<p><button class="visa-fler" id="igen">Försök igen</button></p>' : ''}
    </div>`;
  document.getElementById('igen')?.addEventListener('click', forsokIgen);
}

function partiprickHtml(parti) {
  const p = PARTIER[parti];
  const bg = p ? p.farg : '#9aa4af';
  const fg = p && p.ljusText ? '#fff' : '#1c2733';
  const titel = p ? p.namn : 'Utan partibeteckning';
  return `<span class="partiprick" style="background:${bg};color:${fg}" title="${esc(titel)}">${esc(parti || '–')}</span>`;
}

function portrattHtml(person, klass = '') {
  if (person.bild) {
    return `<img ${klass ? `class="${klass}"` : ''} src="${esc(person.bild)}" alt="" loading="lazy"
      onerror="this.outerHTML='<span class=&quot;portratt-fallback&quot;>${esc(person.fornamn.charAt(0))}${esc(person.efternamn.charAt(0))}</span>'">`;
  }
  return `<span class="portratt-fallback">${esc(person.fornamn.charAt(0))}${esc(person.efternamn.charAt(0))}</span>`;
}

function rostpillHtml(rost) {
  const r = ROST[rost] || ROST['Frånvarande'];
  return `<span class="rostpill rost-${esc(rost)}"><span aria-hidden="true">${r.ikon}</span>${r.text}</span>`;
}

// --------------------------------------------------------------- startsida

function vyStart() {
  satteTitel('');
  const valkretsVal = VALKRETSAR
    .map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)
    .join('');
  $app.innerHTML = `
    <section class="hero">
      <h1>Vet du hur dina riksdags&shy;ledamöter röstar?</h1>
      <p>Riksdagen fattar hundratals beslut varje år i ditt namn.
      Här ser du hur ledamöterna från just din valkrets röstade – förklarat på vanlig svenska.</p>
    </section>

    <div class="sok-kort">
      <label for="kommunsok">Var bor du?</label>
      <div class="sok-falt">
        <input id="kommunsok" type="text" autocomplete="off" spellcheck="false"
          placeholder="Skriv din kommun, t.ex. Mölndal eller Luleå …"
          aria-label="Sök kommun" aria-expanded="false" role="combobox" aria-controls="forslag">
        <ul class="forslag" id="forslag" role="listbox" hidden></ul>
      </div>
      <div class="eller">eller välj valkrets direkt</div>
      <select id="valkretsval" aria-label="Välj valkrets">
        <option value="">Välj valkrets …</option>
        ${valkretsVal}
      </select>
    </div>

    <section class="info-sektion" id="om">
      <h2>Så funkar det</h2>
      <div class="info-kort">
        <article>
          <h3>🗳️ Vad är en votering?</h3>
          <p>När riksdagens 349 ledamöter inte är överens avgörs frågan genom
          omröstning – en votering. Varje ledamot trycker Ja, Nej eller Avstår,
          och varje röst registreras öppet.</p>
        </article>
        <article>
          <h3>📄 Vad röstar de om?</h3>
          <p>De flesta voteringar gäller förslag från riksdagens utskott, samlade
          i så kallade betänkanden. Ett betänkande kan innehålla många
          beslutspunkter – och varje punkt kan bli en egen votering.</p>
        </article>
        <article>
          <h3>🧭 Sakfråga och motivering</h3>
          <p>Ibland röstar riksdagen både om själva beslutet (sakfrågan) och om
          hur beslutet ska motiveras (motivfrågan). Vi märker ut vilket som är
          vilket, så att du inte behöver gissa.</p>
        </article>
        <article>
          <h3>🔓 Öppna data</h3>
          <p>Allt du ser hämtas direkt från riksdagens öppna data
          (data.riksdagen.se) – samma källa som forskare och journalister
          använder. Inget filtreras eller vinklas på vägen.</p>
        </article>
      </div>
    </section>`;

  const $sok = document.getElementById('kommunsok');
  const $forslag = document.getElementById('forslag');

  const uppdateraForslag = () => {
    const q = $sok.value.trim().toLowerCase();
    if (q.length < 2) { $forslag.hidden = true; $sok.setAttribute('aria-expanded', 'false'); return; }
    const traffar = [];
    for (const [kommun, valkrets] of Object.entries(KOMMUN_TILL_VALKRETS)) {
      if (kommun.toLowerCase().startsWith(q)) traffar.push({ kommun, valkrets });
    }
    for (const v of VALKRETSAR) {
      if (v.toLowerCase().includes(q)) traffar.push({ kommun: null, valkrets: v });
    }
    if (!traffar.length) { $forslag.hidden = true; $sok.setAttribute('aria-expanded', 'false'); return; }
    $forslag.innerHTML = traffar.slice(0, 8).map(({ kommun, valkrets }) => `
      <li role="option"><button data-valkrets="${esc(valkrets)}">
        <span>${esc(kommun || valkrets)}</span>
        <span class="fs-valkrets">${kommun ? esc(valkrets) : 'valkrets'}</span>
      </button></li>`).join('');
    $forslag.hidden = false;
    $sok.setAttribute('aria-expanded', 'true');
  };

  $sok.addEventListener('input', uppdateraForslag);
  $sok.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $forslag.querySelector('button')?.click();
    if (e.key === 'Escape') { $forslag.hidden = true; }
  });
  $forslag.addEventListener('click', (e) => {
    const knapp = e.target.closest('button[data-valkrets]');
    if (knapp) gaTill(`#valkrets/${encodeURIComponent(knapp.dataset.valkrets)}`);
  });
  document.getElementById('valkretsval').addEventListener('change', (e) => {
    if (e.target.value) gaTill(`#valkrets/${encodeURIComponent(e.target.value)}`);
  });
}

// -------------------------------------------------------------- valkretsvy

async function vyValkrets(valkrets) {
  satteTitel(valkrets);
  visaLaddar('Hämtar ledamöter från riksdagen …');
  let personer;
  try {
    personer = await hamtaLedamoter();
  } catch (fel) {
    return visaFel(fel, () => vyValkrets(valkrets));
  }
  if (DIAGNOS) return vyDiagnos(personer, valkrets);
  const egna = personer
    .filter((p) => p.valkrets === valkrets)
    .sort((a, b) => PARTIORDNING.indexOf(a.parti) - PARTIORDNING.indexOf(b.parti) ||
      a.efternamn.localeCompare(b.efternamn, 'sv'));

  $app.innerHTML = `
    <nav class="smula"><a href="#">Start</a> › ${esc(valkrets)}</nav>
    ${diagnostik.orimligt ? `<div class="fel" style="text-align:left">
      <p><strong>Obs: listan kan innehålla personer som inte längre sitter i riksdagen.</strong></p>
      <p>Riksdagens API gav ${diagnostik.orimligt} tjänstgörande ledamöter i stället för
      ${Ledamotsfilter.MANDAT}. <a href="?diagnos=1${esc(location.hash)}">Visa diagnos</a></p>
    </div>` : ''}
    <div class="vy-rubrik">
      <h1>${esc(valkrets)}</h1>
      <p class="under">${egna.length ? `${egna.length} ledamöter representerar din valkrets i riksdagen just nu.
        Välj en för att se hur hen har röstat.` :
        'Hittade inga tjänstgörande ledamöter för den här valkretsen – kontrollera stavningen eller prova en annan.'}</p>
    </div>
    <div class="ledamot-lista">
      ${egna.map((p) => `
        <a class="ledamot-kort" href="#ledamot/${esc(p.id)}">
          ${portrattHtml(p)}
          <span>
            <span class="namn">${esc(p.fornamn)} ${esc(p.efternamn)}</span>
            <span class="meta">${partiprickHtml(p.parti)} ${esc(PARTIER[p.parti]?.namn || '')}</span>
          </span>
        </a>`).join('')}
    </div>`;
}

// ----------------------------------------------------------------- diagnos

// Visar vad riksdagens API svarade och vad filtret gjorde med svaret. Finns
// för att kunna felsöka utifrån, utan tillgång till API:et.
function vyDiagnos(personer, valkrets) {
  satteTitel('Diagnos');
  const egna = personer.filter((p) => p.valkrets === valkrets);
  const antalPerValkrets = new Map();
  for (const p of personer) {
    antalPerValkrets.set(p.valkrets, (antalPerValkrets.get(p.valkrets) || 0) + 1);
  }

  $app.innerHTML = `
    <nav class="smula"><a href="#">Start</a> › Diagnos</nav>
    <div class="vy-rubrik">
      <h1>Diagnos</h1>
      <p class="under">Vad riksdagens API svarade och vad filtret gjorde med svaret.</p>
    </div>

    <div class="profil" style="display:block">
      <p><strong>${personer.length}</strong> personer räknas som tjänstgörande ledamöter.
      Riksdagen har ${Ledamotsfilter.MANDAT} mandat.
      ${Ledamotsfilter.rimligtAntal(personer.length)
        ? '<span style="color:var(--ja)">✓ rimligt</span>'
        : '<span style="color:var(--nej)">✗ orimligt – avgångna följer troligen med</span>'}</p>
      <p>Vald fråga: <code>${esc(diagnostik.vald || '–')}</code></p>
      <p>Valkretsar i datan: ${antalPerValkrets.size} (förväntat 29)</p>
    </div>

    <h2 style="font-size:1.1rem;margin-top:1.5rem">Frågor som provades</h2>
    <div class="voteringar">
      ${diagnostik.forsok.map((f) => `
        <article class="votering"><div style="padding:.8rem 1rem">
          <div style="font-family:monospace;font-size:.82rem">${esc(f.stig)}</div>
          <div class="votering-meta">${f.fel
            ? `<span style="color:var(--nej)">fel: ${esc(f.fel)}</span>`
            : `${f.isvaret} personer i svaret →
               <strong>${f.tjanstgorande}</strong> tjänstgörande ·
               uppdragsdata i svaret: ${f.harUppdragsdata ? 'ja' : 'NEJ (filtret använde statustexten)'}`}
          </div>
        </div></article>`).join('')}
    </div>

    <h2 style="font-size:1.1rem;margin-top:1.5rem">${esc(valkrets)}: ${egna.length} ledamöter</h2>
    <div class="voteringar">
      ${egna.map((p) => `
        <article class="votering"><div style="padding:.6rem 1rem">
          <strong>${esc(p.fornamn)} ${esc(p.efternamn)}</strong> (${esc(p.parti || '–')})
          <div class="votering-meta">status i API:t:
            <code>${esc(p.status || '(blank)')}</code></div>
        </div></article>`).join('')}
    </div>

    <p class="detalj-lankar">Ser du någon här som inte sitter i riksdagen?
    Statusraden ovan visar vad API:et påstår om personen – den uppgiften
    behövs för att rätta filtret.</p>`;
}

// -------------------------------------------------------------- ledamotsvy

const vyTillstand = { rm: null, amne: null, visaAntal: 25 };

async function vyLedamot(iid) {
  visaLaddar('Hämtar ledamotens voteringar …');
  let personer;
  try {
    personer = await hamtaLedamoter();
  } catch (fel) {
    return visaFel(fel, () => vyLedamot(iid));
  }
  const person = personer.find((p) => p.id === iid);
  if (!person) {
    $app.innerHTML = `<div class="tomt">Hittade ingen tjänstgörande ledamot med det id:t.
      <p><a href="#">Till startsidan</a></p></div>`;
    return;
  }
  satteTitel(`${person.fornamn} ${person.efternamn}`);

  const rm = vyTillstand.rm || aktuelltRiksmote();
  let roster, betTitlar;
  try {
    [roster, betTitlar] = await Promise.all([
      hamtaRoster(iid, rm),
      hamtaBetTitlar(rm),
    ]);
  } catch (fel) {
    return visaFel(fel, () => vyLedamot(iid));
  }

  const narvarande = roster.filter((r) => r.rost !== 'Frånvarande').length;
  const narvaro = roster.length ? Math.round(100 * narvarande / roster.length) : null;

  const amnen = [...new Set(roster.map((r) => amneFor(r.beteckning)))]
    .sort((a, b) => a.localeCompare(b, 'sv'));
  const valtAmne = amnen.includes(vyTillstand.amne) ? vyTillstand.amne : null;
  const filtrerade = valtAmne ? roster.filter((r) => amneFor(r.beteckning) === valtAmne) : roster;
  const synliga = filtrerade.slice(0, vyTillstand.visaAntal);

  $app.innerHTML = `
    <nav class="smula">
      <a href="#">Start</a> ›
      <a href="#valkrets/${encodeURIComponent(person.valkrets)}">${esc(person.valkrets)}</a> ›
      ${esc(person.fornamn)} ${esc(person.efternamn)}
    </nav>

    <div class="profil">
      ${portrattHtml(person)}
      <div>
        <h1>${esc(person.fornamn)} ${esc(person.efternamn)}</h1>
        <div class="meta">${partiprickHtml(person.parti)}
          ${esc(PARTIER[person.parti]?.namn || '')} · ${esc(person.valkrets)}</div>
      </div>
      <div class="statrad">
        <div class="stat"><div class="tal">${roster.length}</div><div class="rubrik">voteringar ${esc(rm)}</div></div>
        <div class="stat"><div class="tal">${narvaro == null ? '–' : narvaro + ' %'}</div><div class="rubrik">närvaro</div></div>
      </div>
    </div>

    <div class="filterrad" role="group" aria-label="Filtrera på ämne">
      <button class="chip" data-amne="" aria-pressed="${valtAmne ? 'false' : 'true'}">Alla ämnen</button>
      ${amnen.map((a) => `<button class="chip" data-amne="${esc(a)}"
        aria-pressed="${a === valtAmne ? 'true' : 'false'}">${esc(a)}</button>`).join('')}
      <select class="rm-valj" id="rmval" aria-label="Välj riksmöte">
        ${riksmoten().map((r) => `<option value="${esc(r)}" ${r === rm ? 'selected' : ''}>Riksmötet ${esc(r)}</option>`).join('')}
      </select>
    </div>

    ${roster.length === 0 ? `<div class="tomt">Inga voteringar registrerade för
      ${esc(person.fornamn)} under riksmötet ${esc(rm)}. Prova ett tidigare riksmöte i väljaren ovan.</div>` : ''}

    <div class="voteringar" id="voteringar">
      ${synliga.map((r, i) => voteringsradHtml(r, i, betTitlar)).join('')}
    </div>
    ${filtrerade.length > synliga.length ? `
      <button class="visa-fler" id="visafler">Visa fler
        (${synliga.length} av ${filtrerade.length})</button>` : ''}`;

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      vyTillstand.amne = chip.dataset.amne || null;
      vyTillstand.visaAntal = 25;
      vyLedamot(iid);
    });
  });
  document.getElementById('rmval').addEventListener('change', (e) => {
    vyTillstand.rm = e.target.value;
    vyTillstand.visaAntal = 25;
    vyLedamot(iid);
  });
  document.getElementById('visafler')?.addEventListener('click', () => {
    vyTillstand.visaAntal += 50;
    vyLedamot(iid);
  });

  document.getElementById('voteringar').addEventListener('click', (e) => {
    const huvud = e.target.closest('.votering-huvud');
    if (!huvud) return;
    const kort = huvud.closest('.votering');
    const index = Number(kort.dataset.index);
    vaxlaDetalj(kort, synliga[index], person, betTitlar);
  });
}

function voteringsradHtml(r, index, betTitlar) {
  const bet = String(r.beteckning || '').toUpperCase();
  const info = betTitlar[bet];
  const titel = info?.titel || `Betänkande ${r.beteckning}`;
  const motiv = r.avser && r.avser !== 'sakfrågan';
  return `
    <article class="votering" data-index="${index}" data-oppen="false">
      <button class="votering-huvud" aria-expanded="false">
        <div class="votering-info">
          <div class="votering-titel">${esc(titel)}</div>
          <div class="votering-meta">
            <span class="amne-badge">${esc(amneFor(r.beteckning))}</span>
            ${motiv ? '<span class="motiv-badge" title="Omröstningen gällde motiveringen, inte själva beslutet">motivfråga</span>' : ''}
            <span>${esc(datumText(r.datum))}</span>
            <span>${esc(r.rm)}:${esc(r.beteckning)} · punkt ${esc(r.punkt)}</span>
          </div>
        </div>
        ${rostpillHtml(r.rost)}
        <svg class="pil" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <div class="votering-detalj" hidden></div>
    </article>`;
}

// ------------------------------------------------- detaljvy för en votering

async function vaxlaDetalj(kort, rost, person, betTitlar) {
  const $detalj = kort.querySelector('.votering-detalj');
  const $huvud = kort.querySelector('.votering-huvud');
  const oppen = kort.dataset.oppen === 'true';
  kort.dataset.oppen = String(!oppen);
  $huvud.setAttribute('aria-expanded', String(!oppen));
  $detalj.hidden = oppen;
  if (oppen || $detalj.dataset.laddad) return;

  $detalj.innerHTML = '<div class="laddar">Hämtar hela omröstningen …</div>';
  let detalj = null, punkter = {};
  try {
    detalj = await hamtaVoteringDetalj(rost.votering_id);
    const bet = String(rost.beteckning || '').toUpperCase();
    const dokId = detalj?.dok_id || betTitlar[bet]?.dok_id || '';
    punkter = await hamtaPunktRubriker(dokId);
  } catch (fel) {
    console.error(fel);
  }
  $detalj.dataset.laddad = '1';
  $detalj.innerHTML = detaljHtml(rost, person, detalj, punkter, betTitlar);
}

function detaljHtml(rost, person, detalj, punkter, betTitlar) {
  const u = utskottFor(rost.beteckning);
  const bet = String(rost.beteckning || '').toUpperCase();
  const titel = detalj?.titel || betTitlar[bet]?.titel || '';
  const punktInfo = punkter[String(rost.punkt)];
  const r = ROST[rost.rost];

  // Begriplig brödtext.
  const delar = [];
  delar.push(`Riksdagen tog ställning till punkt ${esc(rost.punkt)} i
    ${u ? esc(u.namn + 's') : 'ett utskotts'} förslag
    <em>${titel ? esc(titel) : esc(rost.rm + ':' + rost.beteckning)}</em>.`);
  if (rost.avser === 'sakfrågan' || !rost.avser) {
    delar.push('Omröstningen gällde själva sakfrågan – alltså det faktiska beslutet.');
  } else {
    delar.push('Omröstningen gällde <strong>motiveringen</strong> – ' +
      'formuleringarna bakom beslutet – inte själva sakbeslutet.');
  }
  delar.push(`${esc(person.fornamn)} ${esc(person.efternamn)} röstade
    <strong style="color:${r.farg}">${r.ikon} ${r.text.toLowerCase()}</strong>.`);

  // Resultat & partilinje utifrån hela kammarens röster.
  let resultatHtml = '';
  let partilinjeHtml = '';
  if (detalj && Object.keys(detalj.perParti).length) {
    const totalt = { Ja: 0, Nej: 0, 'Avstår': 0, 'Frånvarande': 0 };
    for (const p of Object.values(detalj.perParti)) {
      for (const alt of ROSTORDNING) totalt[alt] += p[alt];
    }
    const vann = totalt.Ja > totalt.Nej ? 'Ja-sidan vann.' :
      totalt.Nej > totalt.Ja ? 'Nej-sidan vann.' : 'Lika röstetal – då avgör lotten.';
    resultatHtml = `
      <h4>Så röstade hela riksdagen</h4>
      ${stapelHtml(totalt, 349)}
      <p class="stapel-text"><b>${totalt.Ja} ja</b> · ${totalt.Nej} nej ·
        ${totalt['Avstår']} avstod · ${totalt['Frånvarande']} frånvarande. ${vann}</p>
      <h4>Parti för parti</h4>
      ${partiradarHtml(detalj.perParti, person.parti)}
      <div class="teckenforklaring" aria-hidden="true">
        ${ROSTORDNING.map((alt) => `<span><span class="prov" style="background:${ROST[alt].farg}"></span>${ROST[alt].text}</span>`).join('')}
      </div>`;

    const eget = detalj.perParti[person.parti];
    if (eget && rost.rost !== 'Frånvarande') {
      const majoritet = ROSTORDNING.slice(0, 3)
        .reduce((basta, alt) => eget[alt] > eget[basta] ? alt : basta, 'Ja');
      const rostade = eget[majoritet] > 0;
      if (rostade && rost.rost === majoritet) {
        partilinjeHtml = `<span class="partilinje med">✓ Röstade som de flesta i ${esc(PARTIER[person.parti]?.namn || person.parti)}</span>`;
      } else if (rostade) {
        partilinjeHtml = `<span class="partilinje emot">⚡ Röstade annorlunda än de flesta i ${esc(PARTIER[person.parti]?.namn || person.parti)}
          (som röstade ${ROST[majoritet].text.toLowerCase()})</span>`;
      }
    } else if (rost.rost === 'Frånvarande') {
      partilinjeHtml = `<span class="partilinje neutral">Deltog inte i den här omröstningen.
        Ledamöter kvittas ofta ut vid resor eller sjukdom – frånvaro är sällan skolk.</span>`;
    }
  }

  const sokLank = `https://www.riksdagen.se/sv/sok/?q=${encodeURIComponent(rost.rm + ':' + rost.beteckning)}`;
  const dataLank = detalj?.dok_id ? `https://data.riksdagen.se/dokument/${encodeURIComponent(detalj.dok_id)}` : null;

  return `
    ${punktInfo?.rubrik ? `<p class="punktrubrik"><strong>Frågan gällde:</strong> ${esc(punktInfo.rubrik)}${punktInfo.beslut ? ` <span style="color:var(--text-mild)">(utskottets förslag: ${esc(punktInfo.beslut.toLowerCase())})</span>` : ''}</p>` : ''}
    <p class="forklaring">${delar.join(' ')}</p>
    ${partilinjeHtml}
    ${resultatHtml || '<p class="forklaring" style="color:var(--text-mild)">Kunde inte hämta hela kammarens röster just nu.</p>'}
    <p class="detalj-lankar">Läs mer:
      <a href="${sokLank}" target="_blank" rel="noopener">betänkandet på riksdagen.se</a>
      ${dataLank ? ` · <a href="${dataLank}" target="_blank" rel="noopener">dokumentet i öppna data</a>` : ''}
    </p>`;
}

function stapelHtml(antal, max) {
  const summa = ROSTORDNING.reduce((s, alt) => s + antal[alt], 0) || max || 1;
  return `<div class="resultat-stapel" role="img"
    aria-label="${ROSTORDNING.map((alt) => `${antal[alt]} ${ROST[alt].text.toLowerCase()}`).join(', ')}">
    ${ROSTORDNING.map((alt) => antal[alt] > 0 ?
      `<span style="flex:${antal[alt]} 0 0;background:${ROST[alt].farg}"></span>` : '').join('')}
  </div>`;
}

function partiradarHtml(perParti, egetParti) {
  const partier = [...PARTIORDNING.filter((p) => perParti[p]),
    ...Object.keys(perParti).filter((p) => !PARTIORDNING.includes(p)).sort()];
  return partier.map((parti) => {
    const antal = perParti[parti];
    const siffror = ROSTORDNING
      .filter((alt) => antal[alt] > 0)
      .map((alt) => `${alt === 'Ja' || alt === 'Nej' ? `<b>${antal[alt]} ${ROST[alt].text.toLowerCase()}</b>` : `${antal[alt]} ${alt === 'Avstår' ? 'avstod' : 'frånv.'}`}`)
      .join(' · ');
    return `<div class="partirad ${parti === egetParti ? 'egen-rad' : ''}">
      ${partiprickHtml(parti)}
      <div class="stapel" aria-hidden="true">
        ${ROSTORDNING.map((alt) => antal[alt] > 0 ?
          `<span style="flex:${antal[alt]} 0 0;background:${ROST[alt].farg}"></span>` : '').join('')}
      </div>
      <span class="siffror">${siffror || '–'}</span>
    </div>`;
  }).join('');
}

// ----------------------------------------------------------------- router

function gaTill(hash) {
  if (location.hash === hash) rutt();
  else location.hash = hash;
}

function rutt() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
  window.scrollTo(0, 0);
  if (hash.startsWith('valkrets/')) {
    vyTillstand.amne = null;
    vyTillstand.rm = null;
    vyTillstand.visaAntal = 25;
    vyValkrets(hash.slice('valkrets/'.length));
  } else if (hash.startsWith('ledamot/')) {
    vyLedamot(hash.slice('ledamot/'.length));
  } else {
    vyStart();
    if (hash === 'om') document.getElementById('om')?.scrollIntoView();
  }
}

window.addEventListener('hashchange', rutt);
if (DEMO) document.getElementById('demobanner').hidden = false;
rutt();
