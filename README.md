# Hämtschema – När töms mitt kärl?

Webapp som visar nästa hämtdag för renhållningen. För Stenungsunds kommun visas
fyrfackssystemet i detalj: om det är **Kärl 1** eller **Kärl 2** som töms, när det
sker, och vilka fraktioner som ligger i respektive fack inför tömningen. För
övriga stödda kommuner visas nästa tömningsdag och vilka fraktioner som töms
den dagen.

## Stödda kommuner

Appen pratar med EDP FutureWeb-tjänsten "SimpleWastePickup" som används av 17
kommuner/avfallsbolag. Verifierat mot riktiga adresser 2026-08-03:

| Status | Kommun/bolag |
|---|---|
| ✅ Verifierade | Stenungsund, Orust, Örebro, Ljungby, Mark, Lycksele, Skellefteå, Borås (BEM), Uppsala (Uppsala vatten), SSAM (Växjö, Alvesta, Lessebo, Markaryd, Tingsryd), Kretslopp Sydost (Kalmar, Nybro, Oskarshamn, Torsås, Mörbylånga, Sävsjö, Uppvidinge, Vetlanda), VafabMiljö (Västerås m.fl.), Herrljunga & Vårgårda (Remondis) |
| ⚠️ Otestade | Boden, Kiruna, Lidköping (nåddes inte från testmiljön – troligen geo-blockering), Nacka/NVOA (brandvägg avvisade testanropen) – samma dokumenterade API, kan fungera från svenska nät |

Roslagsvatten fanns tidigare på EDP-plattformen men svarar nu 404 på alla
kända sökvägar och ingår därför inte.

Testa själv med `node probe-api.js [kommun] [adress]` – utan argument testas
alla instanser med vanliga gatunamn.

## Användning

```
node server.js
```

Öppna sedan <http://localhost:8080>. Välj kommun, skriv in adressen och få nästa
tömningsdatum direkt från källan. Servern proxar anropen till respektive kommuns
EDP FutureWeb-tjänst (`/api/<kommun>/<endpoint>`) — proxyn behövs eftersom
webbläsare annars stoppar anropen (CORS). Ingen npm-installation krävs.

Datumen hämtas live vid varje besök; det finns inget inlagt reservschema. Går
tjänsten inte att nå säger sidan det rakt ut i stället för att visa gamla datum.

## Innehåll

- **Kommun- och adressökning** — välj kommun/bolag, sök adress och hämta aktuella
  datum från respektive webbtjänst. Ger sökningen flera träffar får besökaren
  välja. Senaste valet (kommun + adress) sparas i webbläsarens `localStorage`
  och skickas aldrig vidare.
- **Nästa tömning** — hur många dagar kvar, exakt datum och vad som töms.
  Stenungsundsadresser med fyrfack får kärldiagrammet; allt annat får en
  generisk fraktionslista som fungerar för alla kommuners tjänstetyper
  ("Restavfall", "Fyrfack 1", "Pappersförp." osv).
- **Paketkunskap** — EDP-API:et säger vilken tjänst adressen har men inte vad
  paketen innehåller. För paketkommunerna Borås ("Kärl 1/2") och Mark
  ("Fyrfack 1/2") visar appen därför fackens fraktioner hämtade från respektive
  kommuns egen infosida (borasem.se respektive mark.se, lästa 2026-08-04).
  Övriga kommuner modellerar varje fraktion som egen tjänst i API:et, så där
  behövs ingen extra kunskap.
- **Fyrfacksdiagrammet** (Stenungsund) — kärlet sett uppifrån: insats överst,
  kärldel underst, med fraktionerna på plats.
- **Farligt avfall-boxen** (Stenungsund) — hur den används.

## Kärlen i korthet

| | Kärl 1 (var 4:e vecka) | Kärl 2 (varannan vecka) |
|---|---|---|
| Insats (överst) | Tidningar, metallförpackningar | Ofärgat och färgat glas |
| Kärldel (underst) | Restavfall, plastförpackningar | Matavfall, pappersförpackningar |

Källa: kommunens hämtschema för anläggningen samt stenungsund.se om
fastighetsnära insamling av förpackningar.

## Tillgänglighet

Sidan är byggd mot WCAG 2.2 AA:

- All text når minst 4.5:1 i kontrast i både ljust och mörkt tema; ramar och
  fokusmarkeringar minst 3:1. Kontrollerat maskinellt över alla renderade textnoder.
- Minsta textstorlek 13 px, brödtext 17 px.
- Ingen horisontell scroll vid 320 px bredd (långa fraktionsnamn avstavas).
- Synlig fokusmarkering på allt som går att nå med tangentbord, klickytor ≥ 44 px.
- Riktig rubrikhierarki (h1 → h2 → h3), sökformuläret är ett `search`-landmärke,
  status och fel läses upp via ett `role="status"`-område.
- `prefers-reduced-motion`, `prefers-contrast: more` och Windows högkontrastläge
  respekteras.

## Typsnitt

Rubriker sätts i **Familjen Grotesk** (SIL Open Font License), som ligger
självhostad i `familjen-grotesk.woff2` — inga externa anrop och inga
tredjepartscookies. Saknas filen faller sidan tillbaka på systemets typsnitt.
Brödtexten använder systemtypsnittet, så att besökarens egna textinställningar gäller.
