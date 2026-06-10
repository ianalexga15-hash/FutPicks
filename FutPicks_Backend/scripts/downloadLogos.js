'use strict';
/* ═══════════════════════════════════════════════════════════════
   FUTPICKS — downloadLogos.js v3
   Fuentes: ESPN API (logos) + thesportsdb (ligas)
   Sin API key requerida.
   Uso: node scripts/downloadLogos.js
═══════════════════════════════════════════════════════════════ */
const mysql = require('mysql2/promise');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const zlib  = require('zlib');

// ── CONFIG ────────────────────────────────────────────────────────────────
const DB = {
  host: 'localhost', user: 'root',
  password: 'd:ct-&$v2MLzc@C', database: 'FutPicks_DB',
  connectTimeout: 6000,
};
const IMAGES_BASE = path.resolve(__dirname, '../../FutPicks_Frontend/images');
const TEAMS_DIR   = path.join(IMAGES_BASE, 'teams');
const LEAGUES_DIR = path.join(IMAGES_BASE, 'leagues');
const LOG_FILE    = path.join(__dirname, 'download_logos.log');

// ── LOGGING ───────────────────────────────────────────────────────────────
const LOG = [];
function log(msg) { console.log(msg); LOG.push(msg); }
function saveLog() { try { fs.writeFileSync(LOG_FILE, LOG.join('\n'), 'utf8'); } catch {} }

// ── HELPERS ───────────────────────────────────────────────────────────────
const slug  = n => n.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function apiGet(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout,
    }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode))
        return apiGet(res.headers.location, timeout).then(resolve).catch(reject);
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON error')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function downloadBinary(url, dest, timeout = 20000, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout,
    }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode))
        return downloadBinary(res.headers.location, dest, timeout, depth + 1).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── DEFAULT.PNG ───────────────────────────────────────────────────────────
function makeCRC32() {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return buf => { let c = 0xFFFFFFFF; for (const b of buf) c = t[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
}
function createDefaultPNG() {
  const crc32 = makeCRC32();
  const W = 64, H = 64, cx = W / 2, cy = H / 2, r = W / 2 - 4;
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 4); row[0] = 0;
    for (let x = 0; x < W; x++) {
      const b = 1 + x * 4;
      const inside = (x-cx)*(x-cx)+(y-cy)*(y-cy) <= r*r;
      row[b]=55; row[b+1]=55; row[b+2]=65; row[b+3]=inside?200:0;
    }
    rows.push(row);
  }
  const compressed = zlib.deflateSync(Buffer.concat(rows));
  function chunk(type, data) {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
    b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type,'ascii'), data])), 8 + data.length);
    return b;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',compressed), chunk('IEND',Buffer.alloc(0))]);
}

// ── LEAGUES ───────────────────────────────────────────────────────────────
const LEAGUE_MAP = [
  { slug: 'premier_league', tsdbId: '4328', espn: 'eng.1' },
  { slug: 'la_liga',        tsdbId: '4335', espn: 'esp.1' },
  { slug: 'serie_a',        tsdbId: '4332', espn: 'ita.1' },
  { slug: 'bundesliga',     tsdbId: '4331', espn: 'ger.1' },
  { slug: 'ligue_1',        tsdbId: '4334', espn: 'fra.1' },
  { slug: 'liga_mx',        tsdbId: '4350', espn: 'mex.1' },
  { slug: 'eredivisie',     tsdbId: '4337', espn: 'ned.1' },
  { slug: 'primeira_liga',  tsdbId: '4344', espn: 'por.1' },
  { slug: 'mls',            tsdbId: '4346', espn: 'usa.1' },
  { slug: 'brasileirao',    tsdbId: '4351', espn: 'bra.1' },
];

async function downloadLeagues() {
  log('\n══ LIGAS ═══════════════════════════════════════════════════');
  let ok = 0, skip = 0;
  for (const lg of LEAGUE_MAP) {
    const dest = path.join(LEAGUES_DIR, lg.slug + '.png');
    if (fs.existsSync(dest) && fs.statSync(dest).size > 500) { log(`⏭  ${lg.slug}`); skip++; continue; }
    try {
      const data = await apiGet(`https://www.thesportsdb.com/api/v1/json/3/lookupleague.php?id=${lg.tsdbId}`);
      const badge = data?.leagues?.[0]?.strBadge;
      if (!badge) throw new Error('No badge');
      await downloadBinary(badge, dest);
      const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      if (size < 200) throw new Error('Empty');
      log(`✅ ${lg.slug} (${Math.round(size/1024)}KB)`); ok++;
    } catch(e) { log(`❌ ${lg.slug}: ${e.message}`); }
    await sleep(500);
  }
  log(`Ligas: ${ok} nuevas, ${skip} ya existentes\n`);
}

