// Testar SearchAdress + GetWastePickupSchedule mot alla kända EDP FutureWeb-
// instanser, eller en enskild:
//   node probe-api.js                      → alla, med vanliga gatunamn
//   node probe-api.js orebro               → en kommun, med vanliga gatunamn
//   node probe-api.js orebro "Storgatan 3" → en kommun, egen adress
const PROVIDERS = {
  stenungsund: "https://futureweb.stenungsund.se/FutureWebBasic/SimpleWastePickup",
  boden: "https://edpmobile.boden.se/FutureWeb/SimpleWastePickup",
  boras: "https://kundportal.borasem.se/EDPFutureWeb/SimpleWastePickup",
  "herrljunga-vargarda": "https://edpfuture.remondis.se/EDPFutureWeb/SimpleWastePickup",
  kiruna: "https://kund.tekniskaverkenikiruna.se/FutureWebBasic/SimpleWastePickup",
  "kretslopp-sydost": "https://kundportal.kretsloppsydost.se/FutureWeb/SimpleWastePickup",
  lidkoping: "https://futureweb.lidkoping.se/FutureWebBasic/SimpleWastePickup",
  ljungby: "https://edpwebb.ljungby.se/FutureWeb/SimpleWastePickup",
  lycksele: "https://future.lycksele.se/FutureWeb/SimpleWastePickup",
  mark: "https://va-renhallning.mark.se/FutureWeb/SimpleWastePickup",
  nvoa: "https://futureweb.nvoa.se/EDP/FutureWebBasic/SimpleWastePickup",
  orebro: "https://futureweb.orebro.se/FutureWeb/SimpleWastePickup",
  orust: "https://va-renhallning-minasidor.orust.se/FutureWebBasic/SimpleWastePickup",
  skelleftea: "https://wwwtk2.skelleftea.se/FutureWeb/SimpleWastePickup",
  ssam: "https://edpfuture.ssam.se/FutureWeb/SimpleWastePickup",
  uppsalavatten: "https://futureweb.uppsalavatten.se/Uppsala/FutureWeb/SimpleWastePickup",
  vafabmiljo: "https://services.vafabmiljo.se/FutureWebVKFHus/SimpleWastePickup"
};
// Vanliga gatunamn som finns i de flesta tätorter – används när ingen adress anges.
const CANDIDATES = ["Storgatan", "Kyrkvägen", "Skolvägen", "Strandvägen", "Ringvägen"];

const [, , onlyProvider, customAddress] = process.argv;

async function searchAdress(base, term) {
  const res = await fetch(base + "/SearchAdress", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "searchText=" + encodeURIComponent(term),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) return { status: res.status };
  const data = await res.json().catch(() => null);
  return { status: res.status, buildings: data && data.Buildings || [] };
}

async function probe(key, base) {
  try {
    let building = null, used = null, searchStatus = null;
    for (const term of customAddress ? [customAddress] : CANDIDATES) {
      const r = await searchAdress(base, term);
      searchStatus = r.status;
      if (r.buildings && r.buildings.length) { building = r.buildings[0]; used = term; break; }
    }
    if (!building) {
      console.log(`${key.padEnd(20)} ✗ SearchAdress ${searchStatus} – ingen träff`);
      return;
    }
    // GetWastePickupSchedule kräver hela anläggningssträngen "Adress, Ort (nummer)".
    const res = await fetch(base + "/GetWastePickupSchedule?address=" + encodeURIComponent(building),
      { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log(`${key.padEnd(20)} ✗ GetWastePickupSchedule HTTP ${res.status} för "${building}"`);
      return;
    }
    const data = await res.json().catch(() => null);
    const services = data && (data.RhServices || data.rhServices) || [];
    const sample = services.slice(0, 4).map(s => `${s.WasteType || "?"} → ${s.NextWastePickup || "?"}`).join(" | ");
    console.log(`${key.padEnd(20)} ✓ "${building}" (sökte: ${used})\n${" ".repeat(21)}  ${sample || "inga tjänster"}`);
  } catch (err) {
    console.log(`${key.padEnd(20)} ✗ ${String(err.cause?.code || err.name || err).slice(0, 60)}`);
  }
}

(async () => {
  const keys = onlyProvider ? [onlyProvider] : Object.keys(PROVIDERS);
  for (const key of keys) {
    if (!PROVIDERS[key]) { console.log(`Okänd kommun "${key}". Giltiga: ${Object.keys(PROVIDERS).join(", ")}`); return; }
    await probe(key, PROVIDERS[key]);
  }
})();
