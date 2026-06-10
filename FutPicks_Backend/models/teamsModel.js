const db = require('../config/db');

async function getAllTeams() {

    const [rows] = await db.query(`
        SELECT *
        FROM teams
        ORDER BY team_name
    `);

    return rows;
}

module.exports = {
    getAllTeams
};