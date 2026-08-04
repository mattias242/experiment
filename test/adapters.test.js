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
    const kinds = new Set(["edp", "exde", "appbolaget", "nsr"]);
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
