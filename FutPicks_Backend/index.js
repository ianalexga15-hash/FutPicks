const statsRoutes =
    require('./routes/statsRoutes');
const leaguesRoutes =
require('./routes/leaguesRoutes');

const seasonsRoutes =
require('./routes/seasonsRoutes');

const predictionRoutes = require('./routes/predictionRoutes');

const matchesRoutes =
require('./routes/matchesRoutes');

const playersRoutes =
require('./routes/playersRoutes');
const teamsRoutes =
require('./routes/teamsRoutes');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./config/db');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/', async (req, res) => {

    try {

        const [rows] = await db.query(
            'SELECT COUNT(*) total FROM teams'
        );

        res.json({
            mensaje: 'Conexion OK',
            equipos: rows[0].total
        });

    } catch (error) {

        res.status(500).json({
            error: error.message
        });

    }

});
app.use(
    '/api/leagues',
    leaguesRoutes
);

app.use(
    '/api/seasons',
    seasonsRoutes
);

app.use(
    '/api/matches',
    matchesRoutes
);

app.use(
    '/api/players',
    playersRoutes
);

app.use(
    '/api/teams',
    teamsRoutes
);
app.use(
    '/api',
    statsRoutes
);


app.use('/api/predict', predictionRoutes);


app.listen(PORT, () => {

    console.log(
        `Servidor corriendo en puerto ${PORT}`
    );

});

