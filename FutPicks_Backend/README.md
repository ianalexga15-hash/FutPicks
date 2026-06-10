# FutPicks Backend

API REST que expone los endpoints del motor de predicción.

## Estructura

```
FutPicks_Backend/
├── config/          ← Conexión a MySQL
├── controllers/     ← Lógica de cada endpoint
├── models/          ← Queries SQL y modelos de datos
├── routes/          ← Definición de rutas Express
├── services/        ← Motor Dixon-Coles, calculador de fuerzas, generador de calendarios
└── index.js         ← Entry point del servidor
```

## Endpoints principales

| Ruta | Descripción |
|---|---|
| `GET /api/predict/match/:leagueId/:home/:away` | Predicción de un partido |
| `GET /api/predict/season/:leagueId/:year` | Simulación de temporada futura |
| `GET /api/predict/montecarlo/:leagueId/:year` | Probabilidades Monte Carlo |
| `GET /api/predict/backtest/:leagueId` | Validación retrospectiva del modelo |
| `GET /api/standings/:leagueId/:seasonId` | Clasificación real |
| `GET /api/teams/league/:leagueId/season/:seasonId` | Equipos por liga/temporada |
| `GET /api/players/team/:teamName/season/:seasonId` | Jugadores clave de un equipo |
