# Hämtschema – Stenungsunds kommun

Webapp som visar nästa hämtdag för renhållningen i Stenungsunds kommun: om det är
**Kärl 1** eller **Kärl 2** som töms, när det sker, och vilka fraktioner som ligger
i respektive fack inför tömningen.

## Användning

```
node server.js
```

Öppna sedan <http://localhost:8080>. Servern proxar anrop till kommunens tjänst
["När töms mitt kärl?"](https://www.stenungsund.se/bygga-bo-och-miljo/avfall-och-atervinning/nar-toms-mitt-karl)
(EDP FutureWeb, `futureweb.stenungsund.se`) — skriv in adressen och få nästa datum
för Kärl 1 och Kärl 2 direkt från källan. Proxyn behövs eftersom webbläsare annars
stoppar anropen (CORS). Ingen npm-installation krävs.

Datumen hämtas live vid varje besök; det finns inget inlagt reservschema. Går
tjänsten inte att nå säger sidan det rakt ut i stället för att visa gamla datum.

## Innehåll

- **Adressökning** — hämtar aktuella datum från kommunens webbtjänst. Ger sökningen
  flera träffar får besökaren välja. Senast använda adress sparas i webbläsarens
  `localStorage` och skickas aldrig vidare.
- **Nästa tömning** — vilket kärl, hur många dagar kvar, exakt datum, och för
  adresser utan fyrfack en hänvisning till kommunens egen tjänst i stället för ett fel.
- **Fyrfacksdiagrammet** — kärlet sett uppifrån: insats överst, kärldel underst,
  med fraktionerna på plats. Visas för det kärl som ska tömmas; det andra kärlet
  får ett eget diagram längre ned.
- **Farligt avfall-boxen** — hur den används.

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
