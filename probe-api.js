// Testar vilka EDP FutureWeb-endpoints som svarar på Stenungsunds instans.
// Körs från ett nätverk som når futureweb.stenungsund.se (t.ex. hemifrån):
//   node probe-api.js [adress]
// Jämför utfallet med dokumentationen på https://webtest01.edp.se/FutureWebApiDoc/
const HOST = "https://futureweb.stenungsund.se";
const ADDRESS = process.argv[2] || "Näs Byväg 7";

// Kandidater: SimpleWastePickup-modulen (känd från öppen källkod) under båda
// installationsvarianterna, plus dokumentationsappen och några närliggande
// modulnamn som förekommer i andra kommuners EDP-installationer.
const PROBES = [
  { method: "GET",  path: "/FutureWebBasic/SimpleWastePickup/SimpleWastePickup" },
  { method: "POST", path: "/FutureWebBasic/SimpleWastePickup/SearchAdress", body: "searchText=" + encodeURIComponent(ADDRESS) },
  { method: "GET",  path: "/FutureWebBasic/SimpleWastePickup/GetWastePickupSchedule?address=" + encodeURIComponent(ADDRESS) },
  { method: "GET",  path: "/FutureWeb/SimpleWastePickup/SimpleWastePickup" },
  { method: "POST", path: "/FutureWeb/SimpleWastePickup/SearchAdress", body: "searchText=" + encodeURIComponent(ADDRESS) },
  { method: "GET",  path: "/FutureWeb/SimpleWastePickup/GetWastePickupSchedule?address=" + encodeURIComponent(ADDRESS) },
  { method: "GET",  path: "/FutureWebApiDoc/" },
  { method: "GET",  path: "/FutureWebBasic/" },
  { method: "GET",  path: "/FutureWebBasic/MyPages/MyPages" },
];

(async () => {
  console.log(`Probar ${HOST} med adress "${ADDRESS}"\n`);
  for (const p of PROBES) {
    const url = HOST + p.path;
    let line;
    try {
      const res = await fetch(url, {
        method: p.method,
        headers: p.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
        body: p.body,
        redirect: "manual",
        signal: AbortSignal.timeout(10000)
      });
      const text = (await res.text()).replace(/\s+/g, " ").slice(0, 120);
      const type = res.headers.get("content-type") || "";
      line = `${res.status} ${type.split(";")[0].padEnd(24)} ${text}`;
    } catch (err) {
      line = `FEL: ${err.cause?.code || err.name}`;
    }
    console.log(`${p.method.padEnd(4)} ${p.path}\n     → ${line}\n`);
  }
  console.log("Tolkning: 200 + application/json = API-endpoint som finns.");
  console.log("200 + text/html = webbsida. 404/500 = finns inte i denna installation.");
})();
