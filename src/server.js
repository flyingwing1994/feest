// Feest – landingspagina (gasten), beheer (Michiel, alleen LAN) en party-scherm (tv).
// Config staat in DATA_DIR/config.json (volume, niet in git). Geen geheimen in de code.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8091);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://feest.palmkool.nl';
const HA_URL = process.env.HA_URL || 'http://192.168.2.51';
const HA_TOKEN_FILE = process.env.HA_TOKEN_FILE || '/secrets/ha_token';
const IP_INTERVAL_MS = 10 * 60 * 1000;
const WIFI_FILE = process.env.WIFI_FILE || '/secrets/gastwifi';      // regel 1 = SSID, regel 2 = wachtwoord (door Michiel geplaatst)
const MA_ENTRY = process.env.MA_CONFIG_ENTRY_ID || '';              // Music Assistant-integratie in HA

const DEFAULTS = {
  titel: 'Feest bij Michiel & Shirley',
  gastSsid: '',
  gastWachtwoord: '',
  partyUrl: '',        // MA Party-link (gescand van de tv in /beheer)
  fotospelUrl: '',     // link naar fotospel (feestmodus)
  mediaPlayer: 'media_player.muziek_serre_beneden',
  verzoekenOpen: false,  // gasten kunnen zelf nummers zoeken + in de wachtrij zetten (via MA)
  perGastPerUur: 4,
};

// ---------- config ----------
function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function saveConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
}
let config = loadConfig();

// Gast-wifi vast ingesteld via secrets-bestand (gaat vóór de instelling in /beheer)
function wifiVast() {
  try {
    const [ssid, wachtwoord] = fs.readFileSync(WIFI_FILE, 'utf8').split(/\r?\n/);
    if (ssid && ssid.trim()) return { ssid: ssid.trim(), wachtwoord: (wachtwoord || '').trim() };
  } catch { /* geen bestand */ }
  return null;
}
const wifi = () => wifiVast() || { ssid: config.gastSsid, wachtwoord: config.gastWachtwoord };

// ---------- thuis-IP (voor de wifi-check) ----------
const home = { v4: null, v6: null, checked: null };
async function refreshHomeIp() {
  for (const [key, url] of [['v4', 'https://api.ipify.org'], ['v6', 'https://api64.ipify.org']]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const ip = (await r.text()).trim();
      if (key === 'v6' && !ip.includes(':')) continue; // geen IPv6 thuis
      home[key] = ip;
    } catch (e) { console.warn(`thuis-IP ${key} ophalen mislukt:`, e.message); }
  }
  home.checked = new Date().toISOString();
}
refreshHomeIp();
setInterval(refreshHomeIp, IP_INTERVAL_MS).unref();

function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
function isPrivate(ip) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) // incl. Tailscale CGNAT
    || ip === '::1' || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip);
}
function v6Prefix64(ip) {
  const parts = ip.split('::')[0].split(':');
  return parts.slice(0, 4).join(':').toLowerCase();
}
function isThuis(req) {
  const ip = clientIp(req);
  if (isPrivate(ip)) return true;                       // direct op het LAN (zonder tunnel)
  if (home.v4 && ip === home.v4) return true;           // via tunnel, zelfde publiek IPv4
  if (home.v6 && ip.includes(':') && v6Prefix64(ip) === v6Prefix64(home.v6)) return true;
  return false;
}
// Beheer alleen vanaf LAN/Tailscale, nooit via de tunnel.
function lanOnly(req, res, next) {
  const viaTunnel = Boolean(req.headers['cf-connecting-ip']);
  if (!viaTunnel && isPrivate(clientIp(req))) return next();
  res.status(403).send('Beheer is alleen bereikbaar vanaf het thuisnetwerk.');
}

