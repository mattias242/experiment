// BDD-tester för filtret som avgör vilka som sitter i riksdagen just nu.
// Kör: node --test
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  arTjanstgorande, tjanstgorandeLedamoter, rimligtAntal
} = require("../docs/ledamotsfilter.js");

const IDAG = "2026-08-16";

// Hjälpare: bygger en person med ett kammaruppdrag.
const medUppdrag = (id, from, tom, extra = {}) => ({
  intressent_id: id,
  tilltalsnamn: "Test",
  efternamn: "Testsson",
  parti: "S",
  valkrets: "Göteborgs kommun",
  personuppdrag: {
    uppdrag: [{ organ_kod: "kam", roll_kod: "Riksdagsledamot", from, tom }]
  },
  ...extra
});

describe("Egenskap: bara de som sitter i riksdagen nu visas", () => {
  it("Givet ett kammaruppdrag som löper vidare, när listan filtreras, så tas ledamoten med", () => {
    assert.equal(arTjanstgorande(medUppdrag("1", "2022-09-26", "2026-09-21"), IDAG), true);
  });

  it("Givet ett uppdrag utan slutdatum, när listan filtreras, så tas ledamoten med", () => {
    assert.equal(arTjanstgorande(medUppdrag("2", "2022-09-26", ""), IDAG), true);
  });

  it("Givet ett uppdrag som slutade förra mandatperioden, när listan filtreras, så utesluts personen", () => {
    assert.equal(arTjanstgorande(medUppdrag("3", "2014-09-29", "2018-09-24"), IDAG), false);
  });

  it("Givet ett uppdrag som slutade igår, när listan filtreras, så utesluts personen", () => {
    assert.equal(arTjanstgorande(medUppdrag("4", "2022-09-26", "2026-08-15"), IDAG), false);
  });

  it("Givet ett uppdrag som börjar först nästa mandatperiod, när listan filtreras, så utesluts personen", () => {
    assert.equal(arTjanstgorande(medUppdrag("5", "2026-09-22", "2030-09-15"), IDAG), false);
  });

  it("Givet flera uppdrag där ett gammalt och ett pågående blandas, när listan filtreras, så tas ledamoten med", () => {
    const p = medUppdrag("6", "2010-10-04", "2014-09-28");
    p.personuppdrag.uppdrag.push({
      organ_kod: "kam", roll_kod: "Riksdagsledamot", from: "2022-09-26", tom: "2026-09-21"
    });
    assert.equal(arTjanstgorande(p, IDAG), true);
  });
});

// Sofia Westergren (M) satt för Västra Götalands läns västra 2018–2022 men
// inte i nuvarande riksdag. Hon dök upp i valkretslistan med den gamla frågan
// (rdlstatus=samtida) och är därför regressionsfallet för det här filtret.
// Hennes utskottsuppdrag är med i fixturen: de löper delvis utan slutdatum i
// datan och får inte råka tolkas som att hon sitter kvar i kammaren.
describe("Egenskap: Sofia Westergren, ledamot 2018–2022, visas inte i dagens riksdag", () => {
  const westergren = {
    intressent_id: "sofia-westergren",
    tilltalsnamn: "Sofia",
    efternamn: "Westergren",
    parti: "M",
    valkrets: "Västra Götalands läns västra",
    status: "",
    personuppdrag: {
      uppdrag: [
        { organ_kod: "kam", roll_kod: "Riksdagsledamot", from: "2018-09-24", tom: "2022-09-26" },
        { organ_kod: "TU", roll_kod: "Suppleant", from: "2018-10-02", tom: "2019-09-24" },
        { organ_kod: "SkU", roll_kod: "Suppleant", from: "2018-10-02", tom: "" },
        { organ_kod: "FiU", roll_kod: "Suppleant", from: "2019-09-24", tom: "" }
      ]
    }
  };

  it("Givet hennes avslutade kammaruppdrag, när filtret körs, så räknas hon inte som tjänstgörande", () => {
    assert.equal(arTjanstgorande(westergren, IDAG), false);
  });

  it("Givet utskottsuppdrag utan slutdatum, när filtret körs, så håller de henne inte kvar", () => {
    // Utan skyddet mot att utskottsuppdrag räknas som kammaruppdrag skulle
    // SkU- och FiU-raderna ovan se ut som pågående uppdrag.
    const baraUtskott = { ...westergren, personuppdrag: {
      uppdrag: westergren.personuppdrag.uppdrag.filter((u) => u.organ_kod !== "kam")
    } };
    assert.equal(arTjanstgorande(baraUtskott, IDAG), false);
  });

  it("Givet hennes valkrets, när ledamotslistan byggs, så saknas hon bland de sittande", () => {
    const sittande = {
      intressent_id: "sittande-nu", tilltalsnamn: "Nuvarande", efternamn: "Ledamot",
      parti: "M", valkrets: "Västra Götalands läns västra",
      personuppdrag: { uppdrag: [
        { organ_kod: "kam", roll_kod: "Riksdagsledamot", from: "2022-09-26", tom: "2026-09-21" }
      ] }
    };
    const lista = tjanstgorandeLedamoter(
      { personlista: { person: [westergren, sittande] } }, IDAG);
    assert.deepEqual(lista.map((l) => l.efternamn), ["Ledamot"]);
  });

  it("Givet samma person under förra mandatperioden, när filtret körs då, så räknades hon som tjänstgörande", () => {
    // Filtret ska svara på frågan "sitter hen nu", inte "har hen någonsin suttit".
    assert.equal(arTjanstgorande(westergren, "2020-05-01"), true);
  });
});

