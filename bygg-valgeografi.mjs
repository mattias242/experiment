// Bygger kartgeometrin till förändringskartan (docs/karta.html).
//
//   node bygg-valgeografi.mjs
//
// Hämtar Valmyndighetens valdistriktsindelning för hela landet (en 28 MB zip
// med en 98 MB GeoJSON i SWEREF 99 TM) och kokar ned den till tre TopoJSON-
// filer: valdistrikt, kommuner och riksdagsvalkretsar. Kommun- och
// valkretsgränserna smälts fram ur valdistrikten, så de tre nivåerna ligger
// exakt på varandra.
//
// Förenklingen görs med mapshaper, som hämtas med npx vid körning – det är
// enda tillfället något byggverktyg behövs, och det som ligger i docs/ är
// färdiga filer utan byggkedja.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const kör = promisify(execFile);

// Länken ligger på val.se/valresultat-och-statistik/statistik-och-data/radata-val-2026
const ZIP = process.env.VAL_GEOJSON_ZIP ||
  'https://www.val.se/download/18.332cf48819bd61ac1513889/1785491689960/valdistrikt-riket-2026.zip';
const UTMAPP = path.join(import.meta.dirname, 'docs', 'valdata');

// Förenklingen anges i meter: hur långt en punkt får flyttas. 120 m syns inte
// på en karta över hela Sverige men tar bort nio tiondelar av alla punkter.
// De ihopsmälta nivåerna tål mer eftersom de ritas mer utzoomade.
const NIVAER = [
  {
    fil: 'geografi-valdistrikt.json',
    lager: 'valdistrikt',
    falt: ['Valdistriktskod'],
    interval: 120,
    kvantisering: 40000,
  },
  {
    fil: 'geografi-kommun.json',
    lager: 'kommun',
    falt: ['Kommunkod', 'Kommun', 'Riksdagsvalkretskod'],
    smaltSamman: { nyckel: 'Kommunkod', behall: 'Kommun,Riksdagsvalkretskod' },
    interval: 400,
    kvantisering: 20000,
  },
  {
    fil: 'geografi-valkrets.json',
    lager: 'valkrets',
    falt: ['Riksdagsvalkretskod', 'Riksdagsvalkrets'],
    smaltSamman: { nyckel: 'Riksdagsvalkretskod', behall: 'Riksdagsvalkrets' },
    interval: 1000,
    kvantisering: 20000,
  },
];

const mapshaper = (args) =>
  kör('npx', ['--yes', 'mapshaper@0.6', ...args], { maxBuffer: 64 * 1024 * 1024 });

const arbetsmapp = await mkdtemp(path.join(tmpdir(), 'valgeografi-'));
try {
  process.stderr.write(`Hämtar ${ZIP}\n`);
  const svar = await fetch(ZIP);
  if (!svar.ok) throw new Error(`HTTP ${svar.status} för ${ZIP}`);
  const zip = path.join(arbetsmapp, 'valdistrikt.zip');
  await writeFile(zip, Buffer.from(await svar.arrayBuffer()));
  await kör('unzip', ['-o', '-j', zip, '-d', arbetsmapp]);

  const { stdout } = await kör('sh', ['-c',
    `ls ${JSON.stringify(arbetsmapp)}/*.geojson`]);
  const geojson = stdout.trim().split('\n')[0];
  process.stderr.write(`Packade upp ${path.basename(geojson)} ` +
    `(${((await stat(geojson)).size / 1e6).toFixed(0)} MB)\n`);

  await mkdir(UTMAPP, { recursive: true });
  for (const n of NIVAER) {
    const ut = path.join(UTMAPP, n.fil);
    // Förenkla först och smält ihop sedan: att smälta ihop först ger
    // mångdubbelt större filer, eftersom de inre gränserna då redan är borta
    // när förenklingen ska hitta punkter att ta bort.
    const args = [
      geojson,
      '-filter-fields', n.falt.join(','),
      '-simplify', 'visvalingam', 'planar', `interval=${n.interval}`, 'keep-shapes',
    ];
    if (n.smaltSamman) {
      args.push('-dissolve2', n.smaltSamman.nyckel,
        `copy-fields=${n.smaltSamman.behall}`);
    }
    args.push('-rename-layers', n.lager,
      '-o', 'format=topojson', `quantization=${n.kvantisering}`, ut);
    await mapshaper(args);
    process.stderr.write(
      `${n.fil}: ${((await stat(ut)).size / 1e6).toFixed(2)} MB\n`);
  }
} finally {
  await rm(arbetsmapp, { recursive: true, force: true });
}
