/* ═══════════════════════════════════════════════════════════════
   controllers/statsController.js — FutPicks AI v7
   Versión limpia con todas las funciones nuevas.
═══════════════════════════════════════════════════════════════ */
'use strict';

const statsModel = require('../models/statsModel');

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

module.exports = {
  // Standings
  getStandings:                  wrap(() => statsModel.getStandings()),
  getStandingsByLeagueSeason:    wrap((req) => statsModel.getStandingsByLeagueSeason(req.params.leagueId, req.params.seasonId)),

  // Scorers
  getTopScorers:                 wrap(() => statsModel.getTopScorers()),
  getTopScorersByLeague:         wrap((req) => statsModel.getTopScorersByLeague(req.params.leagueId)),
  getTopScorersByLeagueSeason:   wrap((req) => statsModel.getTopScorersByLeagueSeason(req.params.leagueId, req.params.seasonId)),

  // Assists
  getTopAssists:                 wrap(() => statsModel.getTopAssists()),
  getTopAssistsByLeague:         wrap((req) => statsModel.getTopAssistsByLeague(req.params.leagueId)),
  getTopAssistsByLeagueSeason:   wrap((req) => statsModel.getTopAssistsByLeagueSeason(req.params.leagueId, req.params.seasonId)),

  // Goalkeepers
  getGoalkeepers:                wrap(() => statsModel.getGoalkeepers()),
  getGoalkeepersByLeagueSeason:  wrap((req) => statsModel.getGoalkeepersByLeagueSeason(req.params.leagueId, req.params.seasonId)),

  // Team power
  getTeamPower:                  wrap(() => statsModel.getTeamPower()),
  getTeamPowerBySeason:          wrap((req) => statsModel.getTeamPowerBySeason(req.params.leagueId, req.params.seasonId)),

  // Players
  getPlayerByName:               wrap((req) => statsModel.getPlayerByName(req.params.name)),
  getPlayerStatsBySeason:        wrap((req) => statsModel.getPlayerStatsBySeason(req.params.name, req.params.seasonId)),
  getPlayerSeasons:              wrap((req) => statsModel.getPlayerSeasons(req.params.name)),
  getPlayerFullStats:            wrap((req) => statsModel.getPlayerFullStats(req.params.name, req.params.seasonId)),
  getTeamKeyPlayers:             wrap((req) => statsModel.getTeamKeyPlayers(req.params.teamName, req.params.seasonId)),
  getTeamCardPlayers:            wrap((req) => statsModel.getTeamCardPlayers(req.params.teamName, req.params.seasonId)),

  // Teams
  getTeamByName:                 wrap((req) => statsModel.getTeamByName(req.params.name)),
  getTeamMatches:                wrap((req) => statsModel.getTeamMatches(req.params.name)),
  getTeamSeasonMatches:          wrap((req) => statsModel.getTeamSeasonMatches(req.params.name, req.params.seasonId)),
  getMatchesByLeague:            wrap((req) => statsModel.getMatchesByLeague(req.params.leagueId)),
  getMatchesByLeagueSeason:      wrap((req) => statsModel.getMatchesByLeagueSeason(req.params.leagueId, req.params.seasonId)),
  getTeamsByLeague:              wrap((req) => statsModel.getTeamsByLeague(req.params.leagueId)),
  getTeamsByLeagueSeason:        wrap((req) => statsModel.getTeamsByLeagueSeason(req.params.leagueId, req.params.seasonId)),

  // Stats / form / h2h
  getSummary:                     wrap(() => statsModel.getSummary()),
  getTeamStats:                  wrap((req) => statsModel.getTeamStats(req.params.teamName)),
  getTeamForm:                   wrap((req) => statsModel.getTeamForm(req.params.teamName)),
  getTeamFormBySeason:           wrap((req) => statsModel.getTeamFormBySeason(req.params.teamName, req.params.seasonId)),
  getHeadToHead:                 wrap((req) => statsModel.getHeadToHead(req.params.homeTeam, req.params.awayTeam)),
  getTeamGoals:                  wrap((req) => statsModel.getTeamGoals(req.params.teamName)),
  getTeamHomeAway:               wrap((req) => statsModel.getTeamHomeAway(req.params.teamName)),
  getLastMatches:                wrap((req) => statsModel.getLastMatches(req.params.teamName)),
  searchAll:        wrap((req) => statsModel.searchAll(req.params.search)),
};
