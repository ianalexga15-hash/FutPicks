/* ═══════════════════════════════════════════════════════════════
   predictionEngine.js
   Motor Dixon-Coles + Poisson para FutPicks AI.

   Calcula por partido:
     λ_home = attack_home × defense_away × μ × home_advantage
     λ_away = attack_away × defense_home × μ

   Probabilidades vía distribución Poisson discreta (scores 0-8).
   Corrección de baja puntuación de Dixon-Coles incluida.
═══════════════════════════════════════════════════════════════ */
'use strict';

const MAX_GOALS = 8; // max goles por equipo en la distribución
const HOME_ADV  = 1.12; // ventaja local media histórica (calibrada)

/* ── Poisson PMF ── */
function poissonPMF(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

/* ── Corrección Dixon-Coles para scores bajos (0-0, 1-0, 0-1, 1-1) ── */
function dixonColesRho(i, j, lambdaH, lambdaA, rho = -0.13) {
  if (i === 0 && j === 0) return 1 - lambdaH * lambdaA * rho;
  if (i === 1 && j === 0) return 1 + lambdaA * rho;
  if (i === 0 && j === 1) return 1 + lambdaH * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

/* ── Score matrix ── */
function buildScoreMatrix(lambdaH, lambdaA) {
  const matrix = [];
  let total = 0;

  for (let i = 0; i <= MAX_GOALS; i++) {
    matrix[i] = [];
    for (let j = 0; j <= MAX_GOALS; j++) {
      const raw = poissonPMF(lambdaH, i) * poissonPMF(lambdaA, j)
                * dixonColesRho(i, j, lambdaH, lambdaA);
      matrix[i][j] = raw;
      total += raw;
    }
  }
  // Normalizar
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++)
      matrix[i][j] /= total;

  return matrix;
}

/* ── Calcular probabilidades finales ── */
function calcProbabilities(matrix) {
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) {
      if (i > j) pH += matrix[i][j];
      else if (i === j) pD += matrix[i][j];
      else pA += matrix[i][j];
    }
  return { pH, pD, pA };
}

/* ── Score más probable ── */
function mostLikelyScore(matrix) {
  let best = 0, bh = 0, ba = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++)
      if (matrix[i][j] > best) { best = matrix[i][j]; bh = i; ba = j; }
  return { home: bh, away: ba, prob: parseFloat((best * 100).toFixed(2)) };
}

/* ── Confianza de predicción ── */
function confidence(pH, pD, pA) {
  const max = Math.max(pH, pD, pA);
  const entropy = -[pH, pD, pA]
    .filter(p => p > 0)
    .reduce((s, p) => s + p * Math.log2(p), 0);
  // Normalizar a 0-100: entropía máxima log2(3) ≈ 1.585
  return Math.round((1 - entropy / Math.log2(3)) * 100);
}

/* ══════════════════════════════════════════════════════════════
   PREDICCIÓN DE UN SOLO PARTIDO
   Parámetros:
     homeTeam / awayTeam: { team_name, attack, defense, form_mod }
     mu: media de goles de la liga
     isNeutral: sin ventaja local (ej. finales)
══════════════════════════════════════════════════════════════ */
function predictMatch(homeTeam, awayTeam, mu = 1.35, isNeutral = false) {
  const homeMod = isNeutral ? 1.0 : HOME_ADV;

  // λ ajustado por forma reciente
  let lH = homeTeam.attack * awayTeam.defense * mu * homeMod * (homeTeam.form_mod || 1);
  let lA = awayTeam.attack * homeTeam.defense * mu              * (awayTeam.form_mod || 1);

  // Clamping
  lH = Math.max(0.20, Math.min(6.0, lH));
  lA = Math.max(0.20, Math.min(6.0, lA));

  const matrix  = buildScoreMatrix(lH, lA);
  const { pH, pD, pA } = calcProbabilities(matrix);
  const likely  = mostLikelyScore(matrix);
  const conf    = confidence(pH, pD, pA);

  const outcome = pH > pA ? 'home' : pA > pH ? 'away' : 'draw';

  return {
    home_team:        homeTeam.team_name,
    away_team:        awayTeam.team_name,
    lambda_home:      parseFloat(lH.toFixed(3)),
    lambda_away:      parseFloat(lA.toFixed(3)),
    prob_home:        parseFloat((pH * 100).toFixed(2)),
    prob_draw:        parseFloat((pD * 100).toFixed(2)),
    prob_away:        parseFloat((pA * 100).toFixed(2)),
    expected_home:    parseFloat(lH.toFixed(2)),
    expected_away:    parseFloat(lA.toFixed(2)),
    most_likely_score: `${likely.home}-${likely.away}`,
    score_prob:       likely.prob,
    confidence:       conf,
    outcome,
    factors: {
      home_attack:   homeTeam.attack,
      home_defense:  homeTeam.defense,
      away_attack:   awayTeam.attack,
      away_defense:  awayTeam.defense,
      home_form_mod: homeTeam.form_mod || 1,
      away_form_mod: awayTeam.form_mod || 1,
      home_advantage: homeMod,
      league_mu:     mu,
    },
  };
}

/* ══════════════════════════════════════════════════════════════
   SIMULACIÓN MONTE CARLO DE UN PARTIDO
   Samplea un resultado real a partir de la distribución.
══════════════════════════════════════════════════════════════ */
function sampleMatch(homeTeam, awayTeam, mu = 1.35) {
  let lH = Math.max(0.2, homeTeam.attack * awayTeam.defense * mu * HOME_ADV * (homeTeam.form_mod || 1));
  let lA = Math.max(0.2, awayTeam.attack * homeTeam.defense * mu              * (awayTeam.form_mod || 1));

  const matrix = buildScoreMatrix(lH, lA);

  let rnd = Math.random(), cum = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) {
      cum += matrix[i][j];
      if (rnd < cum) {
        return { home_goals: i, away_goals: j };
      }
    }
  return { home_goals: 1, away_goals: 1 }; // fallback
}

