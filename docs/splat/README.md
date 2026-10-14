# Splatfönstret

**Ett Gaussian splat som du tittar in i genom mobilen.** Frontkameran följer
ditt huvud och bilden ritas om som om skärmen vore ett fönster: rör på huvudet
så ser du runt hörn och bakom saker, luta dig närmare så ser du mer.

Öppna `docs/splat/index.html` via https (GitHub Pages räcker – kameran fungerar
inte över vanlig http), tryck på **Starta kameran** och håll telefonen framför
dig.

## Så fungerar det

1. **Ansiktet.** MediaPipes ansiktsmodell (Face Landmarker) hittar 478 punkter
   i ansiktet i varje kamerabild. Ögonvrårna ger var ögonen sitter i bilden.
2. **Huvudet i millimeter.** Avståndet mellan ögonen är ungefär 63 mm hos
   vuxna, så hur stort det ser ut i bilden ger hur långt bort huvudet är – och
   därmed hur många millimeter i sidled ett visst antal pixlar motsvarar.
   Djupkomponenten i landmärkena räknas med, så att avståndet inte tycks växa
   när man vrider på huvudet. Kameran antas sitta vid telefonens överkant, och
   läget räknas om när telefonen vrids till liggande.
3. **Utjämning.** Ett 1€-filter tar bort darret när huvudet står still men
   släpper igenom snabba rörelser nästan utan fördröjning. Mellan två
   kamerabilder (30 per sekund) skjuts läget fram längs rörelsen, så att
   skärmen kan rita 60 eller 120 bilder per sekund mjukt.
4. **Fönstret.** Scenen ritas med en sned synpyramid ("off-axis projection")
   från ögat genom skärmens fyra hörn. Skärmens kanter ligger då alltid i
   bildens kanter, medan det som syns innanför dem beror på var ögat är.
   Skärmens fysiska storlek uppskattas ur CSS-pixlarna (ungefär 1/160 tum på
   telefoner).
5. **Splattarna.** Varje splat är en mjuk, halvgenomskinlig ellipsoid. Dess
   tredimensionella kovarians räknas fram en gång när scenen laddas och läggs
   som halvprecision i en heltalstextur, två texlar per splat. Grafikkortet
   projicerar den till en ellips på skärmen med perspektivets jacobian och
   ritar splattarna bakifrån och fram.
6. **Sorteringen** sker i en egen tråd. Eftersom kameran bara flyttas och
   aldrig vrids ändras inte ordningen när huvudet rör sig – den räknas bara om
   när man vrider scenen med fingret.

Kamerabilden stannar i telefonen. Det som hämtas utifrån är MediaPipe-biblioteket
(jsDelivr) och modellfilen (Google), samt de större exempelscenerna (GitHub).

## Scener

| Scen | Källa | Storlek |
|---|---|---|
| Gosedjur (visas först) | `scener/gosedjur.splat` i repot – `Unicorn_Stuffy.ply` ur Babylon.js tillgångsbibliotek, omvandlad till `.splat` (bara färgen rakt fram behålls, därför 1,6 MB i stället för 12) | 49 602 splattar |
| Växter, Legoskalle, Papegoja | `gs_Plants.splat`, `gs_Skull.splat` och `gs_Sqwakers_trimed.splat` ur Babylon.js tillgångsbibliotek, hämtas från GitHub vid en låst version | 5–12 MB |
| Neonrummet | byggs i webbläsaren av `demoscen.js` – ett rum med rutnät, exakt lika stort som skärmen, och planeter på olika djup; månen svävar framför glaset. Visas också om inget kan hämtas | ~45 000 splattar |
| Egen fil | `.splat` (antimatter15:s format) eller `.ply` (formatet från originalkoden för 3DGS, som Polycam, Luma, Postshot och Scaniverse exporterar). Vanliga punktmoln med bara färg fungerar också | – |

De inspelade scenerna kommer från [BabylonJS/Assets](https://github.com/BabylonJS/Assets)
och är licensierade under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
En adress till en egen fil går också att ange: `?url=https://…/fil.splat`
(servern måste tillåta CORS). `?scen=vaxter` öppnar en av de inbyggda scenerna.

Tränade scener har ingen naturlig storlek eller placering, så motivet görs
ungefär lika stort som skärmens kortsida och läggs strax bakom glaset. Mitten
och storleken räknas med medianer, så att lösa "floaters" och himmelssplattar
inte flyttar motivet. Scenerna antas ha COLMAP-axlar (y nedåt, z framåt), vilket
gäller för det mesta som tränats med originalkoden. Står en scen på huvudet
finns **Vänd upp och ned** i inställningarna.

## Gester och inställningar

- Dra med ett finger: vrid scenen. Nyp: ändra storlek. Dubbeltryck: återställ.
- Ett tryck döljer knapparna. Tryck på statusraden för att centrera huvudet –
  det läge huvudet har just då räknas som "rakt framför".
- **Effekt** förstärker huvudrörelsen (1 är fysiskt rätt, 1,5 är förvalt).
- Utan kamera gungar bilden långsamt av sig själv, och på en dator följer den
  muspekaren.

## Begränsningar

- Bara färgen rakt fram används (sfäriska harmoniska av ordning 0). Ljus som
  skiftar med betraktningsvinkeln kommer inte med.
- Komprimerade PLY-filer (SuperSplat/PlayCanvas) och `.spz` stöds inte än.
- Skärmens fysiska storlek och kamerans synfält är uppskattningar. Blir
  rörelsen för stor eller för liten finns **Effekt**-reglaget, och om bilden rör
  sig åt fel håll i sidled finns **Spegelvänd sidledsrörelsen**.

## Filer

| Fil | Innehåll |
|---|---|
| `fonster.js` | matriser, fönsterprojektionen, huvudets läge ur landmärkena, 1€-filtret |
| `splatdata.js` | inläsning av `.splat` och `.ply`, inramning, packning till textur |
| `demoscen.js` | Neonrummet |
| `sortering.js` | djupsorteringen (Web Worker) |
| `renderare.js` | WebGL2-renderaren med skuggarna |
| `sparning.js` | kameran och MediaPipe |
| `app.js` | gränssnitt, gester och bildrutor |

`fonster.js`, `splatdata.js`, `demoscen.js` och `sortering.js` delas med Node
och testas med `node --test` (se `test/splat.test.js`).
