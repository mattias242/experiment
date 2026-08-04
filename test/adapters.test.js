// BDD-tester för adapterlagret. Kör: node --test
//
// Appen talar EDP FutureWeb internt: adressökning ger {Succeeded, Buildings}
// och schemat ger {RhServices}. Adaptrarna finns för att andra leverantörer
// ska kunna översättas till samma form, så att UI, påminnelser och proxy
// slipper veta vilken leverantör en kommun råkar ha.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { PROVIDERS, adapterFor, fetchSchedule } = require("../adapters.js");

describe("Egenskap: söktexten hittas oavsett hur klienten skickar den", () => {
  // Gränssnittet POSTar söktexten som formulärdata i bodyn, inte i URL:en.
  // EDP-adaptern vidarebefordrar bodyn orörd och märkte aldrig skillnaden,
  // men adaptrar som bygger om anropet måste läsa den – annars söker de på
  // tom sträng och svaret blir hela registret, 500 eller 422.
  const fall = [
    ["exde", { kind: "exde", base: "https://x.invalid/api/api/external" }, r => JSON.parse(r.body).Address],
    ["nsr", { kind: "nsr", base: "https://x.invalid/api" }, r => new URL(r.url).searchParams.get("query")],
    ["appbolaget", { kind: "appbolaget", base: "https://x.invalid", unit: "u" }, r => new URL(r.url).searchParams.get("query")]
  ];

  for (const [namn, provider, plocka] of fall) {
    it(`Givet att ${namn}-kommunen söks som gränssnittet gör, så används söktexten ur bodyn`, () => {
      const r = adapterFor(provider).request(provider, "SearchAdress", {
        search: "",
        method: "POST",
        body: "searchText=" + encodeURIComponent("Storgatan 1"),
        contentType: "application/x-www-form-urlencoded"
      });
      assert.equal(plocka(r), "Storgatan 1", namn + " tappade söktexten");
    });
  }
});

describe("Egenskap: varje kommun vet vilken sorts tjänst den talar med", () => {
  it("Givet kommunlistan, när en kommun slås upp, så har den en känd sort och en bas-URL", () => {
    const kinds = new Set(["edp", "exde", "appbolaget", "nsr", "vasyd", "svoa", "sundsvall", "thorweb", "lumire", "sysav", "affarsverken", "indecta"]);
    for (const [key, p] of Object.entries(PROVIDERS)) {
      assert.ok(kinds.has(p.kind), key + " har okänd sort: " + p.kind);
      assert.match(p.base, /^https:\/\//, key + " saknar bas-URL");
    }
  });

  it("Givet en okänd sort, när en adapter efterfrågas, så vägras den", () => {
    assert.equal(adapterFor({ kind: "finns-inte" }), undefined);
  });
});

describe("Egenskap: EDP-anropen ser likadana ut som förut", () => {
  const edp = { kind: "edp", base: "https://exempel.invalid/FutureWeb/SimpleWastePickup" };

  it("Givet en adressökning, när anropet byggs, så skickas den vidare oförändrad", () => {
    const r = adapterFor(edp).request(edp, "SearchAdress", {
      search: "?searchText=Storgatan", method: "POST", body: "searchText=Storgatan",
      contentType: "application/x-www-form-urlencoded"
    });
    assert.equal(r.url, edp.base + "/SearchAdress?searchText=Storgatan");
    assert.equal(r.method, "POST");
    assert.equal(r.body, "searchText=Storgatan");
  });

  it("Givet ett schemasvar, när det normaliseras, så lämnas det orört", () => {
    const svar = '{"RhServices":[{"WasteType":"Kärl 1","NextWastePickup":"2026-08-10"}]}';
    assert.equal(adapterFor(edp).normalize("GetWastePickupSchedule", svar), svar);
  });
});

describe("Egenskap: EXDE-tjänster översätts till appens form", () => {
  const exde = { kind: "exde", base: "https://exempel.invalid/api/api/external" };

  it("Givet en adressökning, när anropet byggs, så blir det en POST med JSON-body", () => {
    const r = adapterFor(exde).request(exde, "SearchAdress", { search: "?searchText=Storgatan", method: "POST" });
    assert.equal(r.url, exde.base + "/autocompleteAllPost/");
    assert.equal(r.method, "POST");
    assert.equal(r.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(r.body), { Address: "Storgatan" });
  });

  it("Givet en lista med adresser, när svaret normaliseras, så ser det ut som EDP:s", () => {
    const svar = JSON.stringify(["STORGATAN 12, LANDSKRONA", "STORGATAN 13, TECKOMATORP"]);
    const ut = JSON.parse(adapterFor(exde).normalize("SearchAdress", svar));
    assert.equal(ut.Succeeded, true);
    assert.deepEqual(ut.Buildings, ["STORGATAN 12, LANDSKRONA", "STORGATAN 13, TECKOMATORP"]);
  });

  it("Givet en schemabegäran, när anropet byggs, så skickas hela adressen som JSON", () => {
    const r = adapterFor(exde).request(exde, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("STORGATAN 12, LANDSKRONA"), method: "GET"
    });
    assert.equal(r.url, exde.base + "/schedulePost/");
    assert.equal(r.method, "POST");
    assert.deepEqual(JSON.parse(r.body), { Address: "STORGATAN 12, LANDSKRONA" });
  });

  it("Givet en lång tömningsserie, när den normaliseras, så blir varje avfallsslag en tjänst med sitt tidigaste datum", () => {
    const svar = JSON.stringify([
      { date: "2026-08-24T00:00:00", typeOfWasteDescription: "Restavfall", containerType: "K190" },
      { date: "2026-08-10T00:00:00", typeOfWasteDescription: "Restavfall", containerType: "K190" },
      { date: "2026-08-11T00:00:00", typeOfWasteDescription: "Matavfall", containerType: "K140" }
    ]);
    const ut = JSON.parse(adapterFor(exde).normalize("GetWastePickupSchedule", svar));
    const rest = ut.RhServices.find(s => s.WasteType === "Restavfall");
    const mat = ut.RhServices.find(s => s.WasteType === "Matavfall");
    // Tidigaste datumet per avfallsslag – inte det första i listan.
    assert.equal(rest.NextWastePickup, "2026-08-10");
    assert.equal(mat.NextWastePickup, "2026-08-11");
    assert.equal(ut.RhServices.length, 2);
  });

  it("Givet passerade tömningar i serien, när den normaliseras, så visas nästa kommande – inte den äldsta", () => {
    // Täby och Ökrab returnerar serier som börjar långt bak i tiden. Utan
    // filter blir "nästa tömning" ett datum som redan varit.
    const svar = JSON.stringify([
      { date: "2026-07-06T00:00:00", typeOfWasteDescription: "Sorterat avfall", containerType: "K370" },
      { date: "2026-08-17T00:00:00", typeOfWasteDescription: "Sorterat avfall", containerType: "K370" },
      { date: "2026-09-14T00:00:00", typeOfWasteDescription: "Sorterat avfall", containerType: "K370" }
    ]);
    const ut = JSON.parse(adapterFor(exde).normalize("GetWastePickupSchedule", svar, { today: "2026-08-04" }));
    assert.equal(ut.RhServices[0].NextWastePickup, "2026-08-17");
  });

  it("Givet att bara passerade tömningar finns, när serien normaliseras, så utelämnas avfallsslaget", () => {
    const svar = JSON.stringify([
      { date: "2026-07-06T00:00:00", typeOfWasteDescription: "Trädgård", containerType: "K370" }
    ]);
    const ut = JSON.parse(adapterFor(exde).normalize("GetWastePickupSchedule", svar, { today: "2026-08-04" }));
    assert.deepEqual(ut.RhServices, []);
  });

  it("Givet ett tomt svar, när det normaliseras, så blir det en tom lista i stället för ett fel", () => {
    assert.deepEqual(JSON.parse(adapterFor(exde).normalize("GetWastePickupSchedule", "[]")).RhServices, []);
    assert.deepEqual(JSON.parse(adapterFor(exde).normalize("SearchAdress", "[]")).Buildings, []);
  });
});

