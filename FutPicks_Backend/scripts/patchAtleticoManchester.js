'use strict';
/* ═══════════════════════════════════════════════════════════════
   FUTPICKS — patchAtleticoManchester.js
   Corrige logos duplicados de Atlético ×3 y Manchester ×2
   Descarga directo desde ESPN API usando búsqueda explícita por liga.
   Uso: node scripts/patchAtleticoManchester.js
═══════════════════════════════════════════════════════════════ */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TEAMS_DIR = path.resolve(__dirname, '../../FutPicks_Frontend/images/teams');
const slug = n => n.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

// Targets: { dbName, espnLeague, keyword }
// keyword = substring that ONLY matches this team in that league
const TARGETS = [
  { dbName: 'Atlético Madrid',   espnLeague: 'esp.1', keyword: 'atletico' },
  { dbName: 'Atlético Mineiro',  espnLeague: 'bra.1', keyword: 'atletico' },
  { dbName: 'Atlético San Luis', espnLeague: 'mex.1', keyword: 'san luis' },
  { dbName: 'Manchester City',   espnLeague: 'eng.1', keyword: 'city' },
  { dbName: 'Manchester Utd',    espnLeague: 'eng.1', keyword: 'manchester united' },
];

// Fallback leagues to check if not found in primary
const FALLBACK = {
  'Manchester Utd': ['eng.2'],
  'Atlético San Luis': ['mex.2'],
};

function apiGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 12000,
    }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode))
        return apiGet(res.headers.location).then(resolve).catch(reject);
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
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 20000,
    }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode))
        return downloadBinary(res.headers.location, dest, depth + 1).then(resolve).catch(reject);
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

async function findLogoInLeague(espnLeague, keyword) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/teams?limit=200`;
  const data = await apiGet(url);
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
  const normalize = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const kw = normalize(keyword);
  for (const t of teams) {
    const name = normalize(t.team?.displayName || '');
    if (name.includes(kw)) {
      const logoUrl = t.team?.logos?.[0]?.href;
      if (logoUrl) return { logoUrl, espnName: t.team?.displayName };
    }
  }
  return null;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  FutPicks — Fix Logos: Atlético ×3 + Manchester ×2   ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  fs.mkdirSync(TEAMS_DIR, { recursive: true });

  for (const target of TARGETS) {
    const dest = path.join(TEAMS_DIR, slug(target.dbName) + '.png');
    process.stdout.write(`[→] ${target.dbName} (${target.espnLeague}) ... `);

    let found = null;
    try {
      found = await findLogoInLeague(target.espnLeague, target.keyword);
      if (!found && FALLBACK[target.dbName]) {
        for (const fb of FALLBACK[target.dbName]) {
          process.stdout.write(`checking ${fb} ... `);
          found = await findLogoInLeague(fb, target.keyword);
          if (found) break;
        }
      }
    } catch (e) {
      console.log(`❌ Error buscando: ${e.message}`);
      continue;
    }

    if (!found) {
      console.log('⚠️  No encontrado en ESPN');
      continue;
    }

    try {
      await downloadBinary(found.logoUrl, dest);
      const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      if (size < 500) { fs.unlinkSync(dest); console.log('❌ Imagen vacía'); continue; }
      console.log(`✅  ${found.espnName} (${Math.round(size / 1024)}KB) → ${slug(target.dbName)}.png`);
    } catch (e) {
      if (fs.existsSync(dest)) try { fs.unlinkSync(dest); } catch {}
      console.log(`❌ Error descargando: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n✅ CORRECCIÓN TERMINADA');
  console.log('Recarga el browser para ver los cambios.\n');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
