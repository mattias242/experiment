# Hämtschema – När töms mitt kärl?

Webapp som visar nästa hämtdag för renhållningen. För Stenungsunds kommun visas
fyrfackssystemet i detalj: om det är **Kärl 1** eller **Kärl 2** som töms, när det
sker, och vilka fraktioner som ligger i respektive fack inför tömningen. För
övriga stödda kommuner visas nästa tömningsdag och vilka fraktioner som töms
den dagen.

## Stödda kommuner

Appen täcker **41 kommuner och avfallsbolag**, alla verifierade mot riktiga adresser
— adressökning och schemahämtning gav korrekta datum (2026-08-04).

De flesta talar EDP FutureWeb-tjänsten "SimpleWastePickup". Tre kommuner nås via
andra plattformar och har var sin adapter i `adapters.js`, som översätter till
och från EDP:s form så att resten av appen inte behöver veta om skillnaden:

| Kommun | Plattform | Not |
|---|---|---|
| Landskrona, Svalöv (LSR), Danderyd, Täby, Simrishamn och Tomelilla (Ökrab) | EXDE Systems (THOR) | Två POST med JSON. Hela tömningsserien returneras, inklusive passerade datum – de sållas bort |
| Hässleholm | Appbolaget universal | Har EDP men bara bakom inloggning. Kräver ett extra uppslag och UTC-datum måste räknas om till svensk tid |
| Helsingborg, Bjuv, Båstad, Höganäs, Åstorp, Ängelholm (NSR) | Eget API | Ett anrop ger både adresser och hela datumserien |

EDP-instanserna:

Ale, Boden, Borås (BEM), Gotland, Herrljunga & Vårgårda (Remondis), Hudiksvall,
June Avfall & Miljö (Jönköping, Habo, Mullsjö), Kiruna, Kramfors, Kretslopp
Sydost (Kalmar, Nybro, Oskarshamn, Torsås, Mörbylånga, Sävsjö, Uppvidinge,
Vetlanda), Kristianstad, Kungälv, Lerum, Lidköping, Ljungby, Ludvika (WBAB),
Lund, Lycksele, Mark, MERAB (Eslöv, Höör, Hörby), Mellerud, Nacka (NVOA), Orust, Oxelösund (Oxelö Energi),
Partille, Piteå, Skellefteå, Sollefteå, SSAM (Växjö, Alvesta, Lessebo, Markaryd,
Tingsryd), Stenungsund, Uppsala (Uppsala vatten), VafabMiljö (Västerås m.fl.),
VIVAB Falkenberg, VIVAB Varberg, Örebro.

De 15 EDP-instanser som tillkom 2026-08-04 kommer från en kartläggning av hur
svenska kommuner exponerar tömningsscheman. Samma anropsmönster gäller för alla,
så de krävde ingen ny kod – bara en rad var i kommunlistan.

Två saker är värda att veta vid felsökning: flera instanser har ett tomt
adressregister för centrala adresser (flerbostadshus utan eget abonnemang), och
gatunamn som "Storgatan" finns inte i alla kommuner. Att ett anrop inte ger
träff betyder alltså inte att instansen är trasig – prova en villaadress till.

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

## Påminnelser i mobilen (ntfy)

Besökare kan få en push kvällen före tömning ("Kärl 2 töms imorgon") via den
egna [ntfy](https://ntfy.sh)-instansen på <https://notify.neomeda.eu>. Flödet:

1. Besökaren trycker **Slå på påminnelser** när schemat visas. Servern
   registrerar adressen (`POST /api/remind`) och svarar med ett slumpat topic
   `hamtning-<id>` – namnet avslöjar inget om adressen, och adressen skickas
   aldrig i någon notis.
2. Appen guidar till ntfy-apparna
   ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy),
   [iPhone](https://apps.apple.com/us/app/ntfy/id1625396347)) och visar vilket
   topic som ska prenumereras på. Ett hushåll med samma adress delar topic.
3. Servern kollar varje halvtimme och skickar påminnelsen efter kl 17 svensk
   tid kvällen före tömning – till adressens topic och till firehosen
   `neomeda-all` (titeln där prefixas "Hämtschema · "). `lastSent` per adress
   hindrar dubbletter.

Konfiguration: lägg `NTFY_TOKEN` i `.env` (se `.env.example`; write-only-token
för ntfy-kontot `hamtning`). Saknas tokenet är påminnelserna tyst avstängda och
resten av appen opåverkad. Prenumerationerna sparas i `data/reminders.json`
(`DATA_DIR` styr katalogen; i Docker monteras `./data`). Lokalt läses `.env`
med `node --env-file=.env server.js`; i Docker sköter compose det.

Samma ntfy-topic (`hamtning`) används för driftlarm: nätverksfel eller 5xx
från en kommuns API ger en notis, dämpad till högst en per kommun och dygn.

## Skydd mot missbruk

API:t (proxyn och `/api/remind`) har en beroendefri per-IP-spärr: 120 anrop/min
för proxyn, 20/min för opt-in, därutöver 429. Nyckeln är det sista
`X-Forwarded-For`-ledet – det enda som skrivits av vår egen nginx och därmed
inte kan förfalskas av klienten (klientskrivna led och `CF-Connecting-IP` kan
spoofas av den som går direkt mot origin-IP:t, och ignoreras). Priset är att
besökare bakom samma Cloudflare-edge delar hink, därav marginalen i gränserna.
Är spärrlistan full av färska nycklar nekas nya nycklar hellre än att minnet
växer. Statiska filer berörs inte. Spärren stoppar loopande skript;
distribuerade angrepp är Cloudflares jobb. Sedan tidigare: endpoint-allowlist,
16 kB-bodytak, 15 s upstream-timeout och max 200 påminnelse-prenumerationer.

## Tester och arbetssätt

Appens beteenden är dokumenterade som BDD-scenarier i [FEATURES.md](FEATURES.md).
Serverbeteendena är körbara med Nodes inbyggda testrigg – inga beroenden:

```sh
node --test
```

Utveckling sker trunk-based enligt TDD: testet skrivs först (RED), minsta
möjliga implementation gör det grönt (GREEN), och varje grönt steg committas
direkt på `main`.

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
