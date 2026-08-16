// Kontrollerar att "Din ledamot" plockar ut exakt de som sitter i riksdagen nu.
// Körs mot riksdagens skarpa API – alltså från en maskin som når data.riksdagen.se.
//
//   node verify-ledamoter.mjs
//
// Skriptet provar samma frågor som webbappen, i samma ordning, och rapporterar
// hur många tjänstgörande ledamöter varje fråga ger. Riksdagen har 349 mandat.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Filter = require('./docs/ledamotsfilter.js');

const API = 'https://data.riksdagen.se';
const FRAGOR = [
  '/personlista/?utformat=json&rdlstatus=tjanstgorande',
  '/personlista/?utformat=json&rdlstatus=tjanst',
  '/personlista/?utformat=json&rdlstatus=samtliga',
  '/personlista/?utformat=json',
  '/personlista/?utformat=json&rdlstatus=samtida', // den gamla, felaktiga frågan
];

const VALKRETSAR = 29;

async function prova(stig) {
  const t0 = Date.now();
  const svar = await fetch(API + stig, { headers: { Accept: 'application/json' } });
  if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
  const json = await svar.json();
  const rapporterat = Filter.somLista(json?.personlista?.person).length;
  const ledamoter = Filter.tjanstgorandeLedamoter(json);
  return { rapporterat, ledamoter, ms: Date.now() - t0 };
}

console.log('Kontrollerar riksdagens personlista …\n');

let vinnare = null;
for (const stig of FRAGOR) {
  process.stdout.write(`  ${stig}\n    `);
  try {
    const { rapporterat, ledamoter, ms } = await prova(stig);
    const ok = Filter.rimligtAntal(ledamoter.length);
    console.log(`${rapporterat} personer i svaret → ${ledamoter.length} tjänstgörande ` +
      `${ok ? '✓' : '✗ (orimligt)'}  [${ms} ms]`);
    if (ok && !vinnare) vinnare = { stig, ledamoter };
  } catch (fel) {
    console.log(`fel: ${fel.message}`);
  }
}

if (!vinnare) {
  console.error('\n✗ Ingen fråga gav ett rimligt antal ledamöter. Appen skulle visa fel data.');
  process.exit(1);
}

const { stig, ledamoter } = vinnare;
console.log(`\nAppen kommer att använda: ${stig}\n`);

// --- Kontroller mot kända fakta om riksdagen ---------------------------------

const fel = [];
const varna = [];

if (ledamoter.length !== Filter.MANDAT) {
  varna.push(`${ledamoter.length} ledamöter, inte ${Filter.MANDAT}. ` +
    `Avvikelser förekommer vid vakanser, men kolla att ingen avgången följt med.`);
}

const dubbletter = ledamoter.length - new Set(ledamoter.map((l) => l.id)).size;
if (dubbletter > 0) fel.push(`${dubbletter} dubblerade ledamöter i listan.`);

const utanValkrets = ledamoter.filter((l) => !l.valkrets);
if (utanValkrets.length) fel.push(`${utanValkrets.length} ledamöter saknar valkrets ` +
  `(t.ex. ${utanValkrets.slice(0, 3).map((l) => l.efternamn).join(', ')}).`);

const utanParti = ledamoter.filter((l) => !l.parti);
if (utanParti.length) varna.push(`${utanParti.length} ledamöter saknar parti ` +
  `(kan vara politiska vildar – kontrollera).`);

const perValkrets = new Map();
for (const l of ledamoter) perValkrets.set(l.valkrets, (perValkrets.get(l.valkrets) || 0) + 1);
if (perValkrets.size !== VALKRETSAR) {
  fel.push(`${perValkrets.size} valkretsar i datan, förväntat ${VALKRETSAR}.`);
}

console.log('Ledamöter per valkrets:');
for (const [vk, antal] of [...perValkrets].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(antal).padStart(3)}  ${vk}`);
}

const perParti = new Map();
for (const l of ledamoter) perParti.set(l.parti, (perParti.get(l.parti) || 0) + 1);
console.log('\nLedamöter per parti:');
for (const [parti, antal] of [...perParti].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(antal).padStart(3)}  ${parti}`);
}

console.log('');
for (const v of varna) console.log(`⚠ ${v}`);
for (const f of fel) console.log(`✗ ${f}`);
if (!fel.length && !varna.length) console.log('✓ Allt ser rimligt ut.');
process.exit(fel.length ? 1 : 0);
