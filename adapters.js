// Kommunlistan och översättningen till respektive leverantörs API.
//
// Appen talar EDP FutureWeb internt: adressökning ger {Succeeded, Buildings}
// och schemahämtning ger {RhServices}. Andra leverantörer översätts hit av en
// adapter, så att UI:t, påminnelserna och proxyn slipper veta vilken
// leverantör en viss kommun råkar ha.
//
// Ingen npm-beroende, inget DOM – modulen delas av server.js och reminders.js.

const UPSTREAM_TIMEOUT_MS = 15000;

// Bas-URL:erna är verifierade mot respektive tjänst i båda stegen.
// Måste hållas i synk med PROVIDERS i index.html – test/providers.test.js vaktar det.
const PROVIDERS = {
  stenungsund: { kind: "edp", base: "https://futureweb.stenungsund.se/FutureWebBasic/SimpleWastePickup" },
  ale: { kind: "edp", base: "https://edp.ale.se/FutureWeb/SimpleWastePickup" },
  boden: { kind: "edp", base: "https://edpmobile.boden.se/FutureWeb/SimpleWastePickup" },
  boras: { kind: "edp", base: "https://kundportal.borasem.se/EDPFutureWeb/SimpleWastePickup" },
  gotland: { kind: "edp", base: "https://edpfuture.gotland.se/FutureWeb/SimpleWastePickup" },
  // Hässleholm har EDP men bara bakom inloggning – Appbolagets app-API är
  // vägen runt det. `unit` väljer kommun och ligger i klartext i deras egen
  // kalendersida.
  hassleholm: {
    kind: "appbolaget",
    base: "https://api-universal.appbolaget.se",
    unit: "e34d7050-1b2a-4917-a921-0ea7742d0a6e"
  },
  "herrljunga-vargarda": { kind: "edp", base: "https://edpfuture.remondis.se/EDPFutureWeb/SimpleWastePickup" },
  hudiksvall: { kind: "edp", base: "https://futureweb.hudiksvall.se/FutureWeb/SimpleWastePickup" },
  june: { kind: "edp", base: "https://minasidor.juneavfall.se/FutureWebJuneBasic/SimpleWastePickup" },
  kiruna: { kind: "edp", base: "https://kund.tekniskaverkenikiruna.se/FutureWebBasic/SimpleWastePickup" },
  kramfors: { kind: "edp", base: "https://futureweb.kramfors.se/EDPFutureWeb/SimpleWastePickup" },
  "kretslopp-sydost": { kind: "edp", base: "https://kundportal.kretsloppsydost.se/FutureWeb/SimpleWastePickup" },
  kristianstad: { kind: "edp", base: "https://edp.kristianstad.se/FutureWeb/SimpleWastePickup" },
  kungalv: { kind: "edp", base: "https://minasidor-va-avfall.kungalv.se/FutureWeb/SimpleWastePickup" },
  lerum: { kind: "edp", base: "https://vatjanst.lerum.se/FutureWeb/SimpleWastePickup" },
  lidkoping: { kind: "edp", base: "https://futureweb.lidkoping.se/FutureWebBasic/SimpleWastePickup" },
  // LSR kör EXDE Systems (THOR), inte EDP – därav annan sort och annan bas-URL-form.
  lsr: { kind: "exde", base: "https://minasidor.lsr.nu/api/api/external" },
  ljungby: { kind: "edp", base: "https://edpwebb.ljungby.se/FutureWeb/SimpleWastePickup" },
  ludvika: { kind: "edp", base: "https://futureweb.wbab.se/EDPFutureWeb/SimpleWastePickup" },
  lund: { kind: "edp", base: "https://eservice431601.lund.se/Lund/FutureWeb/SimpleWastePickup" },
  lycksele: { kind: "edp", base: "https://future.lycksele.se/FutureWeb/SimpleWastePickup" },
  mark: { kind: "edp", base: "https://va-renhallning.mark.se/FutureWeb/SimpleWastePickup" },
  merab: { kind: "edp", base: "https://edpmobile.merab.se/FutureWeb/SimpleWastePickup" },
  nvoa: { kind: "edp", base: "https://futureweb.nvoa.se/EDP/FutureWebBasic/SimpleWastePickup" },
  orebro: { kind: "edp", base: "https://futureweb.orebro.se/FutureWeb/SimpleWastePickup" },
  orust: { kind: "edp", base: "https://va-renhallning-minasidor.orust.se/FutureWebBasic/SimpleWastePickup" },
  partille: { kind: "edp", base: "https://vatjanst.partille.se/FutureWeb/SimpleWastePickup" },
  skelleftea: { kind: "edp", base: "https://wwwtk2.skelleftea.se/FutureWeb/SimpleWastePickup" },
  solleftea: { kind: "edp", base: "https://futureweb.solleftea.se/FutureWeb/SimpleWastePickup" },
  ssam: { kind: "edp", base: "https://edpfuture.ssam.se/FutureWeb/SimpleWastePickup" },
  uppsalavatten: { kind: "edp", base: "https://futureweb.uppsalavatten.se/Uppsala/FutureWeb/SimpleWastePickup" },
  vafabmiljo: { kind: "edp", base: "https://services.vafabmiljo.se/FutureWebVKFHus/SimpleWastePickup" },
  // VIVAB kör en egen instans per kommun på samma värd.
  "vivab-falkenberg": { kind: "edp", base: "https://minasidor.vivab.info/FutureWebFalken/SimpleWastePickup" },
  "vivab-varberg": { kind: "edp", base: "https://minasidor.vivab.info/FutureWebVarberg/SimpleWastePickup" }
};

