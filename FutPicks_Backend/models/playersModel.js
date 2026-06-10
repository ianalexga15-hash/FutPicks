const db = require('../config/db');

async function getAllPlayers() {

    const [rows] = await db.query(`
        SELECT *
        FROM players
        ORDER BY player_name
    `);

    return rows;
}

module.exports = {
    getAllPlayers
};