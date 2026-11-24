# Feest 🎉

Kleine webapp voor feestjes thuis (palmkool.nl). Eén QR voor gasten → landingspagina → muziek aanvragen (Music Assistant Party) en foto's delen (fotospel).

| Pagina | Voor wie | Wat |
|---|---|---|
| `/` | gasten (telefoon, via 4G of wifi) | **wifi-check**: komt de gast via het thuisnetwerk (publiek IP = thuis-IP)? Zo niet → gast-wifi + wachtwoord met kopieerknop + "Ik ben verbonden". Zo ja → knoppen 🎵 Nummer aanvragen / 📸 Foto's delen. |
| `/verzoek` | gasten **op de (gast-)wifi** | zelf zoeken in Music Assistant en een nummer achteraan de wachtrij zetten (met naam op het scherm). |
| `/beheer` | Michiel, **alleen LAN/Tailscale** (nooit via de tunnel) | verzoeken open/dicht + limiet per gast + laatste verzoeken, (optioneel) Party-QR scannen, titel, gast-wifi, fotospel-link, muziekspeler instellen. QR van de landingspagina. |
| `/scherm` | tv (TV Bro, fullscreen) | titel, **nu speelt** (via HA), grote QR, plek voor de live fotostream (volgt met fotospel-feestmodus). Live via server-sent events. |

## Draaien
```bash
npm install
npm run dev          # http://localhost:8091  (config in ./data/config.json)
```
Docker (lxc-docker, `/opt/feest`): `docker compose up -d --build`.

## Werkwijze

Wijzigingen lopen via issue → branch → pull request, volgens de [werkwijze](https://github.com/flyingwing1994/.github/blob/main/WORKFLOW.md). Elke PR krijgt automatisch checks (geheimen, Semgrep, dependencies, Docker-build) en een Claude-review; zonder risicovlag wordt hij daarna automatisch gemerged. Dependabot houdt de Docker-image en de GitHub Actions wekelijks bij.

## Configuratie
- `data/config.json` – wordt via `/beheer` geschreven (titel, gastSsid, gastWachtwoord, partyUrl, fotospelUrl, mediaPlayer). Niet in git.
- `secrets/ha_token` – HA-token van gebruiker **Feest** (geen beheerder) voor "nu speelt" en verzoeknummers. Niet in git.
- `secrets/gastwifi` – optioneel, **vaste gast-wifi**: regel 1 = SSID, regel 2 = wachtwoord. Gaat vóór de instelling in `/beheer`. Niet in git.
- Omgeving: `PUBLIC_URL` (link in de QR, standaard https://feest.palmkool.nl), `HA_URL`, `MA_CONFIG_ENTRY_ID` (Music Assistant-integratie in HA), `PORT` (8091), `DATA_DIR`.

## Wifi-check – hoe
Via de Cloudflare-tunnel komt het IP van de gast binnen als `CF-Connecting-IP`. De app haalt elke 10 min het publieke thuis-IP op (ipify). Gelijk (IPv4, of zelfde IPv6-/64) → de gast zit op de thuis- of gast-wifi. Direct op het LAN (privé-IP, zonder tunnel) telt ook als thuis. Een webpagina kan zelf geen wifi verbinden – dat doet de gast.

## Gast-wifi en Music Assistant
- Gasten gebruiken de **gast-wifi** van de KPN Box: die is afgeschermd van het thuisnetwerk (geen toegang tot 192.168.2.x). De wifi-check werkt wel: gast-wifi en thuisnetwerk delen hetzelfde publieke IP.
- **Verzoeknummers lopen via deze app** (`/verzoek`): de gast praat alleen met `feest.palmkool.nl` (via de tunnel), en de server op het LAN roept in HA `music_assistant.search` en `music_assistant.play_media` (enqueue `add`) aan. Gasten hebben dus geen toegang tot MA of HA nodig.
- Grenzen: alleen als "verzoeken open" aan staat, alleen vanaf de wifi thuis (niet via 4G), alleen nummers uit een eigen zoekresultaat, max. N per gast per uur (cookie), geen dubbele aanvragen binnen 2 uur, max. 1 verzoek per 5 s en 60 zoekopdrachten per minuut in totaal. Vaste speler uit de config.
- Terugval: de MA Party-link (via **MA Remote Access**, niet `music.palmkool.nl`) – alleen gebruikt als verzoeken uit staan.

## Privacy / veiligheid
- Gast-wifiwachtwoord wordt alleen getoond aan wie de link heeft (bedoeld voor gasten).
- `/beheer` weigert alles wat via de tunnel binnenkomt.
- Geen gegevens van gasten op schijf: verzoeken (titel + zelfgekozen naam) staan alleen in het geheugen en verdwijnen bij herstart.
- HA-token hoort bij een eigen gebruiker **Feest** (geen beheerder), zodat het los in te trekken is en acties in het logboek herkenbaar zijn. De app gebruikt alleen: status lezen, `music_assistant.search`, `music_assistant.play_media`.

## Planning
- [ ] Cloudflare-tunnel: `feest.palmkool.nl` → `http://192.168.2.53:8091` (zelfde tunnel als fotospel).
- [ ] Fotospel feestmodus → fotostream op `/scherm` + feed.
- [ ] Op de tv: TV Bro fullscreen op `/scherm`, HA-script Feestmodus.
