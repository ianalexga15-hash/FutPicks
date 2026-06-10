'use strict';
/* ═══════════════════════════════════════════════════════════════
   FUTPICKS — patchMissingLogos.js v6
   Fuente: ESPN API — ligas tier 1 + tier 2 + tier 3 (sin season param)
   Los equipos relegados están en su segunda/tercera división actual.
   Uso: node scripts/patchMissingLogos.js
═══════════════════════════════════════════════════════════════ */
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const TEAMS_DIR = path.resolve(__dirname, '../../FutPicks_Frontend/images/teams');
const LOG_FILE  = path.join(__dirname, 'patch_logos.log');

const LOG = [];
function log(msg) { console.log(msg); LOG.push(msg); }
function saveLog() { try { fs.writeFileSync(LOG_FILE, LOG.join('\n'), 'utf8'); } catch {} }

const slug  = n => n.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normName(n) {
  return (n || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(fc|cf|sc|ac|as|cd|ud|sd|bsc|afc|sfc|cp|rcd|rc|bv|sv|tsv|sg|vfb|vfl|rb|fk|sk|sv|sv|spvgg|tsg)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

function apiGet(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout,
    }, res => {
      if ([301,302,307,308].includes(res.statusCode))
        return apiGet(res.headers.location, timeout).then(resolve).catch(reject);
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON error')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function downloadBinary(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 20000,
    }, res => {
      if ([301,302,307,308].includes(res.statusCode))
        return downloadBinary(res.headers.location, dest, depth+1).then(resolve).catch(reject);
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

// Tier 1 (ya cargados, refuerzo) + Tier 2 (donde están los relegados) + Tier 3
const ESPN_LEAGUES = [
  // Tier 1
  { espn: 'eng.1',  name: 'Premier League' },
  { espn: 'esp.1',  name: 'La Liga' },
  { espn: 'ita.1',  name: 'Serie A' },
  { espn: 'ger.1',  name: 'Bundesliga' },
  { espn: 'fra.1',  name: 'Ligue 1' },
  { espn: 'ned.1',  name: 'Eredivisie' },
  { espn: 'por.1',  name: 'Primeira Liga' },
  { espn: 'usa.1',  name: 'MLS' },
  { espn: 'bra.1',  name: 'Brasileirao' },
  // Tier 2 — equipos relegados están aquí ahora
  { espn: 'eng.2',  name: 'Championship (ENG)' },   // Southampton, Watford, Norwich, Luton, Ipswich
  { espn: 'esp.2',  name: 'Segunda (ESP)' },         // Cádiz, Almería, Valladolid, Granada, Leganés
  { espn: 'ita.2',  name: 'Serie B (ITA)' },         // Sampdoria, Salernitana, Spezia, Pisa, Empoli, Hellas Verona
  { espn: 'ger.2',  name: '2. Bundesliga (GER)' },   // Schalke, Hertha, Arminia, Düsseldorf, Greuther Fürth
  { espn: 'fra.2',  name: 'Ligue 2 (FRA)' },         // Bordeaux, Troyes, Ajaccio, Clermont
  { espn: 'ned.2',  name: 'Eerste Divisie (NED)' },  // ADO Den Haag, Cambuur, Emmen, VVV-Venlo, etc.
  { espn: 'por.2',  name: 'Liga Portugal 2' },        // B-SAD, Farense, Marítimo, Paços, Portimonense, etc.
  { espn: 'mex.2',  name: 'Ascenso MX' },
  // Tier 3 — para equipos más relegados
  { espn: 'ger.3',  name: '3. Liga (GER)' },          // Paderborn 07, Elversberg
  { espn: 'ned.3',  name: 'Derde Divisie (NED)' },    // Den Bosch, Dordrecht, Roda JC
];

async function buildEspnMap() {
  log('\nConstruyendo mapa ESPN (tier 1 + tier 2 + tier 3)...');
  const map = new Map();
  for (const lg of ESPN_LEAGUES) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.espn}/teams?limit=200`;
      const data = await apiGet(url, 10000);
      const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
      let added = 0;
      for (const t of teams) {
        const logoUrl = t.team?.logos?.[0]?.href;
        if (!logoUrl) continue;
        for (const name of [t.team?.displayName, t.team?.shortDisplayName, t.team?.name, t.team?.nickname]) {
          if (name) map.set(normName(name), logoUrl);
        }
        added++;
      }
      log(`  ${lg.name}: ${added} equipos`);
    } catch(e) { log(`  ${lg.name}: ❌ ${e.message}`); }
    await sleep(200);
  }
  log(`Mapa ESPN total: ${map.size} entradas únicas\n`);
  return map;
}

function findLogo(dbName, espnMap) {
  const n = normName(dbName);
  if (espnMap.has(n)) return espnMap.get(n);
  for (const [key, url] of espnMap) {
    if (key.length >= 4 && (n.includes(key) || key.includes(n))) return url;
  }
  const fw = n.split(' ')[0];
  if (fw.length >= 4) {
    for (const [key, url] of espnMap) {
      if (key.startsWith(fw) || key.includes(fw)) return url;
    }
  }
  return null;
}

// Solo los que aún no tienen logo válido (los 45 que quedaron tras v4+v5)
const MISSING = [
  'ADO Den Haag','Ajaccio','Almere City','Almería','Arminia','AVS Futebol',
  'B-SAD','Boavista','Bordeaux','Cambuur','Chaves',
  'Clermont Foot','Darmstadt 98','De Graafschap','Den Bosch','Dordrecht',
  'Elversberg','Emmen','Empoli','Farense',
  'Greuther Fürth','Hellas Verona','Holstein Kiel','Ipswich Town',
  'Las Palmas','Leicester City','Luton Town','Marítimo',
  'Montpellier','MVV Maastricht','Norwich City','Paços de Ferreira','Paderborn 07',
  'Pisa','Portimonense','RKC Waalwijk','Roda JC',
  'Salernitana','Sampdoria','Schalke 04','Southampton','Spezia','Torreense',
  'Troyes','Valladolid','Vitesse','Vizela','VVV-Venlo','Watford','Willem II',
  // Incorrectas de Wikipedia — reemplazar con ESPN si existe
  'Leicester City','Cambuur','Clermont Foot',
];

// Deduplicar
const TODO = [...new Set(MISSING)];

async function main() {
  log('╔══════════════════════════════════════════════════════════╗');
  log('║   FUTPICKS — Patch Logos v6 (ESPN tier 1+2+3)            ║');
  log(`║   ${TODO.length} equipos objetivo                               ║`);
  log('╚══════════════════════════════════════════════════════════╝');

  fs.mkdirSync(TEAMS_DIR, { recursive: true });

  const espnMap = await buildEspnMap();

  log(`══ DESCARGANDO ${TODO.length} LOGOS ═════════════════════════════`);
  let ok = 0, notfound = 0, err = 0;

  for (let i = 0; i < TODO.length; i++) {
    const name = TODO[i];
    const dest = path.join(TEAMS_DIR, slug(name) + '.png');
    const pct  = String(Math.round(((i+1) / TODO.length) * 100)).padStart(3);

    process.stdout.write(`[${pct}%] ${name} ... `);

    const logoUrl = findLogo(name, espnMap);
    if (!logoUrl) {
      console.log('⚠️  no en ESPN tier1/2/3');
      LOG.push(`${name}: notfound`); notfound++; continue;
    }

    try {
      await downloadBinary(logoUrl, dest);
      const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      if (size < 200) {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        throw new Error('Imagen vacía');
      }
      console.log(`✅ (${Math.round(size/1024)}KB)`);
      LOG.push(`${name}: ok (${Math.round(size/1024)}KB)`); ok++;
    } catch(e) {
      if (fs.existsSync(dest)) try { fs.unlinkSync(dest); } catch {}
      console.log(`❌ ${e.message}`);
      LOG.push(`${name}: err ${e.message}`); err++;
    }
    await sleep(100);
    if ((i+1) % 10 === 0) saveLog();
  }

  log(`\nResultado: ${ok} descargados, ${notfound} no encontrados, ${err} errores`);
  const totalTeams = fs.readdirSync(TEAMS_DIR).filter(f => f.endsWith('.png')).length;
  log(`Total logos de equipos en disco: ${totalTeams}/260`);
  saveLog();
  log('\n✅ PATCH TERMINADO');
}

main().catch(e => { log('Error: ' + e.message); saveLog(); process.exit(1); });
