# Beteenden

Vad appen gör, dokumenterat som BDD-scenarier (Givet/När/Så). Serverbeteendena
är körbara: varje scenario under "Servern" och "Proxyn" motsvarar ett test i
`test/server.test.js` (`node --test`). UI-beteendena verifieras än så länge
för hand mot livesajten.

## Egenskap: Kommunval

```gherkin
Scenario: Kommunerna listas i bokstavsordning
  Givet att appen stöder 17 kommuner/avfallsbolag
  När besökaren öppnar kommunväljaren
  Så listas alla i svensk bokstavsordning (Boden först, Örebro sist)
  Och instanser som inte kunnat verifieras är märkta "(otestad)"

Scenario: Senaste valet minns
  Givet att besökaren tidigare valt kommun och adress
  När sidan öppnas igen i samma webbläsare
  Så är kommunen förvald och schemat hämtas direkt för den sparade adressen

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
Scenario: Livedata markeras som live
  Givet att kommunens tjänst svarar
  När datumen visas
  Så anger statusraden vilken källa de hämtats från

Scenario: Fel döljs inte
  Givet att kommunens tjänst inte går att nå
  När besökaren söker
  Så sägs det rakt ut, i stället för att gamla eller gissade datum visas
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
```