describe("Egenskap: statustexten används bara när uppdragen saknas", () => {
  const utanUppdrag = (status) => ({
    intressent_id: "x", tilltalsnamn: "A", efternamn: "B", parti: "M", status
  });

  it("Givet en tjänstgörande ledamot utan uppdragsdata, när listan filtreras, så tas hen med", () => {
    assert.equal(arTjanstgorande(utanUppdrag("Tjänstgörande riksdagsledamot"), IDAG), true);
  });

  it("Givet en ersättare utan uppdragsdata, när listan filtreras, så tas hen med", () => {
    assert.equal(arTjanstgorande(utanUppdrag("Ersättare för Anna Andersson"), IDAG), true);
  });

  it("Givet en avgången ledamot utan uppdragsdata, när listan filtreras, så utesluts hen", () => {
    assert.equal(arTjanstgorande(utanUppdrag("Avgången riksdagsledamot"), IDAG), false);
  });

  it("Givet en tidigare ledamot med blank status, när listan filtreras, så utesluts hen", () => {
    assert.equal(arTjanstgorande(utanUppdrag(""), IDAG), false);
  });

  it("Givet uppdragsdata som säger nej men en status som säger ja, när listan filtreras, så vinner uppdraget", () => {
    const p = medUppdrag("7", "2014-09-29", "2018-09-24", { status: "Tjänstgörande riksdagsledamot" });
    assert.equal(arTjanstgorande(p, IDAG), false);
  });
});

describe("Egenskap: hela personlistan normaliseras till appens fält", () => {
  it("Givet ett API-svar med både sittande och avgångna, när det normaliseras, så återstår bara de sittande", () => {
    const svar = {
      personlista: {
        person: [
          medUppdrag("nu", "2022-09-26", "2026-09-21", {
            tilltalsnamn: "Eva", efternamn: "Svensson", parti: "s",
            valkrets: "Malmö kommun", bild_url_192: "https://x/192.jpg"
          }),
          medUppdrag("da", "2010-10-04", "2014-09-28", {
            tilltalsnamn: "Karl", efternamn: "Gammal"
          })
        ]
      }
    };
    const ledamoter = tjanstgorandeLedamoter(svar, IDAG);
    assert.equal(ledamoter.length, 1);
    assert.deepEqual(ledamoter[0], {
      id: "nu", fornamn: "Eva", efternamn: "Svensson", parti: "S",
      valkrets: "Malmö kommun", bild: "https://x/192.jpg", status: ""
    });
  });

  it("Givet ett svar med en enda person som objekt i stället för lista, när det normaliseras, så hanteras det ändå", () => {
    const svar = { personlista: { person: medUppdrag("ensam", "2022-09-26", "2026-09-21") } };
    assert.equal(tjanstgorandeLedamoter(svar, IDAG).length, 1);
  });

  it("Givet ett tomt svar, när det normaliseras, så blir resultatet en tom lista", () => {
    assert.deepEqual(tjanstgorandeLedamoter({}, IDAG), []);
  });
});

describe("Egenskap: ett orimligt antal ledamöter upptäcks", () => {
  it("Givet riksdagens 349 mandat, när antalet kontrolleras, så är det rimligt", () => {
    assert.equal(rimligtAntal(349), true);
  });

  it("Givet att filtret släppt igenom alla som någonsin suttit, när antalet kontrolleras, så flaggas det", () => {
    assert.equal(rimligtAntal(1723), false);
  });

  it("Givet att filtret blivit för strängt, när antalet kontrolleras, så flaggas det", () => {
    assert.equal(rimligtAntal(0), false);
  });
});
