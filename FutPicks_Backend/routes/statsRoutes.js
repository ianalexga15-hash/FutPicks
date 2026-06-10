/* ═══════════════════════════════════════════════════════════════
   routes/statsRoutes.js — v7 (con rutas nuevas por temporada)
═══════════════════════════════════════════════════════════════ */
const express = require('express');
const router  = express.Router();
const c       = require('../controllers/statsController');

// Summary KPIs
router.get('/summary', c.getSummary);

// Standings
router.get('/standings',                                     c.getStandings);
router.get('/standings/:leagueId/:seasonId',                 c.getStandingsByLeagueSeason);

// Scorers
router.get('/topscorers',                                    c.getTopScorers);
router.get('/topscorers/league/:leagueId',                   c.getTopScorersByLeague);
router.get('/topscorers/league/:leagueId/season/:seasonId',  c.getTopScorersByLeagueSeason);

// Assists
router.get('/topassists',                                    c.getTopAssists);
router.get('/topassists/league/:leagueId',                   c.getTopAssistsByLeague);
router.get('/topassists/league/:leagueId/season/:seasonId',  c.getTopAssistsByLeagueSeason);

// Goalkeepers
router.get('/goalkeepers',                                   c.getGoalkeepers);
router.get('/goalkeepers/league/:leagueId/season/:seasonId', c.getGoalkeepersByLeagueSeason);

// Team power
router.get('/teampower',                                     c.getTeamPower);
router.get('/teampower/league/:leagueId/season/:seasonId',   c.getTeamPowerBySeason);

// Players
router.get('/player/:name',                                  c.getPlayerByName);
router.get('/player/:name/season/:seasonId',                 c.getPlayerStatsBySeason);
router.get('/player/:name/seasons',                          c.getPlayerSeasons);
router.get('/player/:name/fullstats/:seasonId',               c.getPlayerFullStats);
router.get('/players/team/:teamName/season/:seasonId',        c.getTeamKeyPlayers);
router.get('/players/team/:teamName/season/:seasonId/cards',   c.getTeamCardPlayers);

// Teams
router.get('/team/:name',                                    c.getTeamByName);
router.get('/team/:name/matches',                            c.getTeamMatches);
router.get('/team/:name/season/:seasonId',                   c.getTeamSeasonMatches);
router.get('/teams/league/:leagueId',                        c.getTeamsByLeague);
router.get('/teams/league/:leagueId/season/:seasonId',       c.getTeamsByLeagueSeason);

// Stats / form / h2h
router.get('/teamstats/:teamName',                           c.getTeamStats);
router.get('/form/:teamName',                                c.getTeamForm);
router.get('/form/:teamName/season/:seasonId',               c.getTeamFormBySeason);
router.get('/teamgoals/:teamName',                           c.getTeamGoals);
router.get('/homeaway/:teamName',                            c.getTeamHomeAway);
router.get('/h2h/:homeTeam/:awayTeam',                       c.getHeadToHead);
router.get('/lastmatches/:teamName',                         c.getLastMatches);

// Search & matches
router.get('/search/:search',                                c.searchAll);
router.get('/matches/league/:leagueId',                      c.getMatchesByLeague);
router.get('/matches/league/:leagueId/season/:seasonId',   c.getMatchesByLeagueSeason);

module.exports = router;
