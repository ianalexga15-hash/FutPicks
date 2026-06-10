const playersModel =
require('../models/playersModel');

async function getPlayers(req, res) {

    try {

        const players =
            await playersModel.getAllPlayers();

        res.json(players);

    } catch (error) {

        res.status(500).json({
            error: error.message
        });

    }

}

module.exports = {
    getPlayers
};