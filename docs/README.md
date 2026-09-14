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
| Ledamöter | `personlista/?utformat=json&rdlstatus=tjanstgorande` (med reservfrågor, se nedan) |
| En ledamots röster | `voteringlista/?iid=…&rm=…&sz=10000&utformat=json` |
| Betänkandetitlar | `dokumentlista/?doktyp=bet&rm=…&sz=500&utformat=json` |
| Hela voteringen (349 röster) | `votering/{votering_id}/json` |
| Beslutspunkternas rubriker | `dokumentstatus/{dok_id}.json` |

Svaren parsas defensivt (API:et returnerar objekt i stället för listor vid
enstaka träffar, fältnamn varierar) och cachas i `localStorage` med rimliga
TTL:er så att API:et inte belastas i onödan.

### Vilka räknas som ledamöter?

Att fråga API:et med `rdlstatus=samtida` ger *vår tids* ledamöter – alltså även
avgångna. Appen förlitar sig därför inte på ett enskilt statusvärde, utan
avgör saken utifrån ledamöternas faktiska **kammaruppdrag**: den som har ett
uppdrag som pågår i dag (inget slutdatum, eller ett slutdatum som inte
passerats) sitter i riksdagen. Logiken ligger i `ledamotsfilter.js`, som delas
mellan webbläsaren och Node och täcks av `test/ledamotsfilter.test.js`.

Appen provar frågorna `tjanstgorande` → `tjanst` → `samtliga` → ofiltrerat och
använder den första som ger ett rimligt antal (riksdagen har 349 mandat), så
den fungerar även om ett parameternamn ändras.

### Kontrollera mot skarpa data

```bash
node verify-ledamoter.mjs                     # hela kontrollen
node verify-ledamoter.mjs "Sofia Westergren"  # granska en enskild person
```

Den fullständiga kontrollen kör igenom samma frågor mot riksdagens API, visar
hur många tjänstgörande ledamöter var och en ger, listar antalet per valkrets
och parti och kontrollerar att kända *tidigare* ledamöter inte längre visas.
Avslutar med felkod om något ser orimligt ut.

Persongranskningen hämtar den bredaste listan och skriver ut personens
kammaruppdrag med datum, statustexten och vad filtret svarar – användbart när
någon oväntat dyker upp eller försvinner.

Båda lägena kräver en maskin som når `data.riksdagen.se`. Vid utveckling kan
`RIKSDAG_API` peka mot en mockserver.

## Köra lokalt

```bash
cd docs
python3 -m http.server 8080
# öppna http://localhost:8080
```

Eller deploya mappen rakt av till GitHub Pages/Netlify/valfri statisk host.

### Diagnosläge

`?diagnos=1` visar vad riksdagens API svarade och vad filtret gjorde med
svaret: antal tjänstgörande jämfört med de 349 mandaten, vilken fråga som
valdes, om uppdragsdata följde med i svaret, och statustexten för varje
ledamot i valkretsen. Använd det när någon oväntat dyker upp eller försvinner:

```
https://…/?diagnos=1#valkrets/Västra%20Götalands%20läns%20västra
```

Ser antalet orimligt ut visas dessutom en varning i den vanliga vyn, i stället
för att en felaktig lista presenteras som om den vore korrekt.

### Cacheversion

Ledamotslistan cachas ett dygn i `localStorage`. Nycklarna är versionsmärkta
(`dl2:`) och äldre versioner rensas vid sidladdning – annars skulle
återvändande besökare få gammal, felaktig data kvar efter en rättning. **Höj
`CACHE_VERSION` i `app.js` när en ändring gör tidigare cachad data felaktig.**

### Demoläge

`http://localhost:8080/?demo=1` kör med påhittade exempeldata (fiktiva namn,
slumpade röster) – användbart för utveckling och skärmdumpar när API:et inte
kan nås. En gul banner visar att demoläget är aktivt.

## Kända begränsningar

