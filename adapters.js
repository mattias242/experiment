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
  danderyd: { kind: "exde", base: "https://minasidor-danderyd-az.exdesystems.se/api/api/external" },
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
  // Lumire lägger om insamlingen i Luleå från 2026-08-17 – bevaka att
  // svarsformen består.
  lumire: { kind: "lumire", base: "https://lumire.se/api/waste-pickup" },
  lund: { kind: "edp", base: "https://eservice431601.lund.se/Lund/FutureWeb/SimpleWastePickup" },
  lycksele: { kind: "edp", base: "https://future.lycksele.se/FutureWeb/SimpleWastePickup" },
  mark: { kind: "edp", base: "https://va-renhallning.mark.se/FutureWeb/SimpleWastePickup" },
  mellerud: { kind: "edp", base: "https://vatten.mellerud.se/EDPFutureWeb/SimpleWastePickup" },
  merab: { kind: "edp", base: "https://edpmobile.merab.se/FutureWeb/SimpleWastePickup" },
  // NSR har eget API och täcker sex kommuner från en instans.
  nsr: { kind: "nsr", base: "https://nsr.se/api/wastecalendar" },
  nvoa: { kind: "edp", base: "https://futureweb.nvoa.se/EDP/FutureWebBasic/SimpleWastePickup" },
  // Ökrab: Sysav tar över Tomelilla och Simrishamn 2026-09-01, så den här
  // instansen kan försvinna. Bevaka – hellre en ärlig felruta än gamla datum.
  okrab: { kind: "exde", base: "https://minasidor.okrab.se/MinaSidor_API/api/external" },
  orebro: { kind: "edp", base: "https://futureweb.orebro.se/FutureWeb/SimpleWastePickup" },
  orust: { kind: "edp", base: "https://va-renhallning-minasidor.orust.se/FutureWebBasic/SimpleWastePickup" },
  oxelosund: { kind: "edp", base: "https://futureweb.oxeloenergi.se/FutureWeb/SimpleWastePickup" },
  partille: { kind: "edp", base: "https://vatjanst.partille.se/FutureWeb/SimpleWastePickup" },
  pitea: { kind: "edp", base: "https://va.pitea.se/FutureWeb/SimpleWastePickup" },
  skelleftea: { kind: "edp", base: "https://wwwtk2.skelleftea.se/FutureWeb/SimpleWastePickup" },
  solleftea: { kind: "edp", base: "https://futureweb.solleftea.se/FutureWeb/SimpleWastePickup" },
  ssam: { kind: "edp", base: "https://edpfuture.ssam.se/FutureWeb/SimpleWastePickup" },
  stockholm: { kind: "svoa", base: "https://www.stockholmvattenochavfall.se/villa-och-radhus/avfallstjanster/nar-kommer-sopbilen" },
  sundsvall: { kind: "sundsvall", base: "https://api.sundsvall.se/Garbage/2281" },
  taby: { kind: "exde", base: "https://minasidor-taby-az.exdesystems.se/api/api/external" },
  telge: { kind: "thorweb", base: "https://www.telge.se/api/thorweb/garbagecollection" },
  uppsalavatten: { kind: "edp", base: "https://futureweb.uppsalavatten.se/Uppsala/FutureWeb/SimpleWastePickup" },
  vafabmiljo: { kind: "edp", base: "https://services.vafabmiljo.se/FutureWebVKFHus/SimpleWastePickup" },
  // VIVAB kör en egen instans per kommun på samma värd.
  vasyd: { kind: "vasyd", base: "https://www.vasyd.se/api/sitecore/mypagesapi" },
  "vivab-falkenberg": { kind: "edp", base: "https://minasidor.vivab.info/FutureWebFalken/SimpleWastePickup" },
  "vivab-varberg": { kind: "edp", base: "https://minasidor.vivab.info/FutureWebVarberg/SimpleWastePickup" }
};

// Sundsvalls API använder engelska koder för avfallsslagen. Det här är en
// översättning av kodnamnen, inte en tolkning av vad som ligger i kärlen –
// okända koder visas som de är i stället för att tappas bort.
const AVFALLSSLAG_SUNDSVALL = {
  WASTE: "Restavfall",
  FOOD: "Matavfall",
  PAPER: "Pappersförpackningar",
  PLASTIC: "Plastförpackningar"
};