/* ══════════════════════════════════════════════════════════════
   SIMULACIÓN ACUMULATIVA DE TEMPORADA

   Genera jornada por jornada hasta target_round.
   Cada partido predicho actualiza form_mod del equipo.

   Parámetros:
     teams     : array de { team_name, attack, defense, form_mod, ... }
     fixtures  : array de { matchday, home_team, away_team }
     mu        : media de liga
     targetRound: jornada final a simular
   Retorno:
     { standings, results, round_results }
══════════════════════════════════════════════════════════════ */
function simulateSeason(teams, fixtures, mu, targetRound = Infinity) {
  // Estado mutable por equipo
  const state = new Map();
  for (const t of teams) {
    state.set(t.team_name, {
      ...t,
      sim_points: 0,
      sim_played: 0,
      sim_gf:     0,
      sim_ga:     0,
      sim_wins:   0,
      sim_draws:  0,
      sim_losses: 0,
      sim_form:   [...(t.form || [])], // histórico real como base
    });
  }

  const results      = [];
  const roundResults = new Map();

  // Agrupar fixtures por jornada
  const byRound = new Map();
  for (const f of fixtures) {
    if (!byRound.has(f.matchday)) byRound.set(f.matchday, []);
    byRound.get(f.matchday).push(f);
  }

  const rounds = [...byRound.keys()].sort((a, b) => a - b);

  for (const round of rounds) {
    if (round > targetRound) break;

    const roundMatches = byRound.get(round);
    const roundPredictions = [];

    for (const fixture of roundMatches) {
      const home = state.get(fixture.home_team);
      const away = state.get(fixture.away_team);

      if (!home || !away) continue;

      // Predecir
      const pred   = predictMatch(home, away, mu);
      const sample = sampleMatch(home, away, mu);

      // Actualizar estado
      const hGl = sample.home_goals;
      const aGl = sample.away_goals;

      const upd = (team, scored, conceded) => {
        team.sim_played++;
        team.sim_gf += scored;
        team.sim_ga += conceded;
        let res;
        if (scored > conceded) { team.sim_points += 3; team.sim_wins++;   res = 'W'; }
        else if (scored === conceded) { team.sim_points += 1; team.sim_draws++;  res = 'D'; }
        else { team.sim_losses++; res = 'L'; }
        team.sim_form = [res, ...team.sim_form].slice(0, 5);
        // Recalcular form_mod
        const pts = team.sim_form.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
        team.form_mod = 0.85 + 0.30 * (pts / (team.sim_form.length * 3 || 1));
      };

      upd(home, hGl, aGl);
      upd(away, aGl, hGl);

      const matchResult = {
        matchday:   round,
        home_team:  fixture.home_team,
        away_team:  fixture.away_team,
        home_goals: hGl,
        away_goals: aGl,
        prediction: pred,
      };
      results.push(matchResult);
      roundPredictions.push(matchResult);
    }

    roundResults.set(round, roundPredictions);
  }

  // Tabla final
  const standings = [...state.values()]
    .map(t => ({
      team_name:   t.team_name,
      played:      t.sim_played,
      wins:        t.sim_wins,
      draws:       t.sim_draws,
      losses:      t.sim_losses,
      goals_for:   t.sim_gf,
      goals_against: t.sim_ga,
      goal_diff:   t.sim_gf - t.sim_ga,
      points:      t.sim_points,
      form:        t.sim_form,
    }))
    .sort((a, b) => b.points - a.points || b.goal_diff - a.goal_diff || b.goals_for - a.goals_for);

  return {
    standings,
    results,
    round_results: Object.fromEntries(roundResults),
    rounds_simulated: Math.min(targetRound, rounds.length > 0 ? Math.max(...rounds) : 0),
  };
}

/* ══════════════════════════════════════════════════════════════
   MONTE CARLO — múltiples simulaciones para distribuciones
   Retorna { championship_probs, top4_probs, relegation_probs }
══════════════════════════════════════════════════════════════ */
function monteCarloSeason(teams, fixtures, mu, simulations = 1000) {
  const champ   = new Map();
  const top4    = new Map();
  const bottom3 = new Map();

  for (const t of teams) {
    champ.set(t.team_name, 0);
    top4.set(t.team_name, 0);
    bottom3.set(t.team_name, 0);
  }

  for (let s = 0; s < simulations; s++) {
    const { standings } = simulateSeason(teams, fixtures, mu);
    const n = standings.length;
    standings.forEach((team, i) => {
      if (i === 0) champ.set(team.team_name, (champ.get(team.team_name) || 0) + 1);
      if (i < 4)   top4.set(team.team_name,  (top4.get(team.team_name) || 0)  + 1);
      if (i >= n - 3) bottom3.set(team.team_name, (bottom3.get(team.team_name) || 0) + 1);
    });
  }

  const toProb = (map) => {
    const out = {};
    for (const [k, v] of map) out[k] = parseFloat((v / simulations * 100).toFixed(1));
    return out;
  };

  return {
    championship_probs: toProb(champ),
    top4_probs:         toProb(top4),
    relegation_probs:   toProb(bottom3),
    simulations,
  };
}

module.exports = { predictMatch, sampleMatch, simulateSeason, monteCarloSeason };