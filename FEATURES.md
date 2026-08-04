# Beteenden

Vad appen gör, dokumenterat som BDD-scenarier (Givet/När/Så). Serverbeteendena
är körbara: varje scenario under "Servern" och "Proxyn" motsvarar ett test i
`test/server.test.js`, och scenarierna om kommunlistan motsvarar
`test/providers.test.js` (`node --test`). Övriga UI-beteenden verifieras än så
länge för hand mot livesajten.

## Egenskap: Kommunval

```gherkin
Scenario: Kommunerna listas i bokstavsordning
  Givet att appen stöder 38 kommuner och avfallsbolag
  När besökaren öppnar kommunväljaren
  Så listas alla i svensk bokstavsordning (Ale först, Örebro sist)
  Och en instans som inte kunnat verifieras märks "(otestad)" –
  för närvarande är alla 38 verifierade

Scenario: Kommuner på andra plattformar ser likadana ut för besökaren
  Givet en kommun som inte kör EDP FutureWeb (LSR, Hässleholm, NSR)
  När besökaren söker adress och hämtar schema
  Så översätter en adapter i adapters.js anropet till leverantörens API
  Och svaret normaliseras till EDP:s form innan det når gränssnittet
  Men direktanropet förbi proxyn erbjuds inte – det svaret vore i fel form

Scenario: Senaste valet minns
  Givet att besökaren tidigare valt kommun och adress
  När sidan öppnas igen i samma webbläsare
  Så är kommunen förvald och schemat hämtas direkt för den sparade adressen

Scenario: Kommunlistan står på två ställen men får aldrig glida isär
  Givet att proxyn har sin allowlist i server.js och gränssnittet sin lista i index.html
  När listorna jämförs
  Så innehåller de exakt samma kommuner med exakt samma bas-URL
  Och varje kommun har ett läsbart namn och en människoläsbar källänk
  (annars skulle besökaren kunna välja en kommun som proxyn vägrar)

Scenario: Byte av kommun rensar adressen
  Givet att en adress är ifylld eller ett schema visas
  När besökaren byter kommun i väljaren
  Så töms adressfältet och adressformuläret visas igen med fokus i fältet
  (en adress hör till sin kommun och följer inte med vid byte)
```

## Egenskap: Adressökning

```gherkin
Scenario: En träff går direkt vidare
  Givet att besökaren skrivit en adress som ger exakt en träff
  När sökningen körs
  Så hämtas schemat direkt utan mellansteg

Scenario: Flera träffar ger en vallista
  Givet att adressen finns på flera orter eller anläggningar
  När sökningen körs
  Så får besökaren välja rätt träff i en lista i stället för att appen gissar

Scenario: Anläggningsnumret döljs för besökaren
  Givet att kommunens tjänst svarar med "Storgatan 1, Orten (1502024)"
  När adressen visas i sökfältet, vallistan eller "din adress"-raden
  Så visas den utan numret – det är en API-nyckel, inte information
  Men i vallistan behålls numret när två träffar annars vore identiska

Scenario: Omsökning av sparad adress fungerar
  Givet att sökfältet förifylls med den sparade adressen
  När besökaren söker igen utan att ändra något
  Så ger sökningen träff (kommunens tjänst matchar inte sitt eget
  anläggningsnummer, därför förifylls fältet utan numret)
```

## Egenskap: Nästa tömning

```gherkin
Scenario: Stenungsunds fyrfack får kärldiagrammet
  Givet en Stenungsundsadress med fyrfackskärl
  När schemat hämtats
  Så visas om Kärl 1 eller Kärl 2 töms härnäst, om hur många dagar,
  och vilka fraktioner som ligger i respektive fack

Scenario: Övriga tjänster får den generiska vyn
  Givet en adress i någon annan kommun, eller med annan tjänstetyp
  När schemat hämtats
  Så visas tidigaste kommande tömningsdag och vilka fraktioner som töms då

Scenario: Paketkommunernas fack förklaras
  Givet en adress i Borås ("Kärl 1/2") eller Mark ("Fyrfack 1/2")
  När tjänsten visas
  Så listas fackens innehåll från kommunens egen infosida,
  eftersom EDP-API:et bara anger tjänstens namn
```

## Egenskap: Ärliga statusbesked

```gherkin
Scenario: Lyckade hämtningar är tysta
  Givet att kommunens tjänst svarar
  När datumen visas
  Så visas ingen statusrad alls – källan står i sidfoten, och statusraden
  är reserverad för pågående arbete och problem

Scenario: Fel döljs inte
  Givet att kommunens tjänst inte går att nå
  När besökaren söker
  Så sägs det rakt ut, i stället för att gamla eller gissade datum visas
```

