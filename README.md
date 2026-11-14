# Feest 🎉

Kleine webapp voor feestjes thuis (palmkool.nl). Eén QR voor gasten → landingspagina → muziek aanvragen (Music Assistant Party) en foto's delen (fotospel).

| Pagina | Voor wie | Wat |
|---|---|---|
| `/` | gasten (telefoon, via 4G of wifi) | **wifi-check**: komt de gast via het thuisnetwerk (publiek IP = thuis-IP)? Zo niet → gast-wifi + wachtwoord met kopieerknop + "Ik ben verbonden". Zo ja → knoppen 🎵 Nummer aanvragen / 📸 Foto's delen. |
| `/beheer` | Michiel, **alleen LAN/Tailscale** (nooit via de tunnel) | Party-QR van de tv **scannen** met de telefooncamera, titel, gast-wifi, fotospel-link, muziekspeler instellen. QR van de landingspagina. |
| `/scherm` | tv (TV Bro, fullscreen) | titel, **nu speelt** (via HA), grote QR, plek voor de live fotostream (volgt met fotospel-feestmodus). Live via server-sent events. |

## Draaien
```bash
npm install
npm run dev          # http://localhost:8091  (config in ./data/config.json)
```
Docker (lxc-docker, `/opt/feest`): `docker compose up -d --build`.

## Configuratie
- `data/config.json` – wordt via `/beheer` geschreven (titel, gastSsid, gastWachtwoord, partyUrl, fotospelUrl, mediaPlayer). Niet in git.
- `secrets/ha_token` – optioneel, HA-token (alleen lezen) voor "nu speelt". Niet in git.
- Omgeving: `PUBLIC_URL` (link in de QR, standaard https://feest.palmkool.nl), `HA_URL`, `PORT` (8091), `DATA_DIR`.

## Wifi-check – hoe
Via de Cloudflare-tunnel komt het IP van de gast binnen als `CF-Connecting-IP`. De app haalt elke 10 min het publieke thuis-IP op (ipify). Gelijk (IPv4, of zelfde IPv6-/64) → de gast zit op de thuis- of gast-wifi. Direct op het LAN (privé-IP, zonder tunnel) telt ook als thuis. Een webpagina kan zelf geen wifi verbinden – dat doet de gast.

## Gast-wifi en Music Assistant
- Gasten gebruiken de **gast-wifi** van de KPN Box: die is afgeschermd van het thuisnetwerk (geen toegang tot 192.168.2.x). De wifi-check werkt wel: gast-wifi en thuisnetwerk delen hetzelfde publieke IP.
- Daarom moet de **Party-link van Music Assistant via MA Remote Access** lopen (internet), niet via `music.palmkool.nl` of een 192.168-adres. `/beheer` waarschuwt als de link een thuisadres is.
- Testen vóór een feest: telefoon op de gast-wifi → landingspagina → "Nummer aanvragen" moet de MA Party-pagina openen en een nummer kunnen toevoegen.

## Privacy / veiligheid
- Gast-wifiwachtwoord wordt alleen getoond aan wie de link heeft (bedoeld voor gasten).
- `/beheer` weigert alles wat via de tunnel binnenkomt.
- Geen gegevens van gasten opgeslagen.

## Planning
- [ ] Cloudflare-tunnel: `feest.palmkool.nl` → `http://192.168.2.53:8091` (zelfde tunnel als fotospel).
- [ ] Fotospel feestmodus → fotostream op `/scherm` + feed.
- [ ] Op de tv: TV Bro fullscreen op `/scherm`, HA-script Feestmodus.
