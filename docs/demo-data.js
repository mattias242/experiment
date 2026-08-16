// Påhittade exempeldata för demoläget (?demo=1).
// Används för utveckling och skärmdumpar när riksdagens API inte kan nås.
// Alla namn är fiktiva och alla röster är slumpmässigt hopsatta.
'use strict';

const DEMO_DATA = (() => {
  const VK = 'Västra Götalands läns västra';

  const personer = [
    { id: 'demo1', fornamn: 'Eva', efternamn: 'Exempelsson', parti: 'S', valkrets: VK, bild: '', status: 'Tjänstgörande riksdagsledamot' },
    { id: 'demo2', fornamn: 'Karl', efternamn: 'Testberg', parti: 'M', valkrets: VK, bild: '', status: 'Tjänstgörande riksdagsledamot' },
    { id: 'demo3', fornamn: 'Sara', efternamn: 'Demoqvist', parti: 'SD', valkrets: VK, bild: '', status: 'Tjänstgörande riksdagsledamot' },
    { id: 'demo4', fornamn: 'Johan', efternamn: 'Fiktivsson', parti: 'C', valkrets: VK, bild: '', status: 'Tjänstgörande riksdagsledamot' },
    { id: 'demo5', fornamn: 'Amina', efternamn: 'Provlund', parti: 'V', valkrets: VK, bild: '', status: 'Tjänstgörande riksdagsledamot' },
    { id: 'demo6', fornamn: 'Lars', efternamn: 'Låtsasgren', parti: 'KD', valkrets: VK, bild: '', status: 'Tjänstgörande riksdagsledamot' },
    { id: 'demo7', fornamn: 'Maja', efternamn: 'Mönstermark', parti: 'MP', valkrets: 'Göteborgs kommun', bild: '', status: 'Tjänstgörande riksdagsledamot' },
    { id: 'demo8', fornamn: 'Oskar', efternamn: 'Utkastström', parti: 'L', valkrets: 'Göteborgs kommun', bild: '', status: 'Tjänstgörande riksdagsledamot' },
  ];

  const rm = '2025/26';
  const rad = (votering_id, beteckning, punkt, rost, datum, avser = 'sakfrågan') =>
    ({ votering_id, rm, beteckning, punkt, rost, avser, datum });

  const roster = {
    demo1: [
      rad('v-au4-1', 'AU4', '1', 'Ja', '2026-06-10'),
      rad('v-au4-2', 'AU4', '3', 'Nej', '2026-06-10'),
      rad('v-sou12-1', 'SoU12', '2', 'Ja', '2026-06-04'),
      rad('v-sou12-2', 'SoU12', '5', 'Avstår', '2026-06-04'),
      rad('v-ubu7-1', 'UbU7', '1', 'Nej', '2026-05-28'),
      rad('v-ubu7-2', 'UbU7', '4', 'Nej', '2026-05-28', 'motivfrågan'),
      rad('v-juu9-1', 'JuU9', '2', 'Ja', '2026-05-20'),
      rad('v-fiu21-1', 'FiU21', '1', 'Ja', '2026-05-13'),
      rad('v-mju8-1', 'MJU8', '3', 'Frånvarande', '2026-04-29'),
      rad('v-tu11-1', 'TU11', '1', 'Ja', '2026-04-22'),
      rad('v-sku9-1', 'SkU9', '2', 'Nej', '2026-04-15'),
      rad('v-sfu14-1', 'SfU14', '1', 'Avstår', '2026-04-08'),
      rad('v-ku6-1', 'KU6', '1', 'Ja', '2026-03-25'),
      rad('v-nu10-1', 'NU10', '2', 'Ja', '2026-03-18'),
    ],
  };
  // Övriga demopersoner delar samma voteringar med lite variation.
  for (const p of personer.slice(1)) {
    roster[p.id] = roster.demo1.map((r, i) => ({
      ...r,
      rost: ['Ja', 'Nej', 'Avstår', 'Ja', 'Nej'][(i + p.id.length) % 5],
    }));
  }

  const betTitlar = {
    AU4: { titel: 'Arbetsrätt och arbetsmiljö', dok_id: 'DEMOAU4' },
    SOU12: { titel: 'Vårdköer och tillgänglighet i sjukvården', dok_id: 'DEMOSOU12' },
    UBU7: { titel: 'Skolans arbetsmiljö och studiero', dok_id: 'DEMOUBU7' },
    JUU9: { titel: 'Straffrättsliga frågor', dok_id: 'DEMOJUU9' },
    FIU21: { titel: 'Vårändringsbudget för 2026', dok_id: 'DEMOFIU21' },
    MJU8: { titel: 'Klimatpolitik', dok_id: 'DEMOMJU8' },
    TU11: { titel: 'Järnvägsunderhåll och punktlighet', dok_id: 'DEMOTU11' },
    SKU9: { titel: 'Inkomstbeskattning', dok_id: 'DEMOSKU9' },
    SFU14: { titel: 'Sjukförsäkringen', dok_id: 'DEMOSFU14' },
    KU6: { titel: 'Offentlighet och sekretess', dok_id: 'DEMOKU6' },
    NU10: { titel: 'Elmarknadens utveckling', dok_id: 'DEMONU10' },
  };

  const perPartiExempel = {
    S: { Ja: 92, Nej: 8, 'Avstår': 0, 'Frånvarande': 7 },
    SD: { Ja: 5, Nej: 60, 'Avstår': 2, 'Frånvarande': 6 },
    M: { Ja: 58, Nej: 4, 'Avstår': 0, 'Frånvarande': 6 },
    V: { Ja: 20, Nej: 1, 'Avstår': 0, 'Frånvarande': 3 },
    C: { Ja: 2, Nej: 18, 'Avstår': 1, 'Frånvarande': 3 },
    KD: { Ja: 16, Nej: 0, 'Avstår': 1, 'Frånvarande': 2 },
    MP: { Ja: 1, Nej: 14, 'Avstår': 2, 'Frånvarande': 1 },
    L: { Ja: 13, Nej: 1, 'Avstår': 0, 'Frånvarande': 2 },
  };

  const detaljer = {};
  for (const lista of Object.values(roster)) {
    for (const r of lista) {
      const bet = r.beteckning.toUpperCase();
      detaljer[r.votering_id] ??= {
        perParti: perPartiExempel,
        dok_id: betTitlar[bet]?.dok_id || '',
        titel: betTitlar[bet]?.titel || '',
        organ: bet.replace(/[0-9]+$/, ''),
      };
    }
  }

  const punktRubriker = {
    DEMOAU4: {
      1: { rubrik: 'Skärpta krav på arbetsmiljön i välfärdsyrken', beslut: 'Bifall' },
      3: { rubrik: 'Utredning om förkortad arbetstid', beslut: 'Avslag' },
    },
    DEMOSOU12: {
      2: { rubrik: 'Nationell vårdförmedling för att korta köerna', beslut: 'Bifall' },
      5: { rubrik: 'Höjd ersättning till regionerna', beslut: 'Avslag' },
    },
    DEMOUBU7: {
      1: { rubrik: 'Mobilfri skoltid i grundskolan', beslut: 'Bifall' },
      4: { rubrik: 'Motivering om ordningsomdömen', beslut: 'Avslag' },
    },
  };

  return { personer, roster, betTitlar, detaljer, punktRubriker };
})();
