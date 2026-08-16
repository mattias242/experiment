// Avgör vilka personer i riksdagens personlista som faktiskt sitter i riksdagen
// just nu. Delas mellan webbläsaren (index.html) och Node (test + verify.mjs).
// Kör testerna med: node --test
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Ledamotsfilter = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // Riksdagens API returnerar ett ensamt objekt i stället för en lista när det
  // bara finns en träff.
  const somLista = (x) => Array.isArray(x) ? x : (x == null ? [] : [x]);

  const datumdel = (v) => String(v ?? '').slice(0, 10);

  // Kammaruppdrag: organ_kod "kam", rollen riksdagsledamot. Ett uppdrag som
  // saknar slutdatum, eller slutar i framtiden, pågår nu.
  function kammaruppdrag(person) {
    return somLista(person?.personuppdrag?.uppdrag).filter((u) => {
      const roll = String(u?.roll_kod || '').toLowerCase();
      const organ = String(u?.organ_kod || '').toLowerCase();
      return roll.includes('riksdagsledamot') || organ === 'kam';
    });
  }

  function uppdragPagar(u, idag) {
    const tom = datumdel(u?.tom);
    const from = datumdel(u?.from);
    if (from && from > idag) return false;   // ännu inte tillträtt
    if (!tom) return true;                   // löpande uppdrag
    return tom >= idag;
  }

  /**
   * Sitter personen i riksdagen på dagens datum?
   *
   * I första hand avgörs det av personens kammaruppdrag – det är faktiska data
   * och inte beroende av hur vi råkar fråga API:et. Saknas uppdragen (vissa
   * svarsformat utelämnar dem) faller vi tillbaka på statustexten.
   */
  function arTjanstgorande(person, idag) {
    if (!person || !person.intressent_id) return false;
    const dag = datumdel(idag || new Date().toISOString());

    const uppdrag = kammaruppdrag(person);
    if (uppdrag.length) return uppdrag.some((u) => uppdragPagar(u, dag));

    // Fallback när uppdragen inte följde med i svaret. "Tjänstgörande
    // riksdagsledamot", "Ledig", "Ersättare för …" sitter alla i riksdagen nu;
    // en avgången ledamot har blank status eller "Avgången".
    const status = String(person.status || '');
    if (!status) return false;
    if (/avgången|avliden|tidigare\s+riksdagsledamot/i.test(status)) return false;
    return /riksdagsledamot|ersättare|ledig|tjänstgörande/i.test(status);
  }

  /** Plockar ut de tjänstgörande och normaliserar fälten appen behöver. */
  function tjanstgorandeLedamoter(personlistaJson, idag) {
    const personer = somLista(personlistaJson?.personlista?.person);
    return personer
      .filter((p) => arTjanstgorande(p, idag))
      .map((p) => ({
        id: p.intressent_id,
        fornamn: p.tilltalsnamn || p.fornamn || '',
        efternamn: p.efternamn || '',
        parti: String(p.parti || '').toUpperCase(),
        valkrets: p.valkrets || '',
        bild: p.bild_url_192 || p.bild_url_80 || p.bild_url_max || '',
        status: p.status || '',
      }));
  }

  // Riksdagen har 349 mandat. Ligger resultatet långt utanför det har filtret
  // eller API-svaret ändrat sig, och då vill vi hellre veta det än visa fel.
  const MANDAT = 349;
  function rimligtAntal(antal) {
    return antal >= 300 && antal <= 400;
  }

  return { arTjanstgorande, tjanstgorandeLedamoter, rimligtAntal, somLista, MANDAT };
});