- Kommun→valkrets-tabellen i `kommuner.js` är kurerad för hand.
- Fältnamnen i riksdagens API är verifierade mot dokumentationen men inte mot
  livesvar från utvecklingsmiljön (utgående trafik till `data.riksdagen.se` är
  blockerad där). Parsern är skriven defensivt och ledamotsfiltret är
  enhetstestat, men kör `node verify-ledamoter.mjs` för att bekräfta mot
  skarpa data.
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

---

# Förändringskartan

**Var flyttade rösterna på sig mellan 2022 och 2026?** `karta.html` är en
interaktiv karta över hela Sverige som färgar varje område efter hur mycket ett
partis andel av rösterna har *förändrats* sedan förra riksdagsvalet:

- **Orange** – partiet har ökat. Ju större ökning, desto kraftigare orange.
- **Lila** – partiet har minskat.
- **Grått** – oförändrat.

Kartan visar alltså inte vem som är störst, utan var något har hänt.

## Nivåer och filter

Tre nivåer, alla från samma underlag:

| Nivå | Antal | Källa |
|---|---|---|
| Region (riksdagsvalkrets) | 29 | Valmyndighetens summa för valkretsen |
| Kommun | 290 | Valmyndighetens summa för kommunen |
| Valdistrikt | 6 626 | Valdistriktets egen resultatfil |

Man kan klicka sig nedåt i kartan (region → kommun → valdistrikt), välja nivå
direkt, filtrera på region och kommun i listorna, eller söka på ett namn.
Zoomning och panorering sker med rullhjul och dragning, och tangentbord fungerar
också när kartan har fokus (piltangenter, `+`, `−`). Läget ligger i adressens
hash, så en vy går att länka till.

Under kartan ligger samma siffror som en sorterbar tabell – både för att kunna
läsa av exakta tal och för att kartan i sig inte är läsbar med skärmläsare.

## Hur områden vägs ihop

Ett områdes förändring är **inte** medelvärdet av delarnas förändringar – då
skulle ett valdistrikt med 200 röster väga lika tungt som ett med 2 000. I
stället summeras rösterna i området och andelen räknas på summan. Varje del får
då en vikt som är proportionell mot sin storlek:

> +2 procentenheter i en krets med 1 000 röstande, tillsammans med ±0 i en annan
> krets med 1 000 röstande, blir +1 procentenhet för de två tillsammans.

Det är exakt vad `summera()` + `forandringParti()` i `kartlogik.js` gör, och det
är det första testfallet i `test/kartlogik.test.js`.

Andelarna räknas på *röster som påverkar mandatfördelningen* (giltiga röster på
anmälda partier), precis som Valmyndighetens egna procenttal. Valdeltagandet –
som också går att färglägga kartan efter – räknas på alla avlagda röster, även
blanka, delat med antalet röstberättigade.

### Varför kommunerna har egna siffror

Valdistrikt ritas om mellan valen. Där gränserna har ändrats finns inga
jämförbara 2022-siffror alls i Valmyndighetens data (`jamforbar: false`, och
2022-kolumnerna är tomma). I valet 2026 gäller det 1 593 av 6 626 distrikt,
varav 314 är uppsamlingsdistrikt utan egen geografi.

Att summera ihop en kommun av sina valdistrikt skulle därför tappa en femtedel
av 2022 års röster – och inte slumpmässigt. I Göteborg blir skillnaden mellan
metoderna 1,6 procentenheter. Kommun- och regionnivån hämtar i stället
Valmyndighetens egen summa för hela området, som täcker alla röster. Ett område
kan alltså vara jämförbart även när flera av dess distrikt inte är det.

De valdistrikt som saknar jämförelse lämnas ofärgade på kartan i stället för att
visas som ±0.

## Färgskalan

Skalan är uträknad i OKLab, så att lika stora steg i förändring ser lika stora ut
för ögat och så att orange och lila har samma ljushet på samma avstånd från noll
– annars ser den ena sidan kraftigare ut än den andra.