describe("Egenskap: Appbolaget-tjänster översätts till appens form", () => {
  const ab = {
    kind: "appbolaget",
    base: "https://api-universal.appbolaget.se",
    unit: "e34d7050-1b2a-4917-a921-0ea7742d0a6e"
  };

  it("Givet en adressökning, när anropet byggs, så väljs rätt kommun med Unit-headern", () => {
    const r = adapterFor(ab).request(ab, "SearchAdress", { search: "?searchText=Storgatan", method: "POST" });
    assert.equal(r.url, ab.base + "/waste/addresses/search?query=Storgatan");
    assert.equal(r.method, "GET");
    assert.equal(r.headers["Unit"], ab.unit);
    assert.equal(r.headers["Module"], "universal");
  });

  it("Givet sökträffar, när de normaliseras, så får varje adress med sitt id i den form appen redan hanterar", () => {
    // Sökningen ger bara adressens uuid – fastighetsnumret som schemat slås
    // upp på finns inte med, och måste hämtas i ett andra steg.
    const svar = JSON.stringify({ data: [
      { uuid: "abc-123", address: "STORGATAN 1", city: "VINSLÖV", designation: "LOKET 3" }
    ]});
    const ut = JSON.parse(adapterFor(ab).normalize("SearchAdress", svar));
    assert.equal(ut.Succeeded, true);
    // Appen visar adressen utan parentesen och skickar tillbaka hela strängen.
    assert.equal(ut.Buildings[0], "STORGATAN 1, VINSLÖV (abc-123)");
  });

  it("Givet en vald adress, när fastighetsnumret slås upp, så sker det via adressens uuid", async () => {
    const anrop = [];
    const fetchImpl = async (url, opts) => {
      anrop.push({ url, opts });
      return new Response(JSON.stringify({ data: { property_id: "0712403013" } }), { status: 200 });
    };
    const resolved = await adapterFor(ab).resolve(ab, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("STORGATAN 1, VINSLÖV (abc-123)")
    }, { fetchImpl });
    assert.equal(anrop[0].url, ab.base + "/waste/addresses/abc-123");
    assert.equal(anrop[0].opts.headers["Unit"], ab.unit);
    assert.equal(resolved.propertyId, "0712403013");
  });

  it("Givet ett uppslaget fastighetsnummer, när schemat begärs, så används det i sökvägen", () => {
    const r = adapterFor(ab).request(ab, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("STORGATAN 1, VINSLÖV (abc-123)"),
      resolved: { propertyId: "0712403013" }
    });
    assert.equal(r.url, ab.base + "/@universal/waste/properties/0712403013/?unit=" + ab.unit);
  });

  it("Givet tömningar i UTC, när de normaliseras, så blir datumet det svenska dygnet", () => {
    // 22:00 UTC är redan nästa dag i svensk sommartid – tas datumet rakt av
    // ur tidsstämpeln hamnar tömningen en dag fel.
    const svar = JSON.stringify({ data: { services: [
      { code: { code: "KÄRL1", description_verbose: "Fyrfack kärl 1 Plast och Pappersförpackningar" },
        collections: [{ collection_at: "2026-08-10 22:00:00" }] }
    ]}});
    const ut = JSON.parse(adapterFor(ab).normalize("GetWastePickupSchedule", svar, { today: "2026-08-01" }));
    assert.equal(ut.RhServices[0].NextWastePickup, "2026-08-11");
    assert.equal(ut.RhServices[0].WasteType, "Fyrfack kärl 1 Plast och Pappersförpackningar");
  });

  it("Givet en serie med passerade tömningar, när den normaliseras, så visas nästa kommande – inte den första i listan", () => {
    const svar = JSON.stringify({ data: { services: [
      { code: { code: "KÄRL2", description_verbose: "Fyrfack kärl 2" }, collections: [
        { collection_at: "2025-10-15 22:00:00" },
        { collection_at: "2026-08-20 22:00:00" },
        { collection_at: "2026-08-06 22:00:00" }
      ]}
    ]}});
    const ut = JSON.parse(adapterFor(ab).normalize("GetWastePickupSchedule", svar, { today: "2026-08-10" }));
    // 2026-08-06 har passerat och 2025-10-15 likaså; kvar är 20/8 22:00 UTC,
    // vilket är den 21:a i svensk tid.
    assert.equal(ut.RhServices[0].NextWastePickup, "2026-08-21");
  });

  it("Givet en tjänst vars långa namn beskriver en avgift, när den normaliseras, så används det korta namnet", () => {
    // Hässleholms "HRÖRLIG" har description_verbose "Avgift för tömning av
    // fyrfackskärl, helår" – en faktureringsrad, inte ett avfallsslag. Det
    // korta namnet säger vad tömningen faktiskt är.
    const svar = JSON.stringify({ data: { services: [
      { code: { code: "HRÖRLIG", description: "Budad hämtning",
                description_verbose: "Avgift för tömning av fyrfackskärl, helår" },
        collections: [{ collection_at: "2026-08-30 22:00:00" }] }
    ]}});
    const ut = JSON.parse(adapterFor(ab).normalize("GetWastePickupSchedule", svar, { today: "2026-08-10" }));
    assert.equal(ut.RhServices[0].WasteType, "Budad hämtning");
  });

  it("Givet en tjänst utan kommande tömningar, när den normaliseras, så utelämnas den", () => {
    const svar = JSON.stringify({ data: { services: [
      { code: { code: "HRÖRLIG", description_verbose: "Budad hämtning" }, collections: [] }
    ]}});
    assert.deepEqual(JSON.parse(adapterFor(ab).normalize("GetWastePickupSchedule", svar, { today: "2026-08-10" })).RhServices, []);
  });
});