// EXDE Systems produkt THOR, delad av `exde` och `thorweb`. Serien innehåller
// flera tillfällen per avfallsslag, kommer osorterad och sträcker sig bakåt i
// tiden. Appen visar nästa tömning, så passerade datum sållas bort innan det
// tidigaste per avfallsslag väljs – annars blir "nästa tömning" en dag som
// redan varit.
function normaliseraThor(endpoint, text, { today } = {}) {
  const data = JSON.parse(text);
  if (endpoint === "SearchAdress") {
    return JSON.stringify({ Succeeded: true, Buildings: Array.isArray(data) ? data : [] });
  }
  const idag = today || svenskDatum(new Date());
  const tidigast = new Map();
  for (const post of Array.isArray(data) ? data : []) {
    const typ = post.typeOfWasteDescription || post.wasteType || post.typeOfWaste;
    const datum = typeof post.date === "string" ? post.date.slice(0, 10) : null;
    if (!typ || !datum || datum < idag) continue;
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
    request(provider, endpoint, params) {
      const adress = anropsvarde(params, endpoint === "SearchAdress" ? "searchText" : "address");
      return {
        url: provider.base + (endpoint === "SearchAdress" ? "/autocompleteAllPost/" : "/schedulePost/"),
        // Även schemat är en POST här, till skillnad från EDP:s GET.
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ Address: adress })
      };
    },
    normalize: normaliseraThor
  },

  // Telge i Södertälje kör samma produkt (THOR) men lägger värdena i sökvägen
  // i stället för i en JSON-body. Svarsformatet är identiskt, ända ner till
  // blankstegsutfyllnaden i vehicleId – därav delad normalisering.
  thorweb: {
    request(provider, endpoint, params) {
      const värde = endpoint === "SearchAdress"
        ? anropsvarde(params, "searchText")
        : anropsvarde(params, "address");
      return {
        url: provider.base + (endpoint === "SearchAdress" ? "/autocomplete/" : "/schedule/") + encodeURIComponent(värde),
        method: "GET",
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; hamtschema-app)" }
      };
    },
    normalize: normaliseraThor
  },

  // Lumire i Luleå. Eget REST-omslag runt EDP-data – kärlkoderna är EDP:s.
  lumire: {
    request(provider, endpoint, params) {
      const headers = { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; hamtschema-app)" };
      if (endpoint === "SearchAdress") {
        return { url: provider.base + "?q=" + encodeURIComponent(anropsvarde(params, "searchText")), method: "GET", headers };
      }
      return {
        url: provider.base + "/" + encodeURIComponent(idUrParentes(anropsvarde(params, "address"))),
        method: "GET", headers
      };
    },
    normalize(endpoint, text, { today } = {}) {
      const svar = JSON.parse(text) || {};
      if (endpoint === "SearchAdress") {
        return JSON.stringify({
          Succeeded: true,
          Buildings: (svar.addresses || [])
            .filter(a => a && a.address && a.buildingId)
            .map(a => `${a.address} (${a.buildingId})`)
        });
      }
      const idag = today || svenskDatum(new Date());
      return JSON.stringify({
        RhServices: (svar.data || [])
          // Avslutade abonnemang ligger kvar i svaret men ska inte visas.
          .filter(t => t && t.isActive !== false && t.nextPickup && String(t.nextPickup).slice(0, 10) >= idag)
          .map(t => ({
            WasteType: t.description || "",
            NextWastePickup: String(t.nextPickup).slice(0, 10),
            WastePickupFrequency: "",
            BinType: {
              Code: (t.binType || {}).code || "",
              ContainerType: (t.binType || {}).container_type || "",
              Size: (t.binType || {}).size || null,
              Unit: (t.binType || {}).unit || ""
            }
          }))
      });
    }
  },

  // NSR (nordvästra Skåne). Ett enda sökanrop ger både adressträffar och hela
  // datumserien. Appen frågar i två steg, så endpointen anropas två gånger –
  // andra gången för att plocka ut just den valda adressens serie.
  nsr: {
    request(provider, endpoint, params) {
      const fråga = endpoint === "SearchAdress"
        ? anropsvarde(params, "searchText")
        // Adressen kommer tillbaka som "Gatan 1, Ort (id)"; sökningen vill ha
        // gatuadressen, inte orten eller id:t.
        : anropsvarde(params, "address").replace(/\s*\([^)]*\)\s*$/, "").split(",")[0].trim();
      return {
        url: provider.base + "/search?query=" + encodeURIComponent(fråga),
        method: "GET",
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; hamtschema-app)" }
      };
    },
    normalize(endpoint, text, { today, params } = {}) {
      const träffar = (JSON.parse(text) || {}).fp || [];
      if (endpoint === "SearchAdress") {
        return JSON.stringify({
          Succeeded: true,
          // Orten skiljer träffarna åt – samma gatunamn finns i flera av de
          // sex kommunerna NSR täcker.
          Buildings: träffar.filter(t => t && t.id).map(t => `${t.Adress}, ${t.Ort} (${t.id})`)
        });
      }
      const valdId = idUrParentes(anropsvarde(params, "address"));
      const träff = träffar.find(t => t && t.id === valdId);
      const exec = (träff && träff.Exec) || {};
      const datum = exec.Datum || [], typer = exec.AvfallsTyp || [], veckor = exec.DatumWeek || [];
      const idag = today || svenskDatum(new Date());
      // Arrayerna hör ihop indexvis. Samma avfallsslag återkommer flera gånger
      // i serien, så det tidigaste kommande datumet per slag är det som gäller.
      const tidigast = new Map();
      for (let i = 0; i < datum.length; i++) {
        const typ = typer[i], d = datum[i];
        if (!typ || !d || d < idag) continue;
        const befintlig = tidigast.get(typ);
        if (!befintlig || d < befintlig.NextWastePickup) {
          tidigast.set(typ, {
            WasteType: typ,
            NextWastePickup: d,
            WastePickupFrequency: veckor[i] || "",
            BinType: { Code: "", ContainerType: "", Size: null, Unit: "" }
          });
        }
      }
      return JSON.stringify({ RhServices: [...tidigast.values()] });
    }
  },

  // VA SYD (Malmö, Burlöv). Två POST med formulärdata. Parametern heter
  // `query` i båda stegen – alla andra namn ger {"success":false} med HTTP 200,
  // och även riktiga fel kommer som 200, så svaret måste granskas på innehåll.
  vasyd: {
    request(provider, endpoint, params) {
      const värde = endpoint === "SearchAdress"
        ? anropsvarde(params, "searchText")
        // Steg två vill ha enbart id-siffrorna; adresstexten ger tom lista.
        : idUrParentes(anropsvarde(params, "address"));
      return {
        url: provider.base + (endpoint === "SearchAdress" ? "/buildingaddresssearch" : "/wastepickupbyaddress"),
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (compatible; hamtschema-app)"
        },
        body: "query=" + encodeURIComponent(värde)
      };
    },
    normalize(endpoint, text) {
      const svar = JSON.parse(text) || {};
      const poster = Array.isArray(svar.items) ? svar.items : [];
      if (endpoint === "SearchAdress") {
        return JSON.stringify({
          Succeeded: true,
          Buildings: poster.filter(p => p && p.street && p.id).map(p => `${p.street} (${p.id})`)
        });
      }
      return JSON.stringify({
        RhServices: poster.filter(p => p && p.nextWastePickup).map(p => ({
          WasteType: p.wasteType || "",
          NextWastePickup: p.nextWastePickup,
          // Frekvenstexten har efterföljande blanksteg i svaret.
          WastePickupFrequency: String(p.wastePickupFrequency || "").trim(),
          BinType: { Code: "", ContainerType: "", Size: null, Unit: "" }
        }))
      });
    }
  },

  // Stockholm Vatten och Avfall. Två GET. Gäller bara villa och radhus –
  // flerbostadshus svarar {} med HTTP 200 och ska läsas som "hittades inte".
  svoa: {
    request(provider, endpoint, params) {
      const headers = { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; hamtschema-app)" };
      if (endpoint === "SearchAdress") {
        return {
          url: provider.base + "/AutoCompleteMe?query=" + encodeURIComponent(anropsvarde(params, "searchText")),
          method: "GET", headers
        };
      }
      return {
        url: provider.base + "/Search?address=" + encodeURIComponent(anropsvarde(params, "address")),
        method: "GET", headers
      };
    },
    normalize(endpoint, text, { today } = {}) {
      const data = JSON.parse(text) || {};
      if (endpoint === "SearchAdress") {
        return JSON.stringify({
          Succeeded: true,
          // Förslagets `value` är exakt den sträng Search vill ha tillbaka.
          Buildings: (Array.isArray(data) ? data : []).filter(f => f && f.value).map(f => f.value)
        });
      }
      // Schemat är ett objekt med avfallsslaget som nyckel och en lista under.
      const idag = today || svenskDatum(new Date());
      const tjänster = [];
      for (const [typ, poster] of Object.entries(data)) {
        const kommande = (Array.isArray(poster) ? poster : [])
          .map(p => p && p.ExecutionDate ? { datum: String(p.ExecutionDate).slice(0, 10), frekvens: p.FetchFrequency || "" } : null)
          .filter(p => p && p.datum >= idag)
          .sort((a, b) => (a.datum < b.datum ? -1 : 1));
        if (!kommande.length) continue;
        tjänster.push({
          WasteType: typ,
          NextWastePickup: kommande[0].datum,
          WastePickupFrequency: kommande[0].frekvens,
          BinType: { Code: "", ContainerType: "", Size: null, Unit: "" }
        });
      }
      return JSON.stringify({ RhServices: tjänster });
    }
  },

  // Sundsvall – det enda API:et i kartläggningen som är avsiktligt publicerat
  // som öppna data (CC0). Ett anrop ger både adress och schema.
  sundsvall: {
    request(provider, endpoint, params) {
      const headers = { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; hamtschema-app)" };
      if (endpoint === "SearchAdress") {
        // Okända parameternamn ignoreras tyst och ger hela registret –
        // 23 510 poster – i stället för ett fel. `street` är det rätta.
        return {
          url: provider.base + "/schedules?street=" + encodeURIComponent(anropsvarde(params, "searchText")),
          method: "GET", headers
        };
      }
      const [gata, nummer] = idUrParentes(anropsvarde(params, "address")).split("|");
      return {
        url: provider.base + "/schedules?street=" + encodeURIComponent(gata || "") +
             "&houseNumber=" + encodeURIComponent(nummer || ""),
        method: "GET", headers
      };
    },
    normalize(endpoint, text, { today } = {}) {
      const poster = JSON.parse(text);
      const lista = Array.isArray(poster) ? poster : [];
      if (endpoint === "SearchAdress") {
        return JSON.stringify({
          Succeeded: true,
          Buildings: lista.filter(p => p && p.address && p.address.street).map(p => {
            const a = p.address;
            // Gata och nummer behövs båda för att slå upp schemat.
            return `${a.street} ${a.houseNumber || ""}, ${a.city || ""} (${a.street}|${a.houseNumber || ""})`.replace(/ +,/, ",");
          })
        });
      }
      const idag = today || svenskDatum(new Date());
      const tidigast = new Map();
      for (const p of lista) {
        for (const s of (p.schedules || [])) {
          const typ = AVFALLSSLAG_SUNDSVALL[s.wasteType] || s.wasteType;
          const datum = s.nextPickupDate ? String(s.nextPickupDate).slice(0, 10) : null;
          if (!typ || !datum || datum < idag) continue;
          const befintlig = tidigast.get(typ);
          if (!befintlig || datum < befintlig.NextWastePickup) {
            tidigast.set(typ, {
              WasteType: typ,
              NextWastePickup: datum,
              WastePickupFrequency: "",
              BinType: { Code: "", ContainerType: "", Size: null, Unit: "" }
            });
          }
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
    async resolve(provider, endpoint, params, { fetchImpl = fetch, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
      if (endpoint !== "GetWastePickupSchedule") return {};
      const uuid = idUrParentes(anropsvarde(params, "address"));
      if (!uuid) return {};
      const res = await fetchImpl(provider.base + "/waste/addresses/" + encodeURIComponent(uuid), {
        method: "GET", headers: appbolagetHeaders(provider), signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) return {};
      const data = JSON.parse(await res.text());
      return { propertyId: (data && data.data && data.data.property_id) || "" };
    },
    request(provider, endpoint, params) {
      const headers = appbolagetHeaders(provider);
      if (endpoint === "SearchAdress") {
        return {
          url: provider.base + "/waste/addresses/search?query=" + encodeURIComponent(anropsvarde(params, "searchText")),
          method: "GET", headers
        };
      }
      const id = ((params && params.resolved) || {}).propertyId || "";
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

// Hämtar en parameter ur anropet oavsett om klienten la den i URL:en eller i
// bodyn. Gränssnittet POSTar söktexten som formulärdata; EDP-adaptern
// vidarebefordrar bodyn orörd och behöver aldrig titta, men adaptrar som
// bygger om anropet måste kunna läsa båda.
function anropsvarde(params, namn) {
  const iUrl = new URLSearchParams((params && params.search) || "").get(namn);
  if (iUrl) return iUrl;
  const typ = String((params && params.contentType) || "").toLowerCase();
  if (params && params.body && (!typ || typ.includes("form-urlencoded"))) {
    return new URLSearchParams(params.body).get(namn) || "";
  }
  return "";
}

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
  return JSON.parse(adapter.normalize("GetWastePickupSchedule", await res.text(), { params }));
}

module.exports = { PROVIDERS, ADAPTERS, adapterFor, fetchSchedule, UPSTREAM_TIMEOUT_MS };
