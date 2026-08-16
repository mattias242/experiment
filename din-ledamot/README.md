# Din ledamot

**Så röstar riksdagsledamöterna från din valkrets – förklarat på vanlig svenska.**

En helt statisk webbtjänst som visar hur riksdagens ledamöter röstar, med
medborgaren (inte statsvetaren) som målgrupp:

- **Börja där folk är:** skriv din *kommun* → tjänsten vet vilken av de
  29 riksdagsvalkretsarna du tillhör (inklusive de delade länen Stockholm,
  Skåne och Västra Götaland).
- **Se dina ledamöter:** alla tjänstgörande ledamöter från valkretsen, med
  parti och foto.
- **Frågor du bryr dig om:** voteringarna filtreras på begripliga ämnen
  ("Vård & omsorg", "Skola & utbildning", "Lag & ordning" …) i stället för
  utskottskoder.
- **Begripliga förklaringar:** varje votering förklaras – vad frågan gällde
  (utskottets egen beslutspunktsrubrik), om det var sakfråga eller motivfråga,
  hur hela kammaren och varje parti röstade, och om ledamoten röstade med
  eller emot majoriteten i sitt eget parti.
- **Ärlig om frånvaro:** kvittningssystemet förklaras i stället för att låta
  frånvaro se ut som skolk.

## Teknik

Ingen server, ingen byggkedja, ingen spårning. Tre filer vanilla HTML/CSS/JS.
All data hämtas i besökarens webbläsare direkt från
[riksdagens öppna data](https://data.riksdagen.se), som stöder CORS:

| Data | Endpoint |
|---|---|
| Ledamöter | `personlista/?utformat=json&rdlstatus=samtida` |
| En ledamots röster | `voteringlista/?iid=…&rm=…&sz=10000&utformat=json` |
| Betänkandetitlar | `dokumentlista/?doktyp=bet&rm=…&sz=500&utformat=json` |
| Hela voteringen (349 röster) | `votering/{votering_id}/json` |
| Beslutspunkternas rubriker | `dokumentstatus/{dok_id}.json` |

Svaren parsas defensivt (API:et returnerar objekt i stället för listor vid
enstaka träffar, fältnamn varierar) och cachas i `localStorage` med rimliga
TTL:er så att API:et inte belastas i onödan.

## Köra lokalt

```bash
cd din-ledamot
python3 -m http.server 8080
# öppna http://localhost:8080
```

Eller deploya mappen rakt av till GitHub Pages/Netlify/valfri statisk host.

### Demoläge

`http://localhost:8080/?demo=1` kör med påhittade exempeldata (fiktiva namn,
slumpade röster) – användbart för utveckling och skärmdumpar när API:et inte
kan nås. En gul banner visar att demoläget är aktivt.

## Kända begränsningar

- Kommun→valkrets-tabellen i `kommuner.js` är kurerad för hand.
- Fältnamnen i riksdagens API är verifierade mot dokumentationen men inte mot
  livesvar från just denna miljö (utgående trafik till `data.riksdagen.se` är
  blockerad här). Parsern är skriven defensivt, men första körningen mot
  riktiga API:t bör röktestas – se `TESTING.md`-avsnittet nedan.
- Voteringar utan betänkande i dokumentlistan visas som "Betänkande XX0".
- Statistiken "röstade med/emot sitt parti" beräknas per votering när den
  fälls ut, inte aggregerat (skulle kräva hundratals API-anrop).

## Röktest mot riktiga API:t

1. Öppna sidan utan `?demo=1` och välj en valkrets → ledamöter ska listas
   med foton.
2. Öppna en ledamot → voteringslistan ska fyllas och närvarosiffran vara
   rimlig (~90 %).
3. Fäll ut en votering → partistaplarna ska summera till 349 och
   "Frågan gällde"-rubriken visas för de flesta betänkanden.
4. Kolla konsolen: inga CORS-fel, inga ohanterade undantag.
