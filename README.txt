Weather Terrain Europe MVP

Fájlok:
- index.html
- cities.json

Futtatás:
1. Csomagold ki a zipet.
2. Tedd az index.html és cities.json fájlt ugyanabba a mappába.
3. Javasolt statikus szerverről indítani, mert sok böngésző file:// módban tiltja a helyi JSON fetch-et.

Egyszerű lokális szerver példák:
- Python: python -m http.server 8000
- VS Code: Live Server extension
- Utána nyisd meg: http://localhost:8000

Megjegyzés:
- cities.json kb. európai/EU fókuszú nagyváros-lista.
- Közelebbi zoomnál az app Overpass API-val is megpróbálja lekérni a látható térképrész településeit.
- Időjárásadat: Open-Meteo, koordináta alapján.