// ── ESPN TEAM MAP ─────────────────────────────────────────────────────────
function normName(n) {
  return (n || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(fc|cf|sc|ac|as|cd|ud|sd|bsc|afc|sfc|cp|rcd|rc)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

async function buildEspnMap() {
  log('Construyendo mapa de logos ESPN...');
  const map = new Map(); // normName → logoUrl
  for (const lg of LEAGUE_MAP) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.espn}/teams?limit=200`;
      const data = await apiGet(url);
      const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
      for (const t of teams) {
        const logoUrl = t.team?.logos?.[0]?.href;
        if (!logoUrl) continue;
        // Guardar con múltiples variantes del nombre
        for (const name of [
          t.team?.displayName,
          t.team?.shortDisplayName,
          t.team?.name,
          t.team?.nickname,
        ]) {
          if (name) map.set(normName(name), logoUrl);
        }
      }
      log(`  ESPN ${lg.espn}: ${teams.length} equipos`);
    } catch(e) { log(`  ❌ ESPN ${lg.espn}: ${e.message}`); }
    await sleep(300);
  }
  log(`Mapa ESPN: ${map.size} entradas`);
  return map;
}

function findLogo(dbName, espnMap) {
  // 1. Intento exacto
  const n = normName(dbName);
  if (espnMap.has(n)) return espnMap.get(n);
  // 2. Buscar si alguna clave del mapa está contenida en el nombre DB o viceversa
  for (const [key, url] of espnMap) {
    if (key.length >= 4 && (n.includes(key) || key.includes(n))) return url;
  }
  // 3. Buscar coincidencia parcial por primera palabra
  const firstWord = n.split(' ')[0];
  if (firstWord.length >= 4) {
    for (const [key, url] of espnMap) {
      if (key.startsWith(firstWord) || key.includes(firstWord)) return url;
    }
  }
  return null;
}

// ── TEAM LOGOS ────────────────────────────────────────────────────────────
async function downloadTeams(dbNames, espnMap) {
  log(`\n══ EQUIPOS (${dbNames.length}) ═══════════════════════════════════════`);
  let ok = 0, skip = 0, notfound = 0, err = 0;
  for (let i = 0; i < dbNames.length; i++) {
    const name = dbNames[i];
    const s    = slug(name);
    const dest = path.join(TEAMS_DIR, s + '.png');
    if (fs.existsSync(dest) && fs.statSync(dest).size > 500) { skip++; continue; }
    const pct = String(Math.round((i / dbNames.length) * 100)).padStart(3);
    const logoUrl = findLogo(name, espnMap);
    if (!logoUrl) {
      process.stdout.write(`[${pct}%] ${name} ... ⚠️  no encontrado\n`);
      LOG.push(`[${pct}%] ${name}: notfound`); notfound++; continue;
    }
    process.stdout.write(`[${pct}%] ${name} ... `);
    try {
      await downloadBinary(logoUrl, dest);
      const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      if (size < 200) { if (fs.existsSync(dest)) fs.unlinkSync(dest); throw new Error('Empty'); }
      process.stdout.write(`✅ (${Math.round(size/1024)}KB)\n`);
      LOG.push(`[${pct}%] ${name}: ok ${Math.round(size/1024)}KB`); ok++;
    } catch(e) {
      if (fs.existsSync(dest)) try { fs.unlinkSync(dest); } catch {}
      process.stdout.write(`❌ ${e.message}\n`);
      LOG.push(`[${pct}%] ${name}: err ${e.message}`); err++;
    }
    await sleep(120);
    if (i % 25 === 0) saveLog();
  }
  log(`\nEquipos: ${ok} descargados, ${skip} ya existentes, ${notfound} no encontrados, ${err} errores`);
  return ok;
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  log('╔══════════════════════════════════════════════════════════╗');
  log('║   FUTPICKS — Descarga de Logos v3                        ║');
  log('║   Fuentes: ESPN API + thesportsdb (sin API key)          ║');
  log('╚══════════════════════════════════════════════════════════╝');

  fs.mkdirSync(TEAMS_DIR,   { recursive: true });
  fs.mkdirSync(LEAGUES_DIR, { recursive: true });

  // 1. default.png
  const defaultDest = path.join(IMAGES_BASE, 'default.png');
  if (!fs.existsSync(defaultDest)) { fs.writeFileSync(defaultDest, createDefaultPNG()); log('✅ default.png creado'); }
  else log('⏭  default.png ya existe');

  // 2. Logos de ligas
  await downloadLeagues();

  // 3. Nombres de equipos desde MySQL
  let dbNames = [];
  try {
    log('Conectando a MySQL...');
    const conn = await mysql.createConnection(DB);
    const [rows] = await conn.execute('SELECT DISTINCT team_name FROM teams ORDER BY team_name');
    await conn.end();
    dbNames = rows.map(r => r.team_name);
    log(`✅ MySQL: ${dbNames.length} equipos`);
  } catch(e) {
    log(`❌ MySQL: ${e.message}\nAbortando.`);
    saveLog(); process.exit(1);
  }

  // 4. Mapa ESPN
  const espnMap = await buildEspnMap();

  // 5. Descargar logos
  const downloaded = await downloadTeams(dbNames, espnMap);

  log('\n╔══════════════════════════════════════════════════════════╗');
  log(`║   LISTO — ${downloaded} logos nuevos descargados             `);
  log(`║   Revisa scripts/download_logos.log para detalle         ║`);
  log('╚══════════════════════════════════════════════════════════╝');
  saveLog();
}

main().catch(e => { log('Error fatal: ' + e.message); saveLog(); process.exit(1); });