describe("Egenskap: NSR:s enda anrop översätts till appens två steg", () => {
  const nsr = { kind: "nsr", base: "https://nsr.se/api/wastecalendar" };
  // Ett enda sökanrop ger både adressträffar och hela datumserien. Appen
  // frågar i två steg, så samma endpoint anropas två gånger – andra gången
  // för att plocka ut just den valda adressens serie.
  const svar = JSON.stringify({ fp: [
    { id: "abc123", Adress: "Storgatan 1", Ort: "Ekeby", Exec: {
      Datum: ["2026-08-06", "2026-08-13", "2026-08-18", "2026-08-20"],
      AvfallsTyp: ["KÄRL 1", "Trädgårdsavfall", "KÄRL 2", "KÄRL 1"],
      DatumWeek: ["Jämna veckor", "Udda veckor", "Jämna veckor", "Jämna veckor"]
    }},
    { id: "def456", Adress: "Storgatan 1", Ort: "Åstorp", Exec: {
      Datum: ["2026-08-07"], AvfallsTyp: ["KÄRL 1"], DatumWeek: ["Udda veckor"]
    }}
  ]});

  it("Givet en adressökning, när anropet byggs, så frågas sökendpointen", () => {
    const r = adapterFor(nsr).request(nsr, "SearchAdress", { search: "?searchText=Storgatan 1" });
    assert.equal(r.url, nsr.base + "/search?query=Storgatan%201");
    assert.equal(r.method, "GET");
  });

  it("Givet flera orter, när träffarna normaliseras, så skiljs de åt med ort och id", () => {
    const ut = JSON.parse(adapterFor(nsr).normalize("SearchAdress", svar));
    assert.equal(ut.Succeeded, true);
    assert.deepEqual(ut.Buildings, ["Storgatan 1, Ekeby (abc123)", "Storgatan 1, Åstorp (def456)"]);
  });

  it("Givet en vald adress, när schemat begärs, så söks adressen utan id:t", () => {
    const r = adapterFor(nsr).request(nsr, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("Storgatan 1, Ekeby (abc123)")
    });
    assert.equal(r.url, nsr.base + "/search?query=Storgatan%201");
  });

  it("Givet serien för flera adresser, när den normaliseras, så används bara den valda adressens id", () => {
    const ut = JSON.parse(adapterFor(nsr).normalize("GetWastePickupSchedule", svar, {
      today: "2026-08-05",
      params: { search: "?address=" + encodeURIComponent("Storgatan 1, Ekeby (abc123)") }
    }));
    const typer = ut.RhServices.map(s => s.WasteType).sort();
    assert.deepEqual(typer, ["KÄRL 1", "KÄRL 2", "Trädgårdsavfall"]);
    // Tidigaste kommande datum per avfallsslag – KÄRL 1 finns två gånger.
    assert.equal(ut.RhServices.find(s => s.WasteType === "KÄRL 1").NextWastePickup, "2026-08-06");
    assert.equal(ut.RhServices.find(s => s.WasteType === "KÄRL 2").NextWastePickup, "2026-08-18");
  });

  it("Givet passerade datum, när serien normaliseras, så räknas bara det som återstår", () => {
    const ut = JSON.parse(adapterFor(nsr).normalize("GetWastePickupSchedule", svar, {
      today: "2026-08-19",
      params: { search: "?address=" + encodeURIComponent("Storgatan 1, Ekeby (abc123)") }
    }));
    assert.deepEqual(ut.RhServices.map(s => s.WasteType), ["KÄRL 1"]);
    assert.equal(ut.RhServices[0].NextWastePickup, "2026-08-20");
  });

  it("Givet ett id som inte finns i svaret, när schemat normaliseras, så blir listan tom", () => {
    const ut = JSON.parse(adapterFor(nsr).normalize("GetWastePickupSchedule", svar, {
      today: "2026-08-05",
      params: { search: "?address=" + encodeURIComponent("Nygatan 9, Bjuv (saknas)") }
    }));
    assert.deepEqual(ut.RhServices, []);
  });
});