Ytterlägena sätts normalt automatiskt: strax ovanför den förändring som nio
tiondelar av landets röstberättigade ligger under, räknat på **hela landet** för
den valda nivån. Att räkna på hela landet i stället för på det man råkar ha på
skärmen är avsiktligt – annars byter färgerna betydelse så fort man zoomar, och
då går områden inte att jämföra. Enstaka extrema småkretsar slår i skalans ände
i stället för att platta ut hela kartan. Ytterlägena går också att låsa till ett
fast värde.

## Bygga om datat

Kartan läser fem färdiga filer ur `docs/valdata/`. De byggs av två skript som
körs för hand när resultatet ändrats – appen själv hämtar ingenting från val.se.

```bash
node bygg-valdata.mjs        # resultat per valdistrikt, kommun och valkrets
node bygg-valgeografi.mjs    # kartgeometri (kräver npx för mapshaper)
node --test                  # kontrollerar att filerna hänger ihop
```

| Fil | Innehåll | Storlek |
|---|---|---|
| `meta.json` | partier, räkningsläge, namn på valkretsar och kommuner | 15 kB |
| `omraden.json` | Valmyndighetens summor för riket, 29 valkretsar, 290 kommuner | 70 kB |
| `valdistrikt.json` | röster per parti och valdistrikt, 2026 och 2022 | 1,3 MB |
| `geografi-valkrets.json` | 29 ytor | 153 kB |
| `geografi-kommun.json` | 290 ytor | 354 kB |
| `geografi-valdistrikt.json` | 6 312 ytor | 2,3 MB |

Bara `meta`, `omraden` och `geografi-valkrets` hämtas vid sidladdning (~70 kB
komprimerat). Kommun- och valdistriktsnivån laddas först när de behövs.

`bygg-valdata.mjs` hämtar en fil per valdistrikt från samma öppna resultatfiler
som `resultat.val.se` själv läser – det är bara på den nivån antalet
röstberättigade och flaggan `jamforbar` finns med. Det blir ungefär 6 900 anrop
och tar några minuter; `--parallellt=6` gör det snällare mot val.se.
`--rakning=S` hämtar det slutliga resultatet i stället för det preliminära.

**Så länge resultatet är preliminärt är kartan det också.** `meta.json` bär med
sig räkningsläget, och sidan visar en banner med hur många distrikt som räknats.
Kör om `bygg-valdata.mjs` när onsdagsräkningen och det slutliga resultatet är
klara.

`bygg-valgeografi.mjs` hämtar Valmyndighetens valdistriktsindelning (en 28 MB
zip med 98 MB GeoJSON i SWEREF 99 TM) och förenklar den med mapshaper.
Kommun- och regiongränserna smälts fram ur valdistrikten, så de tre nivåerna
ligger exakt på varandra. Kartan ritas i SWEREF 99 TM rakt av – projektionen är
gjord för Sverige, så norr är upp utan att något behöver räknas om.

Gränserna är förenklade (120 m för valdistrikt, 400 m för kommuner, 1 000 m för
regioner) för att kartan ska gå att rita i en webbläsare. De duger till att
känna igen ett område, inte till att mäta med.

## Teknik

Samma sak som resten av tjänsten: ingen server, ingen byggkedja i det som
publiceras, inga bibliotek, ingen spårning. `karta.js` avkodar TopoJSON själv
och ritar på en `<canvas>` med cachade `Path2D` per område, med panorering och
zoom som en canvas-transform – hela landets 6 312 valdistrikt ritas om på cirka
16 ms.

Räknandet ligger i `kartlogik.js`, som delas mellan webbläsaren och Node och
täcks av `test/kartlogik.test.js`. `test/valdata.test.js` kontrollerar att de
byggda datafilerna hänger ihop: att varje kommun finns i både siffror och
geometri, att valkretsarna summerar till riket, och att bara
uppsamlingsdistrikten saknar yta.

## Källa

Valmyndigheten, via [öppna data](https://www.val.se/valresultat-och-statistik/statistik-och-data/om-var-oppna-data)
och resultatfilerna bakom [resultat.val.se](https://resultat.val.se/val2026/RD).
Fri att använda med Valmyndigheten som källa.
