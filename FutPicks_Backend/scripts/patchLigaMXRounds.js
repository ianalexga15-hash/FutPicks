'use strict';
/* ═══════════════════════════════════════════════════════════════
   FUTPICKS — patchLigaMXRounds.js
   Lee el campo "Round" de los CSV de Liga MX y lo escribe en
   matches.match_round para poder filtrar la liguilla en standings.

   Estructura CSV Liga MX:
     Round,Wk,Day,Date,Time,Home,Score,Away,...
   Rounds importantes:
     "Apertura YYYY Regular Season" / "Clausura YYYY Regular Season"
     "Apertura — Quarter-finals" / "Clausura — Quarter-finals" / etc.

   Uso: node scripts/patchLigaMXRounds.js
═══════════════════════════════════════════════════════════════ */
const db   = require('../config/db');
const fs   = require('fs');
const path = require('path');

/* Ruta a los CSVs de Liga MX */
const DATA_DIR = path.resolve(
  __dirname,
  '../../FutPicks/data/matches/liga_mx'
);

/* Parser CSV minimalista (maneja comillas dobles) */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuote  = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === ',' && !inQuote) { result.push(current.trim()); current = ''; continue; }
    current += c;
  }
  result.push(current.trim());
  return result;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  FutPicks — Patch Liga MX Rounds                     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  /* ── Obtener league_id de liga_mx ─────────────────────────── */
  const [[league]] = await db.query(
    `SELECT league_id FROM leagues WHERE league_name = 'liga_mx'`
  );
  if (!league) { console.error('❌ liga_mx no encontrada'); process.exit(1); }
  const leagueId = league.league_id;
  console.log(`[i] liga_mx league_id = ${leagueId}\n`);

  /* ── Cache de equipos (evita queries repetidas) ───────────── */
  const [teamRows] = await db.query(`SELECT team_id, team_name FROM teams`);
  const teamCache = new Map(teamRows.map(t => [t.team_name, t.team_id]));

  /* ── Obtener todas las temporadas ─────────────────────────── */
  const [seasons] = await db.query(`SELECT season_id, season_name FROM seasons`);

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const season of seasons) {
    const csvPath = path.join(DATA_DIR, season.season_name, 'scores_fixtures.csv');
    if (!fs.existsSync(csvPath)) continue;

    const lines   = fs.readFileSync(csvPath, 'utf8').split('\n');
    const headers = parseCSVLine(lines[0]);
    const roundIdx = headers.indexOf('Round');
    const dateIdx  = headers.indexOf('Date');
    const homeIdx  = headers.indexOf('Home');
    const awayIdx  = headers.indexOf('Away');

    if (roundIdx < 0 || dateIdx < 0 || homeIdx < 0 || awayIdx < 0) {
      console.log(`⚠️  ${season.season_name}: cabeceras no encontradas, omitiendo`);
      continue;
    }

    console.log(`[→] ${season.season_name} (${lines.length - 1} filas)...`);
    let updated = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = parseCSVLine(line);

      const round = parts[roundIdx];
      const date  = parts[dateIdx];
      const home  = parts[homeIdx];
      const away  = parts[awayIdx];

      if (!round || !date || !home || !away) continue;

      const homeId = teamCache.get(home);
      const awayId = teamCache.get(away);
      if (!homeId || !awayId) { totalSkipped++; continue; }

      try {
        const [res] = await db.query(
          `UPDATE matches SET match_round = ?
           WHERE league_id = ? AND season_id = ?
             AND match_date = ? AND home_team_id = ? AND away_team_id = ?`,
          [round, leagueId, season.season_id, date, homeId, awayId]
        );
        if (res.affectedRows > 0) { updated++; totalUpdated++; }
      } catch (e) {
        // ignore individual row errors
      }
    }

    console.log(`   ✅ ${updated} partidos actualizados`);
  }

  /* ── Resumen ──────────────────────────────────────────────── */
  const [[{ regular }]] = await db.query(
    `SELECT COUNT(*) AS regular FROM matches
     WHERE league_id = ? AND match_round LIKE '%Regular%'`,
    [leagueId]
  );
  const [[{ liguilla }]] = await db.query(
    `SELECT COUNT(*) AS liguilla FROM matches
     WHERE league_id = ? AND match_round IS NOT NULL
       AND match_round NOT LIKE '%Regular%'`,
    [leagueId]
  );

  console.log(`\n[i] Liga MX en DB:`);
  console.log(`    Regular Season: ${regular} partidos`);
  console.log(`    Liguilla:       ${liguilla} partidos`);
  console.log(`\n✅ PATCH TERMINADO (${totalUpdated} actualizados, ${totalSkipped} sin equipo en DB)\n`);
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
