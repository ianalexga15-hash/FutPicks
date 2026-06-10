'use strict';
/* Descarga logos de equipos brasileños históricos desde ESPN bra.1 + bra.2 */
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const TEAMS_DIR = path.resolve(__dirname, '../../FutPicks_Frontend/images/teams');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug  = n => n.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

const MISSING = ['Avaí','Criciúma','Cuiabá','Fortaleza','Goiás','Juventude'];

function normName(n) {
  return (n||'').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9 ]/g,' ').replace(/\b(fc|ec|sc|ac|cf)\b/g,'')
    .replace(/\s+/g,' ').trim();
}

function apiGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers:{'User-Agent':'Mozilla/5.0'}, timeout:15000 }, res => {
      if ([301,302,307,308].includes(res.statusCode))
        return apiGet(res.headers.location).then(resolve).catch(reject);
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{reject(new Error('JSON'))} });
    }).on('error',reject).on('timeout',function(){this.destroy();reject(new Error('timeout'))});
  });
}

function downloadBinary(url, dest, depth=0) {
  return new Promise((resolve,reject)=>{
    if(depth>5) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https')?https:http;
    mod.get(url,{headers:{'User-Agent':'Mozilla/5.0'},timeout:20000},res=>{
      if([301,302,307,308].includes(res.statusCode))
        return downloadBinary(res.headers.location,dest,depth+1).then(resolve).catch(reject);
      if(res.statusCode!==200) return reject(new Error('HTTP '+res.statusCode));
      const f=fs.createWriteStream(dest);
      res.pipe(f); f.on('finish',()=>f.close(resolve)); f.on('error',reject);
    }).on('error',reject).on('timeout',function(){this.destroy();reject(new Error('timeout'))});
  });
}

async function main() {
  console.log('Buscando logos en ESPN bra.1 + bra.2 + bra.3...\n');
  const map = new Map();

  for (const league of ['bra.1','bra.2','bra.3']) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams?limit=200`;
      const data = await apiGet(url);
      const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
      for (const t of teams) {
        const logo = t.team?.logos?.[0]?.href;
        if (!logo) continue;
        for (const name of [t.team?.displayName, t.team?.shortDisplayName, t.team?.name]) {
          if (name) map.set(normName(name), logo);
        }
      }
      console.log(`ESPN ${league}: ${teams.length} equipos cargados`);
    } catch(e) { console.log(`ESPN ${league}: ${e.message}`); }
    await sleep(300);
  }

  console.log(`\nMapa total: ${map.size} equipos\n`);
  console.log('Equipos en mapa que contienen brasil/serie keywords:');
  for (const [k] of map) {
    if (['fortaleza','cuiaba','criciuma','goias','juventude','avai','ceara'].some(t=>k.includes(t)))
      console.log(' ', k);
  }

  console.log('\n--- Descargando logos faltantes ---');
  let ok=0, notfound=0;
  for (const name of MISSING) {
    const dest = path.join(TEAMS_DIR, slug(name)+'.png');
    if (fs.existsSync(dest) && fs.statSync(dest).size > 500) {
      console.log(`SKIP ${name} (ya existe)`); continue;
    }
    const n = normName(name);
    let logoUrl = map.get(n);
    if (!logoUrl) {
      // fuzzy: buscar si alguna clave contiene nuestro nombre
      for (const [key,url] of map) {
        if (key.includes(n) || n.includes(key)) { logoUrl=url; break; }
      }
    }
    if (!logoUrl) { console.log(`NO ENCONTRADO: ${name} (norm="${n}")`); notfound++; continue; }
    try {
      await downloadBinary(logoUrl, dest);
      const size = fs.statSync(dest).size;
      console.log(`OK: ${name} -> ${slug(name)}.png (${Math.round(size/1024)}KB)`); ok++;
    } catch(e) { console.log(`ERROR: ${name}: ${e.message}`); }
    await sleep(200);
  }

  console.log(`\nListo: ${ok} descargados, ${notfound} no encontrados`);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
