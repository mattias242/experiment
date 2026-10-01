# Kesslereffekten

En liten fristående webapp som visar Kessler-syndromet: objekt studsar runt
innanför en cirkulär bana, och varje tillräckligt hård krock slår loss splitter
som i sin tur kan krocka. Vid tillräcklig täthet går det över i en kedjereaktion.

## Kör

Publicerad på GitHub Pages: <https://mattias242.github.io/experiment/kessler/>

Lokalt går den lika bra: öppna `docs/kessler/index.html` direkt i en webbläsare
– inga beroenden, ingen byggkedja, allt ligger i en fil. (Eller servera mappen
statiskt, t.ex. `npx serve docs/kessler`.)

## Så fungerar simuleringen

Den startar med **två objekt** som skickas mot varandra. Allt annat du ser är
kaskadens eget verk – ingenting sås in i efterhand.

* **Bana** – cirkulär vägg, studs längs normalen med valbar studskoefficient.
* **Krockar** – impulsbaserad lösning med massa ∝ area, plus positionskorrigering
  så objekt inte fastnar i varandra. Bredfas via rutnät, så några hundra objekt
  går i 60 fps.
* **Fragmentering** – om anslagsfarten överstiger fragmentgränsen tas en andel av
  båda objektens area bort och blir ett nytt splitter. Materia försvinner alltså
  inte, den finfördelas. Rörelsemängden i det bortslagna materialet följer med,
  plus en slumpad utkastfart – det är den enda energi som tillförs, och därmed
  det som avgör om kaskaden växer eller ebbar ut.
* **Tak** – under `Objekttak` stannar fragmenteringen; krockarna fortsätter.
* **Massan sätter det verkliga taket.** Eftersom krockar bara finfördelar
  materia kan aldrig fler fragment uppstå än startmassan räcker till: två
  objekt med radie *r* rymmer som mest 2·*r*²/*minsta radie*² fragment. Därför
  är öppningsobjekten stora och skalar med ringen – två små bollar planar ut på
  ett tiotal fragment hur man än vrider på reglagen, medan de nuvarande når
  några hundra på under en minut.

## Reglage

Fragmentgräns, fragmentutbyte, splitterfart, studs, dragning mot centrum
(ger banliknande rörelse) och objekttak. Grafen visar populationen över tid och
statusrutan säger om kaskaden är stabil, växande, eskalerande eller mättad.

Dra i cirkeln för att skjuta in ett objekt (slangbella). `Utlös kaskad` skjuter
in ett snabbt projektil utifrån. Kortkommandon: mellanslag pausar, `R` nollställer,
`A` lägger till tio objekt.
