const db = require('../config/db');

async function getAllLeagues() {

    const [rows] = await db.query(`
        SELECT *
        FROM leagues
        ORDER BY league_name
    `);

    return rows;
}

module.exports = {
    getAllLeagues
};