// ---------- Home Assistant: nu speelt ----------
let haToken = null;
try { haToken = fs.readFileSync(HA_TOKEN_FILE, 'utf8').trim(); } catch { /* optioneel */ }
let nowPlaying = null;
async function refreshNowPlaying() {
  if (!haToken || !config.mediaPlayer) { nowPlaying = null; return; }
  try {
    const r = await fetch(`${HA_URL}/api/states/${encodeURIComponent(config.mediaPlayer)}`, {
      headers: { Authorization: `Bearer ${haToken}` }, signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) throw new Error(`HA ${r.status}`);
    const s = await r.json();
    const a = s.attributes || {};
    nowPlaying = s.state === 'playing' || s.state === 'paused' ? {
      status: s.state, titel: a.media_title || '', artiest: a.media_artist || '', album: a.media_album_name || '',
      afbeelding: a.entity_picture ? '/api/cover?ts=' + Date.now() : null,
    } : { status: s.state };
    coverPath = a.entity_picture || null;
  } catch (e) { nowPlaying = { status: 'onbekend', fout: e.message }; }
}
let coverPath = null;
setInterval(refreshNowPlaying, 5000).unref();
refreshNowPlaying();

// ---------- Music Assistant (via HA): zoeken + verzoeknummers ----------
const maKlaar = () => Boolean(haToken && MA_ENTRY && config.mediaPlayer);
async function haService(domain, service, data, metAntwoord = false) {
  const r = await fetch(`${HA_URL}/api/services/${domain}/${service}${metAntwoord ? '?return_response' : ''}`, {
    method: 'POST', headers: { Authorization: `Bearer ${haToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data), signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HA ${r.status}`);
  return r.json();
}
const zoekCache = new Map();   // uri -> { item, t }  (alleen gevonden nummers mogen aangevraagd worden)
const verzoeken = [];          // laatste verzoeken { titel, artiest, naam, gast, uri, t }
let laatsteVerzoek = 0, zoekTeller = { minuut: 0, n: 0 };
function opschonen() {
  const grens = Date.now() - 15 * 60 * 1000;
  for (const [k, v] of zoekCache) if (v.t < grens) zoekCache.delete(k);
  while (verzoeken.length > 50) verzoeken.shift();
}
async function zoek(q) {
  const res = await haService('music_assistant', 'search', { config_entry_id: MA_ENTRY, name: q, media_type: ['track'], limit: 12 }, true);
  const tracks = res?.service_response?.tracks || [];
  return tracks.slice(0, 12).map(t => {
    const item = {
      uri: t.uri, titel: t.name + (t.version ? ` (${t.version})` : ''),
      artiest: (t.artists || []).map(a => a.name).join(', '), album: t.album?.name || '',
      afbeelding: typeof t.image === 'string' && /^https:\/\//.test(t.image) ? t.image : null,
    };
    zoekCache.set(item.uri, { item, t: Date.now() });
    return item;
  });
}
const schoneNaam = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);

// ---------- live updates (server-sent events) voor /scherm ----------
const clients = new Set();
function broadcast() {
  const payload = `data: ${JSON.stringify(screenState())}\n\n`;
  for (const res of clients) res.write(payload);
}
function screenState() {
  return {
    titel: config.titel, nowPlaying, hasParty: Boolean(config.partyUrl), hasFotospel: Boolean(config.fotospelUrl),
    verzoekenOpen: config.verzoekenOpen && maKlaar(),
    verzoeken: verzoeken.slice(-5).reverse().map(({ titel, artiest, naam }) => ({ titel, artiest, naam })),
  };
}
setInterval(broadcast, 5000).unref();

// ---------- app (zonder afhankelijkheden: alleen node:http) ----------
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const send = (res, code, body, type = 'text/plain; charset=utf-8', extra = {}) => { res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(body); };
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
function sendFile(res, name) {
  const file = path.join(PUBLIC_DIR, name);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'nee');
  fs.readFile(file, (err, data) => err ? send(res, 404, 'Niet gevonden') : send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': 'max-age=300' }));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''; req.on('data', c => { raw += c; if (raw.length > 20000) { reject(new Error('te groot')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } });
  });
}
function gastId(req, res) {
  const m = /(?:^|;\s*)gast=([a-f0-9-]{36})/.exec(req.headers.cookie || '');
  if (m) return m[1];
  const id = crypto.randomUUID();
  res.setHeader('Set-Cookie', `gast=${id}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`);
  return id;
}
const lanAllowed = req => !req.headers['cf-connecting-ip'] && isPrivate(clientIp(req));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/status' && req.method === 'GET') {
      const thuis = isThuis(req);
      gastId(req, res);
      return json(res, 200, {
        titel: config.titel, thuis, publicUrl: PUBLIC_URL,
        wifi: thuis ? null : wifi(),
        verzoeken: thuis && config.verzoekenOpen && maKlaar(),
        partyUrl: thuis ? config.partyUrl : null,
        fotospelUrl: config.fotospelUrl || null,
      });
    }
    if (p === '/api/zoek' || p === '/api/verzoek') {
      if (!isThuis(req)) return json(res, 403, { fout: 'Verbind eerst met de feest-wifi.' });
      if (!config.verzoekenOpen || !maKlaar()) return json(res, 403, { fout: 'Verzoeknummers staan (nog) niet open.' });
      const gast = gastId(req, res);
      opschonen();
      if (p === '/api/zoek' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
        if (q.length < 2) return json(res, 400, { fout: 'Typ minstens 2 tekens.' });
        const minuut = Math.floor(Date.now() / 60000);
        if (zoekTeller.minuut !== minuut) zoekTeller = { minuut, n: 0 };
        if (++zoekTeller.n > 60) return json(res, 429, { fout: 'Even rustig aan – probeer het over een minuutje.' });
        try { return json(res, 200, { resultaten: await zoek(q) }); }
        catch (e) { console.warn('zoeken mislukt:', e.message); return json(res, 502, { fout: 'Zoeken lukt nu even niet.' }); }
      }
      if (p === '/api/verzoek' && req.method === 'POST') {
        const body = await readJson(req);
        const gevonden = zoekCache.get(String(body.uri || ''));
        if (!gevonden) return json(res, 400, { fout: 'Zoek het nummer opnieuw.' });
        const nu = Date.now();
        const vanGast = verzoeken.filter(v => v.gast === gast && v.t > nu - 3600e3).length;
        if (vanGast >= config.perGastPerUur) return json(res, 429, { fout: `Je hebt al ${vanGast} nummers aangevraagd dit uur – geef de anderen ook een kans 😉` });
        if (verzoeken.some(v => v.uri === gevonden.item.uri && v.t > nu - 2 * 3600e3)) return json(res, 409, { fout: 'Dit nummer is al aangevraagd!' });
        if (nu - laatsteVerzoek < 5000) return json(res, 429, { fout: 'Druk bezig – probeer het over een paar seconden.' });
        laatsteVerzoek = nu;
        const speelt = nowPlaying?.status === 'playing' || nowPlaying?.status === 'paused';
        try {
          await haService('music_assistant', 'play_media', {
            entity_id: config.mediaPlayer, media_id: gevonden.item.uri, media_type: 'track',
            enqueue: speelt || nowPlaying?.status === 'off' ? 'add' : 'play',
          });
        } catch (e) { console.warn('verzoek mislukt:', e.message); return json(res, 502, { fout: 'Toevoegen lukte niet – probeer het nog eens.' }); }
        const naam = schoneNaam(body.naam);
        verzoeken.push({ ...gevonden.item, naam, gast, t: nu });
        console.log(`verzoek: ${gevonden.item.artiest} – ${gevonden.item.titel}${naam ? ' (' + naam + ')' : ''}`);
        broadcast();
        return json(res, 200, { ok: true });
      }
      return send(res, 404, 'Niet gevonden');
    }
    if (p === '/api/cover') {
      if (!haToken || !coverPath) return send(res, 404, '');
      try {
        const r = await fetch(`${HA_URL}${coverPath}`, { headers: { Authorization: `Bearer ${haToken}` }, signal: AbortSignal.timeout(4000) });
        return send(res, 200, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') || 'image/jpeg', { 'Cache-Control': 'max-age=30' });
      } catch { return send(res, 502, ''); }
    }
    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(screenState())}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/beheer' || p.startsWith('/api/beheer/')) {
      if (!lanAllowed(req)) return send(res, 403, 'Beheer is alleen bereikbaar vanaf het thuisnetwerk.');
      if (p === '/beheer') return sendFile(res, 'beheer.html');
      if (p === '/api/beheer/config' && req.method === 'GET') return json(res, 200, { config: { ...config, gastWachtwoord: config.gastWachtwoord ? '••••' : '' }, home, publicUrl: PUBLIC_URL, haGekoppeld: Boolean(haToken), maKlaar: maKlaar(), wifiVast: wifiVast() ? { ssid: wifiVast().ssid } : null, verzoeken: verzoeken.slice(-20).reverse().map(({ titel, artiest, naam, t }) => ({ titel, artiest, naam, t })) });
      if (p === '/api/beheer/config' && req.method === 'POST') {
        const body = await readJson(req);
        const next = { ...config };
        for (const k of Object.keys(DEFAULTS)) if (typeof DEFAULTS[k] === 'string' && typeof body[k] === 'string') next[k] = body[k].trim().slice(0, 500);
        if (body.gastWachtwoord === '••••') next.gastWachtwoord = config.gastWachtwoord; // ongewijzigd
        if (typeof body.verzoekenOpen === 'boolean') next.verzoekenOpen = body.verzoekenOpen;
        if (body.perGastPerUur !== undefined) next.perGastPerUur = Math.min(20, Math.max(1, parseInt(body.perGastPerUur, 10) || DEFAULTS.perGastPerUur));
        for (const k of ['partyUrl', 'fotospelUrl']) if (next[k] && !/^https?:\/\//.test(next[k])) return json(res, 400, { fout: `${k} moet met http(s):// beginnen` });
        config = next; saveConfig(config); refreshNowPlaying().then(broadcast);
        broadcast(); return json(res, 200, { ok: true });
      }
      return send(res, 404, 'Niet gevonden');
    }
    if (p === '/scherm') return sendFile(res, 'scherm.html');
    if (p === '/gezond' || p === '/metrics') return send(res, 200, 'feest_up 1\n');
    if (p === '/' ) return sendFile(res, 'index.html');
    if (p === '/verzoek') return sendFile(res, 'verzoek.html');
    if (/^\/[\w.-]+\.(css|js|svg|png|ico)$/.test(p)) return sendFile(res, p.slice(1));
    return send(res, 404, 'Niet gevonden');
  } catch (e) {
    console.error(e); return send(res, 500, 'Er ging iets mis');
  }
});

server.listen(PORT, () => console.log(`feest draait op :${PORT} (publiek: ${PUBLIC_URL}, HA ${haToken ? 'gekoppeld' : 'niet gekoppeld'}, MA ${MA_ENTRY ? 'ingesteld' : 'niet ingesteld'}, wifi ${wifiVast() ? 'vast' : 'via beheer'})`));
