// BDD-tester för adapterlagret. Kör: node --test
//
// Appen talar EDP FutureWeb internt: adressökning ger {Succeeded, Buildings}
// och schemat ger {RhServices}. Adaptrarna finns för att andra leverantörer
// ska kunna översättas till samma form, så att UI, påminnelser och proxy
// slipper veta vilken leverantör en kommun råkar ha.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { PROVIDERS, adapterFor, fetchSchedule } = require("../adapters.js");

describe("Egenskap: varje kommun vet vilken sorts tjänst den talar med", () => {
  it("Givet kommunlistan, när en kommun slås upp, så har den en känd sort och en bas-URL", () => {
    const kinds = new Set(["edp"]);
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
