const teamsModel = require('../models/teamsModel');

async function getTeams(req, res) {

    try {

        const teams =
            await teamsModel.getAllTeams();

        res.json(teams);

    } catch (error) {

        res.status(500).json({
            error: error.message
        });

    }

}

module.exports = {
    getTeams
};