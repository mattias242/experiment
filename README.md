# Hugos skiftschema

Mobilapp (PWA) som visar Hugos nästa arbetspass och om det är dag- eller nattpass.

## Schemat

Hugo tillhör **skiftlag 1**. Schemat är avläst ur 2026 års pappersschema och följer
en **5-veckors rotation** (35 dagar) med ankare **måndag 1 juni 2026**, verifierad
mot juni–september i schemabladet:

| Vecka | Mån | Tis | Ons | Tors | Fre | Lör | Sön |
|-------|-----|-----|-----|------|-----|-----|-----|
| 1 | F | F | – | – | N | N | N |
| 2 | – | – | F | F | – | – | – |
| 3 | – | – | – | – | F | F | F |
| 4 | – | – | N | N | – | – | – |
| 5 | N | N | – | – | – | – | – |

- **F** = dagpass 06:00–18:00 (samma dag)
- **N** = nattpass 18:00–06:00 (slutar nästa dag)

Cykeln upprepas framåt och bakåt i tiden via modulo-räkning, så appen fungerar
även efter 2026 så länge rotationen inte ändras.

## Funktioner

- **Nästa arbetspass** med nedräkning — eller pågående pass med tid kvar
  (ett nattpass som startade igår räknas som pågående fram till 06:00)
- **Kommande pass** grupperade i sammanhängande block
- **Månadskalender** med F/N-markeringar och bläddring
- Ljust och mörkt läge, installerbar på hemskärmen, fungerar offline

## Köra

Statisk sida utan byggsteg — servera mappen med valfri webbserver, t.ex.:

```sh
python3 -m http.server 8000
```

Öppna sedan `http://localhost:8000` i mobilen (eller datorn). För att installera
på hemskärmen: öppna sidan i Safari/Chrome och välj "Lägg till på hemskärmen".
