const db = require('../config/db');

async function getAllMatches() {

    const [rows] = await db.query(`
        SELECT *
        FROM matches
        LIMIT 1000
    `);

    return rows;
}

module.exports = {
    getAllMatches
};