// Ren logik som delas mellan webbläsaren (index.html laddar filen som ett
// vanligt script → globalen HamtningLogic) och testerna (require i Node).
// Ingenting här får röra DOM, nätverk eller annan omgivning.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HamtningLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Anläggningsnumret sist i kommunens adressträngar ("Storgatan 1, Orten
  // (1502024)") är bara en API-nyckel – för användaren visas adressen utan
  // det. Obs: en ny sökning med numret kvar ger noll träffar, så det får
  // inte hamna i sökfältet.
  function displayAddress(building) {
    return building.replace(/\s*\(\d+\)\s*$/, "");
  }

  // Etiketter för träfflistan: samma adress kan finnas flera gånger med olika
  // anläggningsnummer – bara då visas numret, så att träffarna går att skilja åt.
  function matchLabels(buildings) {
    const labels = buildings.map(displayAddress);
    const seen = {};
    for (const l of labels) { const k = l.toLowerCase(); seen[k] = (seen[k] || 0) + 1; }
    return buildings.map((b, i) => seen[labels[i].toLowerCase()] > 1 ? b : labels[i]);
  }

  // "2026-08-05", "5 aug 2026", "v32" / "Vecka 32" → ISO-datum (måndag för
  // veckoformat). todayStr avgör årtal för veckor utan år; utelämnas den
  // används dagens datum i svensk tid.
  function parsePickupDate(raw, todayStr) {
    if (!raw) return null;
    const s = String(raw).trim();
    const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    const week = s.match(/^[Vv](?:ecka)?\.?\s*(\d{1,2})(?:\s+(\d{4}))?$/);
    if (week) {
      const today = todayStr ||
        new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
      const year = week[2] ? parseInt(week[2], 10) : parseInt(today.slice(0, 4), 10);
      const simple = new Date(Date.UTC(year, 0, 4));
      const monday = new Date(simple);
      monday.setUTCDate(simple.getUTCDate() - ((simple.getUTCDay() + 6) % 7) + (parseInt(week[1], 10) - 1) * 7);
      return monday.toISOString().slice(0, 10);
    }
    const months = { jan:0, feb:1, mar:2, apr:3, maj:4, jun:5, jul:6, aug:7, sep:8, okt:9, nov:10, dec:11 };
    const sv = s.toLowerCase().match(/(\d{1,2})\s+([a-zå]{3})[a-zå]*\s+(\d{4})/);
    if (sv && months[sv[2]] !== undefined) {
      const d = new Date(Date.UTC(parseInt(sv[3], 10), months[sv[2]], parseInt(sv[1], 10)));
      return d.toISOString().slice(0, 10);
    }
    return null;
  }

  function daysBetween(fromStr, toStr) {
    return Math.round((Date.parse(toStr) - Date.parse(fromStr)) / 86400000);
  }

  // BinType är enligt EDP:s API-dokumentation ett objekt {Code, Size, Unit, ContainerType}
  function binTypeText(b) {
    if (!b) return "";
    if (typeof b === "string") return b;
    return [b.ContainerType, b.Code, b.Size && b.Unit ? b.Size + " " + b.Unit : ""].filter(Boolean).join(" ");
  }

  function classifyBin(service) {
    const text = ((service.WasteType || "") + " " + binTypeText(service.BinType) + " " +
                  (service.Fee && service.Fee.Description || "")).toLowerCase();
    if (/k[äa]rl\s*1|fni\s*1|fyrfack\s*1/.test(text)) return "k1";
    if (/k[äa]rl\s*2|fni\s*2|fyrfack\s*2/.test(text)) return "k2";
    return null;
  }

  // Kommunväljaren: alla i svensk bokstavsordning efter etikett.
  function sortProviderKeys(providers) {
    return Object.keys(providers)
      .sort((a, b) => providers[a].label.localeCompare(providers[b].label, "sv"));
  }

  var WEEKDAYS_SV = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
  var MONTHS_SV = ["januari", "februari", "mars", "april", "maj", "juni", "juli",
                   "augusti", "september", "oktober", "november", "december"];

  function svDate(iso) {
    const d = new Date(iso + "T12:00:00Z");
    return WEEKDAYS_SV[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS_SV[d.getUTCMonth()];
  }

  function addDays(iso, n) {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // Notisen kvällen före tömning. Titeln säger vad som händer ("Kärl 2 töms
  // imorgon") och bodyn står för sig själv på en låsskärm. Töms inget imorgon
  // blir det ingen påminnelse alls.
  function reminderFor(services, todayStr) {
    const tomorrow = addDays(todayStr, 1);
    const due = (services || []).filter(s => parsePickupDate(s.NextWastePickup, todayStr) === tomorrow);
    if (!due.length) return null;
    const when = svDate(tomorrow);
    const bins = due.map(classifyBin).filter((b, i, a) => b && a.indexOf(b) === i).sort();
    if (bins.length) {
      const subject = bins.map(b => b === "k1" ? "Kärl 1" : "Kärl 2").join(" och ");
      return { title: subject + " töms imorgon", body: subject + " töms " + when + "." };
    }
    const fractions = due.map(s => s.WasteType || binTypeText(s.BinType) || "Avfall");
    const list = fractions.length > 1
      ? fractions.slice(0, -1).join(", ") + " och " + fractions[fractions.length - 1]
      : fractions[0];
    // Fraktionsnamn som "Plastförp." har egen punkt – undvik dubbelpunkt.
    return {
      title: "Sophämtning imorgon",
      body: (when.charAt(0).toUpperCase() + when.slice(1) + " töms " + list + ".").replace(/\.\.$/, ".")
    };
  }

  return { displayAddress, matchLabels, parsePickupDate, daysBetween, binTypeText, classifyBin, sortProviderKeys, reminderFor };
});