const ADAPTERS = {
  // EDP FutureWeb är appens interna form, så här sker ingen översättning alls:
  // anropet skickas vidare precis som klienten skickade det.
  edp: {
    request(provider, endpoint, { search, method, body, contentType }) {
      const headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (compatible; hamtschema-app)"
      };
      if (body) headers["Content-Type"] = contentType || "application/x-www-form-urlencoded";
      return { url: provider.base + "/" + endpoint + (search || ""), method: method || "GET", headers, body };
    },
    normalize(endpoint, text) { return text; }
  },

  // EXDE Systems (produktnamnet är THOR). Två POST-endpoints som tar JSON och
  // svarar med rena arrayer: adressökningen ger strängar, schemat ger en post
  // per tömningstillfälle – hela serien, inte bara nästa gång.
  exde: {
    request(provider, endpoint, { search }) {
      const params = new URLSearchParams(search || "");
      const adress = endpoint === "SearchAdress"
        ? (params.get("searchText") || "")
        : (params.get("address") || "");
      return {
        url: provider.base + (endpoint === "SearchAdress" ? "/autocompleteAllPost/" : "/schedulePost/"),
        // Även schemat är en POST här, till skillnad från EDP:s GET.
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ Address: adress })
      };
    },
    normalize(endpoint, text) {
      const data = JSON.parse(text);
      if (endpoint === "SearchAdress") {
        return JSON.stringify({ Succeeded: true, Buildings: Array.isArray(data) ? data : [] });
      }
      // Serien innehåller flera tillfällen per avfallsslag och kommer inte
      // sorterad. Appen visar nästa tömning, så bara det tidigaste datumet
      // per avfallsslag behålls.
      const tidigast = new Map();
      for (const post of Array.isArray(data) ? data : []) {
        const typ = post.typeOfWasteDescription || post.wasteType || post.typeOfWaste;
        const datum = typeof post.date === "string" ? post.date.slice(0, 10) : null;
        if (!typ || !datum) continue;
        const befintlig = tidigast.get(typ);
        if (!befintlig || datum < befintlig.NextWastePickup) {
          tidigast.set(typ, {
            WasteType: typ,
            NextWastePickup: datum,
            WastePickupFrequency: post.collectionFrequency || "",
            BinType: { Code: post.containerType || "", ContainerType: "", Size: null, Unit: "" }
          });
        }
      }
      return JSON.stringify({ RhServices: [...tidigast.values()] });
    }
  },

  // Appbolagets "universal"-API. Kommunen väljs med headern Unit mot
  // /waste/… men med query-parametern unit mot /@universal/… – samma värde,
  // två olika sätt att skicka det.
  appbolaget: {
    // Sökningen ger adressens uuid, men schemat slås upp på fastighetsnumret,
    // som bara finns på adressens egen resurs. Därför ett uppslag emellan.
    async resolve(provider, endpoint, { search }, { fetchImpl = fetch, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
      if (endpoint !== "GetWastePickupSchedule") return {};
      const uuid = idUrParentes(new URLSearchParams(search || "").get("address"));
      if (!uuid) return {};
      const res = await fetchImpl(provider.base + "/waste/addresses/" + encodeURIComponent(uuid), {
        method: "GET", headers: appbolagetHeaders(provider), signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) return {};
      const data = JSON.parse(await res.text());
      return { propertyId: (data && data.data && data.data.property_id) || "" };
    },
    request(provider, endpoint, { search, resolved }) {
      const params = new URLSearchParams(search || "");
      const headers = appbolagetHeaders(provider);
      if (endpoint === "SearchAdress") {
        return {
          url: provider.base + "/waste/addresses/search?query=" + encodeURIComponent(params.get("searchText") || ""),
          method: "GET", headers
        };
      }
      const id = (resolved && resolved.propertyId) || "";
      return {
        url: provider.base + "/@universal/waste/properties/" + encodeURIComponent(id) + "/?unit=" + provider.unit,
        method: "GET", headers
      };
    },
    normalize(endpoint, text, { today } = {}) {
      const svar = JSON.parse(text);
      if (endpoint === "SearchAdress") {
        const träffar = (svar && svar.data) || [];
        return JSON.stringify({
          Succeeded: true,
          Buildings: träffar
            .filter(t => t && t.address && t.uuid)
            .map(t => `${t.address}, ${t.city || ""} (${t.uuid})`.replace(/, +\(/, " ("))
        });
      }
      const idag = today || svenskDatum(new Date());
      const tjänster = [];
      for (const s of ((svar && svar.data && svar.data.services) || [])) {
        const kod = s.code || {};
        // Det långa namnet är bäst för kärlen ("Fyrfack kärl 1 Plast och
        // Pappersförpackningar"), men för vissa tjänster beskriver det en
        // avgift i stället för ett avfallsslag. Då säger det korta namnet
        // vad tömningen faktiskt är.
        const långt = kod.description_verbose || "";
        const namn = (/^avgift/i.test(långt.trim()) ? (kod.description || långt) : långt)
          || kod.description || kod.code;
        // Tidsstämplarna är UTC: "22:00:00" är redan nästa dygn i svensk tid.
        // Serien innehåller dessutom passerade tömningar, så det som söks är
        // det tidigaste datumet som inte redan varit.
        const kommande = (s.collections || [])
          .map(c => c && c.collection_at ? svenskDatum(new Date(String(c.collection_at).replace(" ", "T") + "Z")) : null)
          .filter(d => d && d >= idag)
          .sort();
        if (!namn || !kommande.length) continue;
        tjänster.push({
          WasteType: namn,
          NextWastePickup: kommande[0],
          WastePickupFrequency: "",
          BinType: { Code: kod.code || "", ContainerType: "", Size: null, Unit: "" }
        });
      }
      return JSON.stringify({ RhServices: tjänster });
    }
  }
};

// Datumet för ett ögonblick räknat i svensk tid, som "2026-08-11".
function svenskDatum(d) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(d);
}

// Appen skickar tillbaka hela adressträffen; identifieraren står sist i en
// parentes, precis som EDP:s anläggningsnummer.
function idUrParentes(adress) {
  return (String(adress || "").match(/\(([^)]*)\)\s*$/) || [])[1] || "";
}

