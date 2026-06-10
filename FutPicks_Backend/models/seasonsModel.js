const db = require('../config/db');

async function getAllSeasons() {

    const [rows] = await db.query(`
        SELECT *
        FROM seasons
        ORDER BY season_name
    `);

    return rows;
}

/* Returns only seasons that have match data for a given league (most recent first) */
async function getSeasonsByLeague(leagueId) {
    const [rows] = await db.query(`
        SELECT DISTINCT s.season_id, s.season_name
        FROM matches m
        JOIN seasons s ON s.season_id = m.season_id
        WHERE m.league_id = ?
        ORDER BY s.season_name DESC
    `, [leagueId]);
    return rows;
}

module.exports = {
    getAllSeasons,
    getSeasonsByLeague,
};