describe("Egenskap: VA SYD översätts till appens form", () => {
  const vasyd = { kind: "vasyd", base: "https://www.vasyd.se/api/sitecore/mypagesapi" };

  it("Givet en adressökning, när anropet byggs, så heter parametern query", () => {
    const r = adapterFor(vasyd).request(vasyd, "SearchAdress", {
      method: "POST", body: "searchText=Storgatan", contentType: "application/x-www-form-urlencoded"
    });
    assert.equal(r.url, vasyd.base + "/buildingaddresssearch");
    assert.equal(r.method, "POST");
    // Alla andra parameternamn ger {"success":false} med HTTP 200.
    assert.equal(new URLSearchParams(r.body).get("query"), "Storgatan");
  });

  it("Givet sökträffar, när de normaliseras, så får varje adress sitt id i parentes", () => {
    const svar = JSON.stringify({ query: "Storgatan", items: [
      { street: "Storgatan 1, Malmö", id: "125040" },
      { street: "Storgatan 2, Arlöv", id: "131172" }
    ]});
    const ut = JSON.parse(adapterFor(vasyd).normalize("SearchAdress", svar));
    assert.deepEqual(ut.Buildings, ["Storgatan 1, Malmö (125040)", "Storgatan 2, Arlöv (131172)"]);
  });

  it("Givet en vald adress, när schemat begärs, så skickas bara id-siffrorna", () => {
    const r = adapterFor(vasyd).request(vasyd, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("Storgatan 1, Malmö (125040)")
    });
    assert.equal(r.url, vasyd.base + "/wastepickupbyaddress");
    // Skickar man adresstexten i stället för id:t får man en tom lista, också med HTTP 200.
    assert.equal(new URLSearchParams(r.body).get("query"), "125040");
  });

  it("Givet ett schemasvar, när det normaliseras, så byter fälten till appens namn", () => {
    const svar = JSON.stringify({ items: [
      { address: "", wasteType: "Restavfall", wastePickupFrequency: "Torsdag jämn vecka ", nextWastePickup: "2026-08-06" }
    ], meta: { success: true, message: null }});
    const ut = JSON.parse(adapterFor(vasyd).normalize("GetWastePickupSchedule", svar));
    assert.equal(ut.RhServices[0].WasteType, "Restavfall");
    assert.equal(ut.RhServices[0].NextWastePickup, "2026-08-06");
    assert.equal(ut.RhServices[0].WastePickupFrequency, "Torsdag jämn vecka");
  });

  it("Givet ett fel som kommer som HTTP 200, när det normaliseras, så blir det tomt i stället för att tolkas som data", () => {
    // VA SYD svarar 200 även när något gick fel – felet står bara i meta.
    const svar = JSON.stringify({ meta: { success: false, message: "Något gick fel" } });
    assert.deepEqual(JSON.parse(adapterFor(vasyd).normalize("GetWastePickupSchedule", svar)).RhServices, []);
    assert.deepEqual(JSON.parse(adapterFor(vasyd).normalize("SearchAdress", svar)).Buildings, []);
  });
});

describe("Egenskap: Stockholms villaschema översätts till appens form", () => {
  const svoa = { kind: "svoa", base: "https://exempel.invalid/nar-kommer-sopbilen" };

  it("Givet en adressökning, när anropet byggs, så frågas autocomplete", () => {
    const r = adapterFor(svoa).request(svoa, "SearchAdress", {
      method: "POST", body: "searchText=Ålstens skogsväg", contentType: "application/x-www-form-urlencoded"
    });
    assert.equal(r.method, "GET");
    assert.equal(new URL(r.url).searchParams.get("query"), "Ålstens skogsväg");
  });

  it("Givet förslagen, när de normaliseras, så blir värdet adressen appen skickar tillbaka", () => {
    const svar = JSON.stringify([
      { value: "Ålstens skogsväg 8, Bromma, 167 63", data: "167 63" },
      { value: "Ålstens skogsväg 10, Bromma, 167 63", data: "167 63" }
    ]);
    const ut = JSON.parse(adapterFor(svoa).normalize("SearchAdress", svar));
    assert.deepEqual(ut.Buildings, ["Ålstens skogsväg 8, Bromma, 167 63", "Ålstens skogsväg 10, Bromma, 167 63"]);
  });

  it("Givet ett schemasvar, när det normaliseras, så blir varje avfallsslag en tjänst", () => {
    // Svaret är ett objekt med avfallsslaget som nyckel, inte en lista.
    const svar = JSON.stringify({
      "Restavfall, villa": [{ FetchFrequency: "1 gång i veckan", ExecutionDate: "2026-08-05", Weekday: "Onsdag" }],
      "Matavfall, villa": [{ FetchFrequency: "Varannan vecka", ExecutionDate: "2026-08-05", Weekday: "Onsdag" }]
    });
    const ut = JSON.parse(adapterFor(svoa).normalize("GetWastePickupSchedule", svar, { today: "2026-08-01" }));
    assert.equal(ut.RhServices.length, 2);
    const rest = ut.RhServices.find(s => s.WasteType === "Restavfall, villa");
    assert.equal(rest.NextWastePickup, "2026-08-05");
    assert.equal(rest.WastePickupFrequency, "1 gång i veckan");
  });

  it("Givet en adress utan villaabonnemang, när svaret normaliseras, så blir det tomt i stället för ett fel", () => {
    // Flerbostadshus ger {} med HTTP 200 – Stockholm har bara villa och radhus.
    assert.deepEqual(JSON.parse(adapterFor(svoa).normalize("GetWastePickupSchedule", "{}")).RhServices, []);
  });
});

