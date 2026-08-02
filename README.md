# Hämtschema – Näs Byväg 7

Webapp som visar nästa hämtdag för renhållningen (Stenungsunds kommun) och om det
är **Kärl 1** eller **Kärl 2** som töms, samt vilka fraktioner som ingår i respektive
kärl inför tömning.

## Användning

**Med aktuella datum (rekommenderas):**

```
node server.js
```

och öppna <http://localhost:8080>. Servern proxar anrop till kommunens tjänst
["När töms mitt kärl?"](https://www.stenungsund.se/bygga-bo-och-miljo/avfall-och-atervinning/nar-toms-mitt-karl)
(EDP FutureWeb, `futureweb.stenungsund.se`) — skriv in adressen och få nästa
datum för Kärl 1 och Kärl 2 direkt från källan. Proxyn behövs eftersom
webbläsare annars stoppar anropen (CORS). Ingen npm-installation krävs.

**Utan server:** öppna `index.html` direkt i webbläsaren. Appen faller då
tillbaka på det inlagda schemat för Näs Byväg 7 (augusti–december 2026) och
visar tydligt att reservschemat används.

## Innehåll

- **Adressökning** — hämtar aktuella datum från kommunens webbtjänst;
  senast använda adress sparas lokalt i webbläsaren
- **Nästa hämtning** — datum, nedräkning och vilket kärl som ska ställas fram
- **Fraktioner per kärl** — kärldel och insats för både Kärl 1 och Kärl 2
- **Farligt avfall-boxen** — hur den används
- **Inlagt schema 2026** — reserv när tjänsten inte kan nås; passerade datum
  stryks, nästa tömning markeras

## Kärlen i korthet

| | Kärl 1 (var 4:e vecka) | Kärl 2 (varannan vecka) |
|---|---|---|
| Kärldel | Restavfall, plastförpackningar | Matavfall, pappersförpackningar |
| Insats | Tidningar, metallförpackningar | Ofärgat och färgat glas |

Källa: kommunens hämtschema för anläggningen samt stenungsund.se om
fastighetsnära insamling av förpackningar.