## Egenskap: Påminnelse kvällen före tömning

```gherkin
Scenario: Besökaren slår på påminnelser
  Givet att ett schema visas för en adress
  När besökaren trycker "Slå på påminnelser"
  Så registreras adressen och besökaren guidas att hämta ntfy-appen
  (Android/iPhone) och prenumerera på ett eget slumpat topic hamtning-<id>
  – topicnamnet avslöjar ingenting om adressen

Scenario: Besökaren kan testa sin prenumeration
  Givet att instruktionerna visas med ett registrerat topic
  När besökaren trycker "Skicka en testnotis"
  Så skickas en testnotis till just det topicet som förklarar sig själv
  Men okända topics vägras – endpointen kan inte spamma andras topics

Scenario: Pushen går ut kvällen före
  Givet en registrerad adress med tömning imorgon
  När den halvtimmesvisa kontrollen körs efter kl 17 svensk tid
  Så skickas en notis till adressens topic och till firehosen neomeda-all,
  och samma kväll skickas aldrig någon dubblett

Scenario: Notisen står för sig själv men röjer inget
  Givet en tömning imorgon
  När notisen byggs
  Så säger titeln vad som händer ("Kärl 2 töms imorgon"), bodyn anger dag
  och fraktioner – men adressen skickas aldrig med

Scenario: Utan token är allt tyst avstängt
  Givet att NTFY_TOKEN saknas i miljön
  När appen startar och används
  Så loggas det en gång, inga notiser skickas, och allt annat fungerar som vanligt

Scenario: En trasig kommun-tjänst stoppar inte de andra
  Givet flera registrerade adresser
  När schemat för en adress inte går att hämta
  Så loggas felet och övriga prenumeranter får ändå sina påminnelser
```

## Egenskap: Servern exponerar bara appen

```gherkin
Scenario: Appens filer serveras
  Givet en besökare
  När startsidan eller typsnittet hämtas
  Så levereras de med rätt innehållstyp, och typsnittet cachas som oföränderligt

Scenario: Allt annat vägras
  Givet att serverkod och konfiguration ligger i samma katalog
  När någon försöker hämta dem, eller ta sig utanför webbroten med "../"
  Så blir svaret 404 – bara en explicit allowlist serveras över huvud taget
```

## Egenskap: Proxyn är ingen öppen relästation

```gherkin
Scenario: Kända anrop vidarebefordras
  Givet ett anrop till /api/<kommun>/<endpoint>
  När kommunen finns och endpointet är SearchAdress eller GetWastePickupSchedule
  Så vidarebefordras anropet till kommunens EDP FutureWeb-tjänst
  Och /api/<endpoint> utan kommun antar Stenungsund (äldre klienter)

Scenario: Allt annat stoppas
  Givet ett anrop med okänd kommun, okänt endpoint, extra sökvägssegment
  eller prototypnycklar som "__proto__"
  När proxyn tar emot det
  Så blir svaret 404 och ingenting vidarebefordras

Scenario: Missbruk begränsas
  Givet ett anrop med annan metod än GET/POST, eller en body större än 16 kB
  När proxyn tar emot det
  Så avvisas det med 405 respektive 413
  Och anrop mot en hängande kommun-tjänst avbryts efter 15 sekunder

Scenario: Loopande skript spärras per IP
  Givet ett skript som hamrar API:t från en och samma IP
  När gränsen passeras (120 API-anrop/min, 20 opt-in/min)
  Så blir svaret 429 tills fönstret löpt ut
  Och statiska filer berörs inte, och andra besökares IP:n påverkas inte

Scenario: Spärren går inte att lura med förfalskade headers
  Givet en angripare som skriver egna X-Forwarded-For- eller
  CF-Connecting-IP-headers för att rotera sin identitet
  När anropen når servern
  Så räknas bara det sista XFF-ledet – skrivet av vår egen nginx –
  och är spärrlistan full av färska nycklar nekas nya nycklar
  hellre än att minnet växer

Scenario: Driftlarm när en kommun-tjänst felar
  Givet att en kommuns API ger nätverksfel eller 5xx – i proxyn eller
  i påminnelsekontrollen
  När felet inträffar första gången under dygnet
  Så skickas en notis till hamtning-topicet (och firehosen)
  Men fler fel för samma kommun är dämpade till nästa dygn,
  och 4xx-svar larmar aldrig – okänd adress är inte driftfel
```