describe("Egenskap: Sundsvalls öppna data översätts till appens form", () => {
  const sund = { kind: "sundsvall", base: "https://api.sundsvall.se/Garbage/2281" };

  it("Givet en adressökning, när anropet byggs, så filtreras på gatunamnet", () => {
    const r = adapterFor(sund).request(sund, "SearchAdress", {
      method: "POST", body: "searchText=Trossvägen", contentType: "application/x-www-form-urlencoded"
    });
    // Fel parameternamn ignoreras tyst och ger hela registret på 23 510 poster.
    assert.equal(new URL(r.url).searchParams.get("street"), "Trossvägen");
  });

  it("Givet träffar, när de normaliseras, så bär adressen med sig gata och nummer", () => {
    const svar = JSON.stringify([
      { address: { street: "Trossvägen", houseNumber: "3", city: "Alnö", postalCode: "86533" }, schedules: [] }
    ]);
    const ut = JSON.parse(adapterFor(sund).normalize("SearchAdress", svar));
    assert.deepEqual(ut.Buildings, ["Trossvägen 3, Alnö (Trossvägen|3)"]);
  });

  it("Givet en vald adress, när schemat begärs, så skickas både gata och husnummer", () => {
    const r = adapterFor(sund).request(sund, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("Trossvägen 3, Alnö (Trossvägen|3)")
    });
    const p = new URL(r.url).searchParams;
    assert.equal(p.get("street"), "Trossvägen");
    assert.equal(p.get("houseNumber"), "3");
  });

  it("Givet kodade avfallsslag, när schemat normaliseras, så visas de på svenska", () => {
    const svar = JSON.stringify([{ address: { street: "Trossvägen", houseNumber: "3", city: "Alnö" }, schedules: [
      { nextPickupDate: "2026-09-01", wasteType: "WASTE" },
      { nextPickupDate: "2026-08-18", wasteType: "FOOD" },
      { nextPickupDate: "2026-08-18", wasteType: "PLASTIC" }
    ]}]);
    const ut = JSON.parse(adapterFor(sund).normalize("GetWastePickupSchedule", svar, { today: "2026-08-04" }));
    const typer = ut.RhServices.map(s => s.WasteType).sort();
    assert.deepEqual(typer, ["Matavfall", "Plastförpackningar", "Restavfall"]);
  });

  it("Givet ett okänt avfallsslag, när det normaliseras, så visas koden i stället för att posten tappas", () => {
    const svar = JSON.stringify([{ address: { street: "X", houseNumber: "1", city: "Y" }, schedules: [
      { nextPickupDate: "2026-09-01", wasteType: "NYTT_SLAG" }
    ]}]);
    const ut = JSON.parse(adapterFor(sund).normalize("GetWastePickupSchedule", svar, { today: "2026-08-04" }));
    assert.equal(ut.RhServices[0].WasteType, "NYTT_SLAG");
  });
});

describe("Egenskap: Telge talar samma produkt som EXDE men med annan sökvägsform", () => {
  const thor = { kind: "thorweb", base: "https://exempel.invalid/api/thorweb/garbagecollection" };

  it("Givet en adressökning, när anropet byggs, så läggs söktexten i sökvägen", () => {
    const r = adapterFor(thor).request(thor, "SearchAdress", {
      method: "POST", body: "searchText=Storgatan", contentType: "application/x-www-form-urlencoded"
    });
    // Till skillnad från EXDE:s POST med JSON-body är det här en GET med
    // värdet som ett sökvägssegment.
    assert.equal(r.url, thor.base + "/autocomplete/Storgatan");
    assert.equal(r.method, "GET");
  });

  it("Givet en vald adress, när schemat begärs, så hamnar hela adressen i sökvägen", () => {
    const r = adapterFor(thor).request(thor, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("STORGATAN 67, JÄRNA")
    });
    assert.equal(r.url, thor.base + "/schedule/" + encodeURIComponent("STORGATAN 67, JÄRNA"));
  });

  it("Givet ett schemasvar, när det normaliseras, så behandlas det precis som EXDE:s", () => {
    const svar = JSON.stringify([
      { date: "2026-07-14T00:00:00", typeOfWasteDescription: "Hemsortering", containerType: "K370L1" },
      { date: "2026-08-11T00:00:00", typeOfWasteDescription: "Hemsortering", containerType: "K370L1" }
    ]);
    const ut = JSON.parse(adapterFor(thor).normalize("GetWastePickupSchedule", svar, { today: "2026-08-04" }));
    assert.equal(ut.RhServices[0].WasteType, "Hemsortering");
    assert.equal(ut.RhServices[0].NextWastePickup, "2026-08-11");
  });

  it("Givet en adresslista, när den normaliseras, så blir den appens träfflista", () => {
    const ut = JSON.parse(adapterFor(thor).normalize("SearchAdress", JSON.stringify(["STORGATAN 67, JÄRNA"])));
    assert.deepEqual(ut.Buildings, ["STORGATAN 67, JÄRNA"]);
  });
});