function appbolagetHeaders(provider) {
  return {
    "Accept": "application/json",
    "Module": "universal",
    "Unit": provider.unit,
    "User-Agent": "Mozilla/5.0 (compatible; hamtschema-app)"
  };
}

function adapterFor(provider) {
  return provider && Object.hasOwn(ADAPTERS, provider.kind) ? ADAPTERS[provider.kind] : undefined;
}

// Hämtar schemat för en adress och ger tillbaka det i appens form.
// Används av påminnelsetjänsten, som inte ska behöva känna till leverantörer.
async function fetchSchedule(provider, building, { fetchImpl = fetch, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  const adapter = adapterFor(provider);
  if (!adapter) throw new Error("Okänd leverantörssort: " + (provider && provider.kind));
  const params = { search: "?address=" + encodeURIComponent(building), method: "GET" };
  if (adapter.resolve) {
    params.resolved = await adapter.resolve(provider, "GetWastePickupSchedule", params, { fetchImpl, timeoutMs });
  }
  const req = adapter.request(provider, "GetWastePickupSchedule", params);
  const res = await fetchImpl(req.url, {
    method: req.method, headers: req.headers, body: req.body,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    const err = new Error("HTTP " + res.status);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(adapter.normalize("GetWastePickupSchedule", await res.text()));
}

module.exports = { PROVIDERS, ADAPTERS, adapterFor, fetchSchedule, UPSTREAM_TIMEOUT_MS };
