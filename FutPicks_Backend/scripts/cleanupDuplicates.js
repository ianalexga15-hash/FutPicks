'use strict';
/* ═══════════════════════════════════════════════════════════════
   FUTPICKS — cleanupDuplicates.js
   1. Elimina matches duplicados de Brasileirão y MLS
      (solo existen datos reales de 2025_2026; los demás son copias)
   2. Agrega columna match_round a la tabla matches (si no existe)
   Uso: node scripts/cleanupDuplicates.js
═══════════════════════════════════════════════════════════════ */
const db = require('../config/db');

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  FutPicks — Cleanup Duplicados + match_round column  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  /* ── 1. Agregar columna match_round si no existe ─────────────── */
  try {
    await db.query(`ALTER TABLE matches ADD COLUMN match_round VARCHAR(150) NULL DEFAULT NULL`);
    console.log('✅ Columna match_round agregada a matches\n');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️  Columna match_round ya existe\n');
    } else {
      throw e;
    }
  }

  /* ── 2. Limpiar duplicados Brasileirão y MLS ─────────────────── */
  // Obtener season_id de 2025_2026 (el único con datos reales)
  const [[realSeason]] = await db.query(
    `SELECT season_id FROM seasons WHERE season_name = '2025_2026'`
  );
  if (!realSeason) {
    console.error('❌ No se encontró temporada 2025_2026');
    process.exit(1);
  }
  const realSid = realSeason.season_id;
  console.log(`[i] Temporada real: 2025_2026 (season_id = ${realSid})\n`);

  const [leagues] = await db.query(
    `SELECT league_id, league_name FROM leagues WHERE league_name IN ('brasileirao', 'mls')`
  );

  for (const lg of leagues) {
    const [[before]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM matches WHERE league_id = ? AND season_id != ?`,
      [lg.league_id, realSid]
    );
    console.log(`[→] ${lg.league_name}: ${before.cnt} registros duplicados a eliminar...`);

    if (before.cnt > 0) {
      await db.query(
        `DELETE FROM matches WHERE league_id = ? AND season_id != ?`,
        [lg.league_id, realSid]
      );
    }

    const [[after]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM matches WHERE league_id = ?`,
      [lg.league_id]
    );
    console.log(`✅ ${lg.league_name}: quedan ${after.cnt} partidos (temporada 2025_2026)\n`);
  }

  console.log('✅ LIMPIEZA TERMINADA\n');
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
