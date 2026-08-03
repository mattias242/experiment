// BDD-tester för den rena UI-logiken i logic.js – delas mellan webbläsaren
// (index.html) och Node. Kör: node --test
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  displayAddress, matchLabels, parsePickupDate, daysBetween,
  binTypeText, classifyBin, sortProviderKeys
} = require("../logic.js");

describe("Egenskap: anläggningsnumret döljs för besökaren", () => {
  it("Givet en adressträng från kommunen, när den visas, så är numret borttaget", () => {
    assert.equal(displayAddress("Storgatan 1, Orten (1502024)"), "Storgatan 1, Orten");
    assert.equal(displayAddress("Hasselbackevägen 6, Stora Höga (61340)"), "Hasselbackevägen 6, Stora Höga");
  });

  it("Givet en adress utan nummer, när den visas, så lämnas den orörd", () => {
    assert.equal(displayAddress("Storgatan 1"), "Storgatan 1");
  });

  it("Givet flera träffar, när två annars vore identiska, så behåller just de numret", () => {
    const buildings = [
      "Storgatan 14, HERRLJUNGA (71000141)",
      "Storgatan 14, Herrljunga (1501665)",
      "Storgatan 5, Herrljunga (1502024)"
    ];
    assert.deepEqual(matchLabels(buildings), [
      "Storgatan 14, HERRLJUNGA (71000141)",
      "Storgatan 14, Herrljunga (1501665)",
      "Storgatan 5, Herrljunga"
    ]);
  });
});

describe("Egenskap: kommunernas datumformat tolkas", () => {
  it("Givet ett ISO-datum någonstans i strängen, när det tolkas, så plockas det ut", () => {
    assert.equal(parsePickupDate("2026-08-05"), "2026-08-05");
    assert.equal(parsePickupDate("Nästa tömning 2026-08-05 kl 07"), "2026-08-05");
  });

  it("Givet ett svenskt datum i klartext, när det tolkas, så blir det ISO", () => {
    assert.equal(parsePickupDate("5 aug 2026"), "2026-08-05");
    assert.equal(parsePickupDate("17 Augusti 2026"), "2026-08-17");
  });

  it("Givet ett veckonummer, när det tolkas, så blir det veckans måndag", () => {
    assert.equal(parsePickupDate("v32", "2026-08-01"), "2026-08-03");
    assert.equal(parsePickupDate("Vecka 1 2026", "2026-08-01"), "2025-12-29");
    assert.equal(parsePickupDate("V15 2025", "2026-08-01"), "2025-04-07");
  });

  it("Givet skräp eller tomt värde, när det tolkas, så blir svaret null", () => {
    assert.equal(parsePickupDate("snart"), null);
    assert.equal(parsePickupDate(""), null);
    assert.equal(parsePickupDate(null), null);
  });
});

describe("Egenskap: dagräkning och kärltexter", () => {
  it("Givet två datum, när avståndet räknas, så blir det hela dagar", () => {
    assert.equal(daysBetween("2026-08-03", "2026-08-05"), 2);
    assert.equal(daysBetween("2026-08-03", "2026-08-03"), 0);
  });

  it("Givet ett BinType-objekt, när det beskrivs, så sätts delarna ihop läsbart", () => {
    assert.equal(binTypeText({ ContainerType: "Kärl", Code: "K370", Size: 370, Unit: "l" }), "Kärl K370 370 l");
    assert.equal(binTypeText("Kärl 2"), "Kärl 2");
    assert.equal(binTypeText(null), "");
  });
});

describe("Egenskap: tjänster klassas som Kärl 1 eller Kärl 2", () => {
  it("Givet en tjänst, när kärlnamnet finns i någon av texterna, så klassas den rätt", () => {
    assert.equal(classifyBin({ WasteType: "Kärl 1" }), "k1");
    assert.equal(classifyBin({ WasteType: "FNI 2" }), "k2");
    assert.equal(classifyBin({ BinType: "Fyrfack 1" }), "k1");
    assert.equal(classifyBin({ Fee: { Description: "Fyrfack 2, villa" } }), "k2");
  });

  it("Givet en tjänst utan kärlnamn, när den klassas, så blir svaret null", () => {
    assert.equal(classifyBin({ WasteType: "Trädgårdsavfall" }), null);
  });
});

describe("Egenskap: kommunerna sorteras i svensk bokstavsordning", () => {
  it("Givet providers med etiketter, när nycklarna sorteras, så följer de etiketternas ordning", () => {
    const providers = {
      orebro: { label: "Örebro kommun" },
      boden: { label: "Bodens kommun" },
      ssam: { label: "SSAM (Växjö m.fl.)" },
      stenungsund: { label: "Stenungsunds kommun" }
    };
    assert.deepEqual(sortProviderKeys(providers), ["boden", "ssam", "stenungsund", "orebro"]);
  });
});