describe("Egenskap: Lumire översätts till appens form", () => {
  const lum = { kind: "lumire", base: "https://exempel.invalid/api/waste-pickup" };

  it("Givet en adressökning, när anropet byggs, så heter parametern q", () => {
    const r = adapterFor(lum).request(lum, "SearchAdress", {
      method: "POST", body: "searchText=Storgatan", contentType: "application/x-www-form-urlencoded"
    });
    assert.equal(new URL(r.url).searchParams.get("q"), "Storgatan");
  });

  it("Givet träffar, när de normaliseras, så bär adressen med sig sitt byggnads-id", () => {
    const svar = JSON.stringify({ addresses: [
      { address: "Storgatan 3, Luleå", buildingId: "1117303" }
    ]});
    const ut = JSON.parse(adapterFor(lum).normalize("SearchAdress", svar));
    assert.deepEqual(ut.Buildings, ["Storgatan 3, Luleå (1117303)"]);
  });

  it("Givet en vald adress, när schemat begärs, så används id:t i sökvägen", () => {
    const r = adapterFor(lum).request(lum, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("Storgatan 3, Luleå (1117303)")
    });
    assert.equal(r.url, lum.base + "/1117303");
  });

  it("Givet tjänster, när de normaliseras, så blir beskrivningen avfallsslaget", () => {
    const svar = JSON.stringify({ data: [
      { description: "Plastförpackningar 660 l", nextPickup: "2026-08-14", isActive: true,
        binType: { code: "K660", container_type: "Kärl", size: "660.00", unit: "L" } }
    ]});
    const ut = JSON.parse(adapterFor(lum).normalize("GetWastePickupSchedule", svar, { today: "2026-08-04" }));
    assert.equal(ut.RhServices[0].WasteType, "Plastförpackningar 660 l");
    assert.equal(ut.RhServices[0].NextWastePickup, "2026-08-14");
    assert.equal(ut.RhServices[0].BinType.Code, "K660");
  });

  it("Givet en avslutad tjänst, när den normaliseras, så utelämnas den", () => {
    const svar = JSON.stringify({ data: [
      { description: "Gammalt abonnemang", nextPickup: "2026-08-14", isActive: false, binType: {} }
    ]});
    assert.deepEqual(JSON.parse(adapterFor(lum).normalize("GetWastePickupSchedule", svar, { today: "2026-08-04" })).RhServices, []);
  });
});

describe("Egenskap: Sysavs rörliga bas-URL slås upp och återanvänds", () => {
  // Sysavs API-adress är en genererad Azure-adress som står i attributet
  // data-api på deras sida. Den kan ändras, så den läses därifrån i stället
  // för att hårdkodas – men bara en gång, inte inför varje anrop.
  const sidHtml = '<div class="waste" data-api="https://ca-xyz.azurecontainerapps.io/api"></div>';

  it("Givet att bas-URL:en inte är känd, när den slås upp, så läses den ur sidans data-api", async () => {
    const anrop = [];
    const fetchImpl = async url => { anrop.push(url); return new Response(sidHtml, { status: 200 }); };
    const sysav = { kind: "sysav", base: "https://exempel.invalid/sysav-1", site: "https://x.invalid/min-sophamtning/" };
    const r = await adapterFor(sysav).resolve(sysav, "SearchAdress", {}, { fetchImpl });
    assert.equal(anrop[0], sysav.site);
    assert.equal(r.apiBase, "https://ca-xyz.azurecontainerapps.io/api");
  });

  it("Givet att bas-URL:en redan slagits upp, när nästa anrop görs, så hämtas sidan inte igen", async () => {
    let hämtningar = 0;
    const fetchImpl = async () => { hämtningar++; return new Response(sidHtml, { status: 200 }); };
    const sysav = { kind: "sysav", base: "https://exempel.invalid/sysav-2", site: "https://x.invalid/min-sophamtning/" };
    await adapterFor(sysav).resolve(sysav, "SearchAdress", {}, { fetchImpl });
    await adapterFor(sysav).resolve(sysav, "GetWastePickupSchedule", {}, { fetchImpl });
    assert.equal(hämtningar, 1, "sidan ska bara hämtas en gång");
  });

  it("Givet en uppslagen bas-URL, när anropen byggs, så används den i stället för den i listan", () => {
    const sysav = { kind: "sysav", base: "https://exempel.invalid/sysav-3", site: "https://x.invalid/" };
    const sök = adapterFor(sysav).request(sysav, "SearchAdress", {
      body: "searchText=Storgatan 10", contentType: "application/x-www-form-urlencoded",
      resolved: { apiBase: "https://ca-xyz.azurecontainerapps.io/api" }
    });
    assert.equal(sök.url, "https://ca-xyz.azurecontainerapps.io/api/PickupSchedules/findbuilding/Storgatan%2010");
    const schema = adapterFor(sysav).request(sysav, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("Storgatan 10, Lomma"),
      resolved: { apiBase: "https://ca-xyz.azurecontainerapps.io/api" }
    });
    assert.equal(schema.url, "https://ca-xyz.azurecontainerapps.io/api/PickupSchedules/foraddress/Storgatan%2010%2C%20Lomma");
  });

  it("Givet ett schemasvar, när det normaliseras, så byter fälten till appens namn", () => {
    const svar = JSON.stringify([
      { nextPickupDate: "2026-08-05", binType: "Kärl", binSize: "370,00", binUnit: "l",
        pickupFrequency: "onsdag", wasteType: "Kärl 1", address: "Storgatan 10, Lomma" }
    ]);
    const ut = JSON.parse(adapterFor({ kind: "sysav" }).normalize("GetWastePickupSchedule", svar, { today: "2026-08-01" }));
    assert.equal(ut.RhServices[0].WasteType, "Kärl 1");
    assert.equal(ut.RhServices[0].NextWastePickup, "2026-08-05");
    assert.equal(ut.RhServices[0].BinType.ContainerType, "Kärl");
  });

  it("Givet en adresslista, när den normaliseras, så blir den appens träfflista", () => {
    const ut = JSON.parse(adapterFor({ kind: "sysav" })
      .normalize("SearchAdress", JSON.stringify(["Storgatan 10, Lomma", "Storgatan 10, Svedala"])));
    assert.deepEqual(ut.Buildings, ["Storgatan 10, Lomma", "Storgatan 10, Svedala"]);
  });
});

describe("Egenskap: Affärsverkens token hämtas anonymt och återanvänds", () => {
  it("Givet att ingen token finns, när en begärs, så hämtas den utan användaruppgifter", async () => {
    const anrop = [];
    const fetchImpl = async (url, opts) => { anrop.push({ url, opts }); return new Response('"jwt-abc"', { status: 200 }); };
    const av = { kind: "affarsverken", base: "https://exempel.invalid/av-1", brand: "Affarsverken" };
    const r = await adapterFor(av).resolve(av, "SearchAdress", {}, { fetchImpl });
    assert.match(anrop[0].url, /\/login\?BrandName=Affarsverken$/);
    assert.equal(anrop[0].opts.method, "POST");
    // Utan Content-Length: 0 svarar tjänsten 411.
    assert.equal(anrop[0].opts.headers["Content-Length"], "0");
    assert.equal(r.token, "jwt-abc");
  });

  it("Givet en redan hämtad token, när nästa anrop görs, så hämtas ingen ny", async () => {
    let inloggningar = 0;
    const fetchImpl = async () => { inloggningar++; return new Response('"jwt-abc"', { status: 200 }); };
    const av = { kind: "affarsverken", base: "https://exempel.invalid/av-2", brand: "Affarsverken" };
    await adapterFor(av).resolve(av, "SearchAdress", {}, { fetchImpl });
    await adapterFor(av).resolve(av, "SearchAdress", {}, { fetchImpl });
    assert.equal(inloggningar, 1);
  });

  it("Givet en token, när anropen byggs, så skickas den som bearer", () => {
    const av = { kind: "affarsverken", base: "https://exempel.invalid/av-3", brand: "Affarsverken" };
    const r = adapterFor(av).request(av, "SearchAdress", {
      body: "searchText=Storgatan", contentType: "application/x-www-form-urlencoded",
      resolved: { token: "jwt-abc" }
    });
    assert.equal(r.headers["Authorization"], "Bearer jwt-abc");
    assert.equal(new URL(r.url).searchParams.get("address"), "Storgatan");
  });

  it("Givet sökträffar, när de normaliseras, så bärs sökkontexten med i parentesen", () => {
    const svar = JSON.stringify([{ address: "Storgatan 4, Fågelmara", buildingId: "9201246749", query: "eyJBZ" }]);
    const ut = JSON.parse(adapterFor({ kind: "affarsverken" }).normalize("SearchAdress", svar));
    // Schemat slås upp på `query`, inte på buildingId.
    assert.deepEqual(ut.Buildings, ["Storgatan 4, Fågelmara (eyJBZ)"]);
  });

  it("Givet tjänster, när de normaliseras, så tas de utan tömningsdatum bort", () => {
    const svar = JSON.stringify({ services: [
      { title: "Matavfall", binSize: 140, binSizeUnit: "L", nextPickup: "2026-08-10", pickupFrequencyDescription: "Måndag udda vecka" },
      { title: "Fyrfack 1", binSize: 0, nextPickup: "", pickupFrequencyDescription: "Var fjärde vecka" }
    ]});
    const ut = JSON.parse(adapterFor({ kind: "affarsverken" }).normalize("GetWastePickupSchedule", svar, { today: "2026-08-01" }));
    assert.equal(ut.RhServices.length, 1);
    assert.equal(ut.RhServices[0].WasteType, "Matavfall");
    assert.equal(ut.RhServices[0].NextWastePickup, "2026-08-10");
  });
});

describe("Egenskap: Indectas kalender läses ur HTML", () => {
  const ind = { kind: "indecta", base: "https://exempel.invalid/kunder/sam/kalender/basfiler" };

  it("Givet en adressökning, när anropet byggs, så heter parametern svar", () => {
    const r = adapterFor(ind).request(ind, "SearchAdress", {
      body: "searchText=" + encodeURIComponent("Storgatan"), contentType: "application/x-www-form-urlencoded"
    });
    // Med `q` – som sidans egen jQuery-plugin antyder – svarar tjänsten 200
    // och noll bytes.
    assert.match(r.url, /laddaadresser\.php\?svar=Storgatan/);
    assert.equal(r.charset, "latin1");
  });

  it("Givet söktext med å ä ö, när anropet byggs, så kodas den som latin1", () => {
    const r = adapterFor(ind).request(ind, "SearchAdress", {
      body: "searchText=" + encodeURIComponent("Åsvägen"), contentType: "application/x-www-form-urlencoded"
    });
    // Tjänsten är ISO-8859-1 hela vägen; UTF-8-kodad å ger ingen träff.
    assert.match(r.url, /svar=%C5sv%E4gen/);
  });

  it("Givet den pipe-separerade träfflistan, när den normaliseras, så blir adress, ort och anläggningsnummer kvar", () => {
    const svar = "Storgatan 10|ANDERSTORP|26215|21598|33432\nStorgatan 11|ANDERSTORP|19900|21180|33432\n";
    const ut = JSON.parse(adapterFor(ind).normalize("SearchAdress", svar));
    assert.deepEqual(ut.Buildings, [
      "Storgatan 10, ANDERSTORP (21598)",
      "Storgatan 11, ANDERSTORP (21180)"
    ]);
  });

  it("Givet en vald adress, när schemat begärs, så delas den upp i gata, ort och nummer", () => {
    const r = adapterFor(ind).request(ind, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("Storgatan 10, ANDERSTORP (21598)")
    });
    assert.match(r.url, /onlinekalender\.php\?/);
    assert.match(r.url, /hsG=Storgatan\+10/);
    assert.match(r.url, /hsO=ANDERSTORP/);
    assert.match(r.url, /nrA=21598/);
  });

  it("Givet årskalendern som HTML, när den läses, så blir varje avfallsslag nästa kommande datum", () => {
    // Dagarna ligger i celler per månad; fyllnadsdagar från intilliggande
    // månader har en egen klass och ska hoppas över, annars hamnar datum i
    // fel månad.
    const dag = (klass, nr, koder) =>
      `<td class="${klass}"><table><tr><td><div class="styleInteIdag">${nr}</div></td></tr></table>` +
      `<table><tr>${koder.map(k => `<td class="${k}"><span>x</span></td>`).join("")}</tr></table></td>`;
    const html = "Juli" + dag("styleDayAll", 6, ["HREST", "HMAT"]) +
      "Augusti" + dag("styleDayPrevNextMonth", 31, ["HREST"]) +
      dag("styleDayAll", 10, ["HREST", "HMAT"]) +
      dag("styleDayAll", 4, ["HPAPP"]) +
      dag("styleDayLor", 21, ["HPLAST-H"]);
    const ut = JSON.parse(adapterFor(ind).normalize("GetWastePickupSchedule", html, { today: "2026-08-05", year: 2026 }));
    const som = t => (ut.RhServices.find(s => s.WasteType === t) || {}).NextWastePickup;
    assert.equal(som("Restavfall"), "2026-08-10");
    assert.equal(som("Matavfall"), "2026-08-10");
    // Fyllnadsdagen 31 juli i augustiblocket får inte bli 31 augusti.
    assert.equal(ut.RhServices.every(s => s.NextWastePickup !== "2026-08-31"), true);
    // 4 augusti har passerat relativt 5 augusti.
    assert.equal(som("Pappersförpackningar"), undefined);
    // "-H" betyder helgjusterad och är samma avfallsslag.
    assert.equal(som("Plastförpackningar"), "2026-08-21");
  });

  it("Givet Sjöbos variant utan anläggningsnummer, när träffarna normaliseras, så tas de ändå med", () => {
    // Sjöbo kör en äldre mall: träffarna har bara adress och ort, inget
    // anläggningsnummer. SÅM har fem fält, Sjöbo två.
    const ut = JSON.parse(adapterFor(ind).normalize("SearchAdress", "Storgatan 1|Vollsjö\nStorgatan 10|Lövestad\n"));
    assert.deepEqual(ut.Buildings, ["Storgatan 1, Vollsjö", "Storgatan 10, Lövestad"]);
  });

  it("Givet en adress utan anläggningsnummer, när schemat begärs, så utelämnas nrA", () => {
    const r = adapterFor(ind).request(ind, "GetWastePickupSchedule", {
      search: "?address=" + encodeURIComponent("Storgatan 1, Vollsjö")
    });
    assert.match(r.url, /hsG=Storgatan\+1/);
    assert.match(r.url, /hsO=Vollsj%F6/);
    assert.equal(/nrA=/.test(r.url), false);
  });

  it("Givet Sjöbos numrerade fack, när kalendern läses, så visas kärlets egen beteckning", () => {
    // Sjöbo märker cellerna FF1/FF2 i stället för avfallsslag. Numret är vad
    // tjänsten själv säger – vilka fraktioner facken rymmer står ingenstans.
    const dag = (nr, koder) =>
      `<td class="styleDayAll"><table><tr><td><div class="styleInteIdag">${nr}</div></td></tr></table>` +
      `<table><tr>${koder.map(k => `<td class="${k}"><span>x</span></td>`).join("")}</tr></table></td>`;
    const html = "Augusti" + dag(12, ["FF1"]) + dag(26, ["FF2"]);
    const ut = JSON.parse(adapterFor(ind).normalize("GetWastePickupSchedule", html, { today: "2026-08-05", year: 2026 }));
    const som = t => (ut.RhServices.find(s => s.WasteType === t) || {}).NextWastePickup;
    assert.equal(som("Fyrfack 1"), "2026-08-12");
    assert.equal(som("Fyrfack 2"), "2026-08-26");
  });

  it("Givet en kalender utan tömningar, när den normaliseras, så blir listan tom i stället för att kasta", () => {
    assert.deepEqual(JSON.parse(adapterFor(ind).normalize("GetWastePickupSchedule", "<html>Augusti</html>", { today: "2026-08-05", year: 2026 })).RhServices, []);
  });
});

describe("Egenskap: schemat kan hämtas utan att veta leverantör", () => {
  it("Givet en kommun och en adress, när schemat hämtas, så kommer det tillbaka i appens form", async () => {
    const edp = { kind: "edp", base: "https://exempel.invalid/FutureWeb/SimpleWastePickup" };
    const anrop = [];
    const fetchImpl = async (url, opts) => {
      anrop.push({ url, opts });
      return new Response('{"RhServices":[{"WasteType":"Matavfall","NextWastePickup":"2026-08-11"}]}',
        { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const data = await fetchSchedule(edp, "Storgatan 1, Orten (123)", { fetchImpl });
    assert.equal(data.RhServices[0].NextWastePickup, "2026-08-11");
    assert.equal(anrop.length, 1);
    assert.match(anrop[0].url, /GetWastePickupSchedule\?address=Storgatan%201/);
  });
});
