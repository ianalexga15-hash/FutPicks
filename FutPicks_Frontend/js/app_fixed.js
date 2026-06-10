/* ═══════════════════════════════════════════════════════════════
   FUTPICKS AI v8 — app.js
   Prediction-first frontend.
   Primary: Season Simulator, Match Predictor, Monte Carlo.
   Secondary: Historical data (season-correct queries).
═══════════════════════════════════════════════════════════════ */
'use strict';

const API      = 'http://localhost:3000/api';
const PAGE     = 30;
const ACT_SN   = '2025_2026'; // active season name in DB

/* ── STATE ──────────────────────────────────── */
const S = {
  leagues:     [],
  seasons:     [],
  activeSid:   null,
  leagueId:    '',
  view:        'simulator',
  prev:        'simulator',
  prevData:    null,
  favs:        loadFavs(),
  C: { sc: null, as: null, pw: null },
};

/* ── PERSIST ────────────────────────────────── */
function loadFavs()  { try { return JSON.parse(localStorage.getItem('fp8') || '[]'); } catch { return []; } }
function saveFavs()  { localStorage.setItem('fp8', JSON.stringify(S.favs)); updFavBadge(); }
function isFav(id, t){ return S.favs.some(f => f.id === id && f.type === t); }
function toggleFav(item) {
  const i = S.favs.findIndex(f => f.id === item.id && f.type === item.type);
  i >= 0 ? (S.favs.splice(i, 1), toast('Eliminado de favoritos', 'info'))
          : (S.favs.push(item),   toast('Añadido a favoritos', 'ok'));
  saveFavs();
}
function updFavBadge() {} // no badge in v8 sidebar

/* ── API ────────────────────────────────────── */
async function api(path) {
  try {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch(e) { console.warn('[API]', path, e.message); return null; }
}

/* ── SEASON UTILS ───────────────────────────── */
function actSid()    { return S.activeSid || S.seasons.at(-1)?.season_id || ''; }
function curSid()    { return actSid(); }
function curLid()    { return S.leagueId; }
function snLabel(id) {
  const s = S.seasons.find(s => String(s.season_id) === String(id || actSid()));
  return s ? fmtSn(s.season_name) : '2025/2026';
}
async function nextSeasonYear() {
  // Query backend — sorts by season_name DESC so '2025_2026' comes first
  // then returns the year AFTER it (e.g. '2026' → next season starts 2026)
  try {
    const data = await api('/predict/next-season-year');
    if (data?.year) return data.year;
  } catch (e) {}
  // Fallback: sort S.seasons by season_name descending, take first, add 1 year
  const sorted = [...S.seasons].sort((a, b) => b.season_name.localeCompare(a.season_name));
  if (!sorted.length) return '2026';
  const parts = sorted[0].season_name.split('_');
  return parts[1] || String(Number(parts[0]) + 1);
}
async function futureSeasonOptions() {
  const base = Number(await nextSeasonYear());
  return [0, 1, 2, 3].map(i => ({
    v: String(base + i),
    t: `${base + i}/${base + i + 1}`,
  }));
}

/* ── DEDUPLICATION ──────────────────────────── */
function dedupe(arr, key) {
  if (!arr?.length) return [];
  const m = new Map();
  for (const r of arr) {
    const k = (r.player_name || '').toLowerCase().trim();
    if (!m.has(k) || (r[key] ?? 0) > (m.get(k)[key] ?? 0)) m.set(k, r);
  }
  return [...m.values()].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
}
function dedupeGK(arr) {
  if (!arr?.length) return [];
  const m = new Map();
  for (const r of arr) {
    const k = (r.player_name || '').toLowerCase().trim();
    if (!m.has(k) || (r.clean_sheets ?? 0) > (m.get(k).clean_sheets ?? 0)) m.set(k, r);
  }
  return [...m.values()].filter(g => g.save_pct != null).sort((a, b) => (b.save_pct ?? 0) - (a.save_pct ?? 0));
}

/* ── NORMALIZE 0-100% ───────────────────────── */
// Uses avg_scored/avg_conceded from the new /api/predict/standings endpoint
// which returns per-season calculated stats, never mixed.
function normalizeTeams(arr) {
  if (!arr?.length) return [];
  const atks = arr.map(t => t.attack || 0);
  const defs = arr.map(t => t.defense || 0);
  const maxA = Math.max(...atks) || 1, minA = Math.min(...atks);
  const maxD = Math.max(...defs) || 1, minD = Math.min(...defs);
  return arr.map(t => {
    const ap = maxA === minA ? 50 : Math.round((t.attack - minA) / (maxA - minA) * 100);
    const dp = maxD === minD ? 50 : Math.round(100 - (t.defense - minD) / (maxD - minD) * 100);
    return { ...t, atkPct: ap, defPct: dp, score: Math.round(ap * .55 + dp * .45) };
  }).sort((a, b) => b.points - a.points || b.goal_diff - a.goal_diff);
}

/* ── DOM ────────────────────────────────────── */
const $ = id => document.getElementById(id);
function el(t, a = {}, ch = []) {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class')       e.className = v;
    else if (k === 'html')   e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(ch))
    c instanceof Node ? e.appendChild(c)
    : (c != null && c !== '' && e.appendChild(document.createTextNode(String(c))));
  return e;
}
function teamImg(name, style = '') {
  if (!name) return el('div', { style: `width:22px;height:22px;background:var(--c4);border-radius:4px;flex-shrink:0;${style}` });
  const slug = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const img  = el('img');
  img.src = `images/teams/${slug}.png`;
  img.alt = name;
  if (style) img.style.cssText = style;
  img.onerror = () => { img.onerror = null; img.src = 'images/default.png'; };
  return img;
}
function lgImg(name, style = '') {
  const slug = (name || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const img  = el('img');
  img.src = `images/leagues/${slug}.png`;
  img.alt = name;
  if (style) img.style.cssText = style;
  img.onerror = () => { img.onerror = null; img.src = 'images/default.png'; };
  return img;
}
function toast(msg, type = 'info', ms = 3000) {
  const t = el('div', { class: `toast ${type}` }, [msg]);
  $('toastZone').appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function ld()     { return el('div', { class: 'ld' }, [el('div', { class: 'spin' }), 'Cargando…']); }
function empt(m)  { return el('div', { class: 'empty' }, [el('div', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' }), el('p', {}, [m])]); }
function ini(n)   { return (n || '?').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase(); }
function fmtD(d)  { if (!d) return ''; const dt = new Date(d); return isNaN(dt) ? '' : dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }); }
function fmtLg(r) { return (r || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function fmtSn(r) { return (r || '').replace(/_/g, '/'); }
function syncCtx(id, v) { const e = $(id); if (e && e.value !== String(v)) e.value = String(v); }

/* ── NAVIGATION ─────────────────────────────── */
const TITLES = {
  simulator:   'Simulador de Temporada',
  matchPredict:'Predicción de Partido',
  montecarlo:  'Monte Carlo',
  standings:   'Clasificación',
  matches:     'Partidos',
  players:     'Jugadores',
  teams:       'Equipos',
  teamProfile: 'Equipo',
  playerProfile:'Jugador',
};

function nav(view, data = null) {
  if (!['teamProfile', 'playerProfile'].includes(view)) S.prev = S.view;
  S.view = view; S.prevData = data;
  document.querySelectorAll('.nl[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $('topbarTitle').textContent = (TITLES[view] || view).toUpperCase();
  const page = $('page');
  page.innerHTML = '';
  const wrap = el('div', { class: 'view' });
  page.appendChild(wrap);
  ({
    simulator:    () => vSimulator(wrap),
    matchPredict: () => vMatchPredict(wrap),
    montecarlo:   () => vMonteCarlo(wrap),
    standings:    () => vStandings(wrap),
    matches:      () => vMatches(wrap),
    players:      () => vPlayers(wrap),
    teams:        () => vTeams(wrap),
    teamProfile:  () => vTeamProfile(wrap, data),
    playerProfile:() => vPlayerProfile(wrap, data),
  }[view] || (() => vSimulator(wrap)))();
  if (window.innerWidth <= 900) { $('sidebar').classList.remove('open'); $('overlay').classList.add('hidden'); }
}

function mkSel(ph, opts, val = '', cls = 'f-sel') {
  const s = el('select', { class: cls });
  if (ph) s.appendChild(el('option', { value: '' }, [ph]));
  for (const o of opts) s.appendChild(el('option', { value: String(o.v) }, [o.t]));
  if (val !== undefined) s.value = String(val);
  return s;
}
function lgOpts() { return S.leagues.map(l => ({ v: l.league_id, t: fmtLg(l.league_name) })); }
function snOpts() { return S.seasons.map(s => ({ v: s.season_id, t: fmtSn(s.season_name) })); }

/* ══════════════════════════════════════════════════════════
   VIEW: SEASON SIMULATOR
   Uses /api/predict/season/:leagueId/:year?round=N
══════════════════════════════════════════════════════════ */
async function vSimulator(wrap) {
  wrap.appendChild(el('div', { class: 'pg-head' }, [
    el('h1', { class: 'pg-title' }, ['Simulador de Temporada']),
    el('p',  { class: 'pg-sub'  }, ['Predicción acumulativa jornada por jornada. Modelo Dixon-Coles + Poisson sobre 5 temporadas históricas.']),
  ]));

  const layout  = el('div', { class: 'sim-layout' }); wrap.appendChild(layout);
  const simPanel = el('div', { class: 'sim-panel' }); layout.appendChild(simPanel);

  simPanel.appendChild(el('h2', {}, ['Configurar']));
  simPanel.appendChild(el('p', { class: 'sim-sub' }, [
    'El motor genera cada jornada secuencialmente.\nLas jornadas predichas alimentan a las siguientes.',
  ]));

  const futOpts = await futureSeasonOptions();

  const lgGrp = el('div', { class: 'sim-form-grp' });
  lgGrp.appendChild(el('label', { class: 'sim-lbl' }, ['LIGA']));
  const lgSel = el('select', { class: 'sim-sel' });
  lgSel.appendChild(el('option', { value: '' }, ['— Seleccionar liga —']));
  S.leagues.forEach(l => lgSel.appendChild(el('option', { value: l.league_id }, [fmtLg(l.league_name)])));
  if (S.leagueId) lgSel.value = S.leagueId;
  lgGrp.appendChild(lgSel); simPanel.appendChild(lgGrp);

  const snGrp = el('div', { class: 'sim-form-grp' });
  snGrp.appendChild(el('label', { class: 'sim-lbl' }, ['TEMPORADA FUTURA']));
  const snSel = el('select', { class: 'sim-sel' });
  futOpts.forEach(o => snSel.appendChild(el('option', { value: o.v }, [o.t])));
  snGrp.appendChild(snSel); simPanel.appendChild(snGrp);

  const rdGrp = el('div', { class: 'sim-form-grp' });
  rdGrp.appendChild(el('label', { class: 'sim-lbl' }, ['HASTA JORNADA']));
  const rdWrap = el('div', { class: 'round-control' });
  const rdInp  = el('input', { type: 'number', class: 'round-input', value: '10', min: '1', max: '38', placeholder: '10' });
  const rdMax  = el('span', { class: 'round-max' }, ['/ 38']);
  rdWrap.appendChild(rdInp); rdWrap.appendChild(rdMax);
  rdGrp.appendChild(rdWrap); simPanel.appendChild(rdGrp);

  const simBtn  = el('button', { class: 'btn-simulate' }, ['SIMULAR TEMPORADA']);
  simBtn.disabled = !lgSel.value;
  simPanel.appendChild(simBtn);

  const progDiv = el('div', { class: 'sim-progress' });
  const progLbl = el('div', { class: 'prog-lbl' }, ['Generando jornada 1…']);
  const progBar = el('div', { class: 'prog-bar' });
  const progFill= el('div', { class: 'prog-fill', style: 'width:0%' });
  progBar.appendChild(progFill); progDiv.appendChild(progLbl); progDiv.appendChild(progBar);
  simPanel.appendChild(progDiv);

  lgSel.addEventListener('change', () => { S.leagueId = lgSel.value; syncCtx('gLeague', lgSel.value); simBtn.disabled = !lgSel.value; });

  // Results area
  const ra = el('div', { class: 'sim-results' });
  layout.appendChild(ra);

  ra.appendChild(el('div', { class: 'sim-empty' }, [
    el('div', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" opacity=".3"/><path d="M8 12l2.5 2.5L16 9"/></svg>' }),
    el('h3', {}, ['Configurar y simular']),
    el('p', {}, ['Selecciona una liga y temporada futura. El motor construirá cada jornada secuencialmente usando el histórico completo.']),
  ]));

  simBtn.addEventListener('click', async () => {
    const lid   = lgSel.value;
    const year  = snSel.value;
    const round = Math.max(1, Math.min(38, parseInt(rdInp.value) || 10));
    if (!lid) { toast('Selecciona una liga', 'err'); return; }

    simBtn.disabled = true; simBtn.textContent = 'Simulando…';
    progDiv.classList.add('active'); progLbl.textContent = 'Iniciando motor predictivo…'; progFill.style.width = '5%';

    ra.innerHTML = ''; ra.appendChild(ld());

    // Animate progress while waiting
    const progTimer = setInterval(() => {
      const cur = parseFloat(progFill.style.width) || 5;
      if (cur < 85) {
        const next = Math.min(85, cur + Math.random() * 12);
        progFill.style.width = next + '%';
        progLbl.textContent = `Generando jornada ${Math.round(next * round / 85)}…`;
      }
    }, 600);

    const data = await api(`/predict/season/${lid}/${year}?round=${round}`);
    clearInterval(progTimer);
    progFill.style.width = '100%';
    progLbl.textContent = 'Completado.';
    setTimeout(() => { progDiv.classList.remove('active'); progFill.style.width = '0%'; }, 2000);

    simBtn.disabled = false; simBtn.textContent = 'SIMULAR TEMPORADA';
    ra.innerHTML = '';

    if (!data || data.error) {
      ra.appendChild(el('div', { class: 'sim-empty' }, [
        el('h3', {}, ['Error en la simulación']),
        el('p', {}, [data?.error || 'Verifica que el backend esté corriendo con los nuevos archivos.']),
      ]));
      return;
    }

    renderSimResults(ra, data, round);
  });
}

function renderSimResults(container, data, targetRound) {
  // Season header
  const hdr = el('div', { class: 'card card-b mb12' });
  hdr.appendChild(el('div', { class: 'fca gap8', style: 'flex-wrap:wrap;' }, [
    el('div', { class: 'card-t', style: 'margin:0;' }, [`SIMULACIÓN · ${data.season}`]),
    el('span', { style: 'font-family:var(--fm);font-size:11px;color:var(--t2);margin-left:auto;' },
      [`${data.rounds_simulated} jornadas · ${data.teams_count} equipos · ${data.model}`]),
  ]));
  container.appendChild(hdr);

  // Tabs
  const tabs = el('div', { class: 'res-tabs' });
  const tStd = el('button', { class: 'res-tab active' }, ['Clasificación']);
  const tRnd = el('button', { class: 'res-tab' }, ['Resultados por jornada']);
  tabs.appendChild(tStd); tabs.appendChild(tRnd);
  container.appendChild(tabs);

  const tc = el('div', {}); container.appendChild(tc);

  function showStandings() {
    tc.innerHTML = '';
    if (!data.standings?.length) { tc.appendChild(empt('Sin datos de clasificación.')); return; }
    const w = el('div', { class: 'card std-wrap' });
    const t = el('table', { class: 'std-tbl' });
    const thead = el('thead'); const hr = el('tr');
    ['#', 'EQUIPO', 'PJ', 'G', 'E', 'P', 'GF', 'GC', 'DG', 'PTS', 'FORMA'].forEach((h, i) =>
      hr.appendChild(el('th', i < 2 ? {} : {}, [h])));
    thead.appendChild(hr); t.appendChild(thead);
    const tbody = el('tbody');
    data.standings.forEach((row, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', {}, [el('span', { class: 'std-pos' }, [String(i + 1)])]));
      const tc2 = el('td', {});
      const lnk = el('div', { class: 'std-tc' });
      lnk.appendChild(teamImg(row.team_name, 'width:18px;height:18px;object-fit:contain;'));
      lnk.appendChild(el('span', {}, [row.team_name || '—']));
      tc2.appendChild(lnk); tr.appendChild(tc2);
      [row.played, row.wins, row.draws, row.losses, row.goals_for, row.goals_against].forEach(v =>
        tr.appendChild(el('td', {}, [String(v ?? '—')])));
      const gdCell = el('td', { class: `std-gd${row.goal_diff >= 0 ? ' pos' : ' neg'}` }, [(row.goal_diff >= 0 ? '+' : '') + (row.goal_diff ?? '—')]);
      tr.appendChild(gdCell);
      tr.appendChild(el('td', { class: 'std-pts' }, [String(row.points ?? '—')]));
      // Form
      const fCell = el('td', {});
      const fr = el('div', { class: 'form-row', style: 'justify-content:flex-end;' });
      (row.form || []).forEach(r => fr.appendChild(el('div', { class: `fd fd-${r}` }, [r])));
      fCell.appendChild(fr); tr.appendChild(fCell);
      tbody.appendChild(tr);
    });
    t.appendChild(tbody); w.appendChild(t); tc.appendChild(w);
  }

  function showRounds() {
    tc.innerHTML = '';
    const rounds = Object.keys(data.round_results || {}).map(Number).sort((a, b) => a - b);
    if (!rounds.length) { tc.appendChild(empt('Sin resultados de jornadas.')); return; }

    // Round navigation
    const rnav = el('div', { class: 'round-nav' });
    let activeRound = rounds[0];

    const matchArea = el('div', {}); tc.appendChild(rnav); tc.appendChild(matchArea);

    function showRound(r) {
      activeRound = r;
      rnav.querySelectorAll('.round-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.r) === r));
      matchArea.innerHTML = '';
      const matches = data.round_results[String(r)] || [];
      if (!matches.length) { matchArea.appendChild(empt('Sin partidos.')); return; }
      const list = el('div', { class: 'match-list' });
      matches.forEach(m => list.appendChild(buildMatchCard(m)));
      matchArea.appendChild(list);
    }

    rounds.forEach(r => {
      const btn = el('button', { class: 'round-btn', 'data-r': String(r) }, [`J${r}`]);
      btn.addEventListener('click', () => showRound(r));
      rnav.appendChild(btn);
    });
    showRound(rounds[0]);
  }

  tStd.addEventListener('click', () => { tStd.className = 'res-tab active'; tRnd.className = 'res-tab'; showStandings(); });
  tRnd.addEventListener('click', () => { tRnd.className = 'res-tab active'; tStd.className = 'res-tab'; showRounds(); });
  showStandings();
}

function buildMatchCard(m) {
  const card = el('div', { class: 'match-card' });
  const pred  = m.prediction;

  const home = el('div', { class: 'match-team' });
  home.appendChild(teamImg(m.home_team, 'width:20px;height:20px;object-fit:contain;'));
  home.appendChild(el('span', { class: 'match-team-name' }, [m.home_team || '—']));
  card.appendChild(home);

  const cen = el('div', { class: 'match-center' });
  const hasScore = m.home_goals != null && m.away_goals != null;
  cen.appendChild(el('div', { class: 'match-score' }, [hasScore ? `${m.home_goals} – ${m.away_goals}` : 'vs']));
  if (m.match_date) cen.appendChild(el('div', { class: 'match-meta' }, [fmtD(m.match_date)]));

  if (pred) {
    const probs = el('div', { class: 'match-probs' });
    probs.appendChild(el('span', { class: 'prob-tag prob-h' }, [`${pred.prob_home}%`]));
    probs.appendChild(el('span', { class: 'prob-tag prob-d' }, [`${pred.prob_draw}%`]));
    probs.appendChild(el('span', { class: 'prob-tag prob-a' }, [`${pred.prob_away}%`]));
    cen.appendChild(probs);
    cen.appendChild(el('div', { class: 'match-meta' }, [`Pred: ${pred.most_likely_score}`]));
  }
  card.appendChild(cen);

  const away = el('div', { class: 'match-team r' });
  away.appendChild(el('span', { class: 'match-team-name' }, [m.away_team || '—']));
  away.appendChild(teamImg(m.away_team, 'width:20px;height:20px;object-fit:contain;'));
  card.appendChild(away);
  return card;
}

/* ══════════════════════════════════════════════════════════
   VIEW: MATCH PREDICT
   Uses /api/predict/match/:leagueId/:home/:away
══════════════════════════════════════════════════════════ */
async function vMatchPredict(wrap) {
  wrap.appendChild(el('div', { class: 'pg-head' }, [
    el('h1', { class: 'pg-title' }, ['Predicción de Partido']),
    el('p',  { class: 'pg-sub'  }, ['Selecciona los equipos y presiona ANALIZAR. Usa histórico completo de 5 temporadas.']),
  ]));

  const layout = el('div', { class: 'pred-layout' }); wrap.appendChild(layout);

  /* Form */
  const fc = el('div', { class: 'pred-form-card' });
  fc.appendChild(el('h2', {}, ['Configurar']));
  fc.appendChild(el('p', { class: 'pf-sub' }, ['Modelo Dixon-Coles · Histórico completo · Explicabilidad incluida.']));

  const lgGrp = el('div', { class: 'pf-grp' });
  lgGrp.appendChild(el('label', { class: 'pf-lbl' }, ['LIGA']));
  const lgSel = el('select', { class: 'pf-sel' });
  lgSel.appendChild(el('option', { value: '' }, ['— Seleccionar —']));
  S.leagues.forEach(l => lgSel.appendChild(el('option', { value: l.league_id }, [fmtLg(l.league_name)])));
  if (S.leagueId) lgSel.value = S.leagueId;
  lgGrp.appendChild(lgSel); fc.appendChild(lgGrp);

  const hGrp = el('div', { class: 'pf-grp' });
  hGrp.appendChild(el('label', { class: 'pf-lbl' }, ['EQUIPO LOCAL']));
  const hSel = el('select', { class: 'pf-sel' }); hSel.disabled = true;
  hSel.appendChild(el('option', { value: '' }, ['— Primero selecciona liga —']));
  hGrp.appendChild(hSel); fc.appendChild(hGrp);

  const aGrp = el('div', { class: 'pf-grp' });
  aGrp.appendChild(el('label', { class: 'pf-lbl' }, ['EQUIPO VISITANTE']));
  const aSel = el('select', { class: 'pf-sel' }); aSel.disabled = true;
  aSel.appendChild(el('option', { value: '' }, ['— Primero selecciona liga —']));
  aGrp.appendChild(aSel); fc.appendChild(aGrp);

  const btn = el('button', { class: 'btn-analyze' }, ['ANALIZAR']); btn.disabled = true;
  fc.appendChild(btn);
  layout.appendChild(fc);

  const ra = el('div', {});
  ra.appendChild(el('div', { class: 'pred-result-empty' }, [
    el('div', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' }),
    el('p', {}, ['Selecciona liga y equipos, luego presiona ANALIZAR.']),
  ]));
  layout.appendChild(ra);

  async function loadTeams(lid) {
    hSel.disabled = aSel.disabled = btn.disabled = true;
    hSel.innerHTML = aSel.innerHTML = '';
    hSel.appendChild(el('option', { value: '' }, ['Cargando…']));
    // Use teams that exist in the recent season
    const teams = await api(`/teams/league/${lid}/season/${actSid()}`)
                || await api(`/teams/league/${lid}`);
    hSel.innerHTML = aSel.innerHTML = '';
    if (!teams?.length) { hSel.appendChild(el('option', { value: '' }, ['Sin equipos'])); return; }
    const d = () => el('option', { value: '' }, ['— Seleccionar —']);
    hSel.appendChild(d()); aSel.appendChild(d());
    teams.forEach(t => {
      hSel.appendChild(el('option', { value: t.team_name }, [t.team_name]));
      aSel.appendChild(el('option', { value: t.team_name }, [t.team_name]));
    });
    hSel.disabled = aSel.disabled = false;
  }
  const chk = () => { btn.disabled = !(hSel.value && aSel.value && hSel.value !== aSel.value); };
  lgSel.addEventListener('change', () => { S.leagueId = lgSel.value; syncCtx('gLeague', lgSel.value); if (lgSel.value) loadTeams(lgSel.value); });
  hSel.addEventListener('change', chk); aSel.addEventListener('change', chk);
  if (S.leagueId) loadTeams(S.leagueId);

  btn.addEventListener('click', async () => {
    const lid = lgSel.value, ht = hSel.value, at = aSel.value;
    if (!lid || !ht || !at || ht === at) return;
    btn.textContent = 'ANALIZANDO…'; btn.disabled = true;
    ra.innerHTML = ''; ra.appendChild(ld());

    // Fetch prediction + h2h + form (for explanation)
    const [pred, h2h, hFm, aFm] = await Promise.all([
      api(`/predict/match/${lid}/${encodeURIComponent(ht)}/${encodeURIComponent(at)}`),
      api(`/h2h/${encodeURIComponent(ht)}/${encodeURIComponent(at)}`),
      api(`/form/${encodeURIComponent(ht)}`),
      api(`/form/${encodeURIComponent(at)}`),
    ]);

    btn.textContent = 'ANALIZAR'; btn.disabled = false;
    ra.innerHTML = '';

    if (!pred || pred.error) {
      ra.appendChild(empt(pred?.error || 'Error al calcular predicción. Verifica el backend.'));
      return;
    }

    renderMatchPredResult(ra, pred, h2h, hFm, aFm);
  });
}

function renderMatchPredResult(container, pred, h2h, hFm, aFm) {
  // Main prediction block
  const pm = el('div', { class: 'pred-main' });
  pm.appendChild(el('div', { class: 'pred-lbl' }, ['PREDICCIÓN IA · ' + (pred.data_source || 'Histórico completo')]));

  // Matchup header
  const mh = el('div', { class: 'mu-hdr' });
  const hb = el('div', { class: 'mu-team' });
  hb.appendChild(teamImg(pred.home_team, 'width:44px;height:44px;object-fit:contain;'));
  hb.appendChild(el('span', { class: 'mu-team-name' }, [pred.home_team]));
  mh.appendChild(hb); mh.appendChild(el('span', { class: 'mu-vs' }, ['VS']));
  const ab = el('div', { class: 'mu-team' });
  ab.appendChild(teamImg(pred.away_team, 'width:44px;height:44px;object-fit:contain;'));
  ab.appendChild(el('span', { class: 'mu-team-name' }, [pred.away_team]));
  mh.appendChild(ab); pm.appendChild(mh);

  // Probabilities
  const pr = el('div', { class: 'pred-probs' });
  const mkP = (pct, lbl, cls, nm) => {
    const b = el('div', { class: 'pprob' });
    b.appendChild(el('div', { class: `ppct ${cls}` }, [`${pct}%`]));
    b.appendChild(el('span', { class: 'p-lbl' }, [lbl]));
    b.appendChild(el('div', { class: 'p-nm' }, [nm]));
    return b;
  };
  pr.appendChild(mkP(pred.prob_home, 'LOCAL', 'home', pred.home_team));
  pr.appendChild(mkP(pred.prob_draw, 'EMPATE', 'draw', 'Empate'));
  pr.appendChild(mkP(pred.prob_away, 'VISITANTE', 'away', pred.away_team));
  pm.appendChild(pr);

  const ps = el('div', { class: 'pred-score-row' });
  ps.appendChild(el('div', { class: 'pred-score-val' }, [`${pred.expected_home} – ${pred.expected_away}`]));
  ps.appendChild(el('div', { class: 'pred-score-lbl' }, [`RESULTADO ESPERADO · ${pred.most_likely_score} MÁS PROBABLE (${pred.score_prob}%)`]));
  pm.appendChild(ps);

  // Confidence
  const conf = el('div', { style: `margin-top:10px;text-align:center;font-family:var(--fm);font-size:10px;color:var(--t2);letter-spacing:1px;` },
    [`CONFIANZA DEL MODELO: ${pred.confidence}% · OUTCOME: ${pred.outcome?.toUpperCase()}`]);
  pm.appendChild(conf);
  container.appendChild(pm);

  // Explanation panels
  const panels = el('div', { class: 'exp-panels' });

  // Factor comparison
  if (pred.factors) {
    const f = pred.factors;
    const p1 = el('div', { class: 'exp-panel' });
    p1.appendChild(el('p', { class: 'exp-title' }, ['Fortaleza ofensiva y defensiva · Histórico completo']));

    const atk = el('div', { class: 'factor-grid' });
    const hAtk = el('div', { class: 'fg-side' }); hAtk.appendChild(el('div', { class: 'fg-val cg' }, [f.home_attack.toFixed(3)])); hAtk.appendChild(el('div', { class: 'fg-lbl' }, ['ATAQUE LOCAL']));
    const aAtk = el('div', { class: 'fg-side' }); aAtk.appendChild(el('div', { class: 'fg-val cg' }, [f.away_attack.toFixed(3)])); aAtk.appendChild(el('div', { class: 'fg-lbl' }, ['ATAQUE VISIT.']));
    atk.appendChild(hAtk); atk.appendChild(el('div', { class: 'fg-sep' }, ['vs'])); atk.appendChild(aAtk);
    p1.appendChild(atk);

    const def = el('div', { class: 'factor-grid' });
    const hDef = el('div', { class: 'fg-side' }); hDef.appendChild(el('div', { class: 'fg-val cb' }, [f.home_defense.toFixed(3)])); hDef.appendChild(el('div', { class: 'fg-lbl' }, ['DEFENSA LOCAL']));
    const aDef = el('div', { class: 'fg-side' }); aDef.appendChild(el('div', { class: 'fg-val cb' }, [f.away_defense.toFixed(3)])); aDef.appendChild(el('div', { class: 'fg-lbl' }, ['DEFENSA VISIT.']));
    def.appendChild(hDef); def.appendChild(el('div', { class: 'fg-sep' }, ['vs'])); def.appendChild(aDef);
    p1.appendChild(def);

    const lm = el('div', { style: 'margin-top:9px;text-align:center;font-family:var(--fm);font-size:9.5px;color:var(--t2);letter-spacing:.5px;' },
      [`λ Local = ${pred.lambda_home} · λ Visitante = ${pred.lambda_away} · μ Liga = ${f.league_mu} · Ventaja local = ×${f.home_advantage}`]);
    p1.appendChild(lm);
    panels.appendChild(p1);
  }

  // Form comparison
  if (hFm?.length || aFm?.length) {
    const p2 = el('div', { class: 'exp-panel' });
    p2.appendChild(el('p', { class: 'exp-title' }, ['Forma reciente']));
    const fc = el('div', { class: 'form-compare' });
    if (hFm?.length) {
      const hc = el('div', {}); hc.appendChild(el('p', { class: 'form-col-lbl' }, [pred.home_team.toUpperCase()]));
      const fd = el('div', { class: 'form-dots' });
      hFm.forEach(f => fd.appendChild(el('div', { class: `fd-sm ${f.result}` }, [f.result])));
      hc.appendChild(fd); fc.appendChild(hc);
    }
    if (aFm?.length) {
      const ac = el('div', {}); ac.appendChild(el('p', { class: 'form-col-lbl' }, [pred.away_team.toUpperCase()]));
      const fd = el('div', { class: 'form-dots' });
      aFm.forEach(f => fd.appendChild(el('div', { class: `fd-sm ${f.result}` }, [f.result])));
      ac.appendChild(fd); fc.appendChild(ac);
    }
    p2.appendChild(fc); panels.appendChild(p2);
  }

  // H2H
  const p3 = el('div', { class: 'exp-panel' });
  p3.appendChild(el('p', { class: 'exp-title' }, ['Head to Head']));
  if (h2h?.length) {
    const list = el('div', { class: 'h2h-list' });
    h2h.slice(0, 8).forEach(m => {
      const row = el('div', { class: 'h2h-row' });
      row.appendChild(el('span', { class: 'h2h-tn' }, [m.home_team || '—']));
      const cen = el('div', {});
      cen.appendChild(el('div', { class: 'h2h-sc' }, [`${m.home_goals ?? '?'} – ${m.away_goals ?? '?'}`]));
      cen.appendChild(el('span', { class: 'h2h-dt' }, [fmtD(m.match_date)]));
      row.appendChild(cen);
      row.appendChild(el('span', { class: 'h2h-tn r' }, [m.away_team || '—']));
      list.appendChild(row);
    });
    p3.appendChild(list);
  } else {
    p3.appendChild(el('p', { style: 'color:var(--t2);font-size:12.5px;' }, ['Sin enfrentamientos previos registrados.']));
  }
  panels.appendChild(p3);

  container.appendChild(panels);
}

/* ══════════════════════════════════════════════════════════
   VIEW: MONTE CARLO
   Uses /api/predict/montecarlo/:leagueId/:year?sims=N
══════════════════════════════════════════════════════════ */
async function vMonteCarlo(wrap) {
  wrap.appendChild(el('div', { class: 'pg-head' }, [
    el('h1', { class: 'pg-title' }, ['Monte Carlo']),
    el('p',  { class: 'pg-sub'  }, ['N simulaciones completas de temporada. Devuelve probabilidades de título, top-4 y descenso.']),
  ]));

  const bar = el('div', { class: 'fbar' });
  const lg  = mkSel('— Liga —', lgOpts(), curLid(), 'f-sel');
  const _futOpts = await futureSeasonOptions();
  const fut = mkSel(null, _futOpts, _futOpts[0]?.v, 'f-sel');
  const si  = el('div', { class: 'f-grp' });
  si.appendChild(el('span', { class: 'f-lbl' }, ['SIMULACIONES']));
  const siInp = el('input', { type: 'number', class: 'f-inp', value: '500', min: '100', max: '2000' });
  si.appendChild(siInp);
  const btn = el('button', { class: 'btn btn-g btn-sm' }, ['EJECUTAR']);
  btn.disabled = !lg.value;
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['LIGA']), lg]));
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['TEMPORADA']), fut]));
  bar.appendChild(si);
  bar.appendChild(btn);
  wrap.appendChild(bar);

  lg.addEventListener('change', () => { S.leagueId = lg.value; syncCtx('gLeague', lg.value); btn.disabled = !lg.value; });

  const con = el('div', {}); wrap.appendChild(con);
  con.appendChild(empt('Selecciona liga, temporada y ejecuta Monte Carlo.'));

  btn.addEventListener('click', async () => {
    const lid  = lg.value, year = fut.value, sims = Math.min(2000, Math.max(100, parseInt(siInp.value) || 500));
    if (!lid) { toast('Selecciona una liga', 'err'); return; }
    btn.disabled = true; btn.textContent = 'Simulando…';
    con.innerHTML = ''; con.appendChild(ld());

    const data = await api(`/predict/montecarlo/${lid}/${year}?sims=${sims}`);
    btn.disabled = false; btn.textContent = 'EJECUTAR';
    con.innerHTML = '';

    if (!data || data.error) { con.appendChild(empt(data?.error || 'Error en Monte Carlo.')); return; }

    const info = el('div', { class: 'card card-b mb12' });
    info.appendChild(el('div', { class: 'fca' }, [
      el('span', { class: 'card-t', style: 'margin:0;' }, [`MONTE CARLO · ${data.season}`]),
      el('span', { style: 'font-family:var(--fm);font-size:11px;color:var(--t2);margin-left:auto;' }, [`${data.simulations} simulaciones completas`]),
    ]));
    con.appendChild(info);

    const grid = el('div', { class: 'mc-grid' });

    const mkMCCard = (title, probMap, barCls, thresholdPct) => {
      const c = el('div', { class: 'mc-card' });
      c.appendChild(el('p', { class: 'mc-card-title' }, [title]));
      const sorted = Object.entries(probMap).sort((a, b) => b[1] - a[1]).slice(0, 20);
      sorted.forEach(([team, pct]) => {
        const row = el('div', { class: 'mc-team-row' });
        row.appendChild(el('span', { class: 'mc-team-name' }, [team]));
        const bw = el('div', { class: 'mc-bar-wrap' });
        const bf = el('div', { class: `mc-bar ${barCls}`, style: `width:${Math.min(100, pct)}%` });
        bw.appendChild(bf); row.appendChild(bw);
        const pEl = el('span', { class: 'mc-pct' }, [`${pct}%`]);
        pEl.style.color = pct >= thresholdPct ? `var(--${barCls === 'champ' ? 'g' : barCls === 'top4' ? 'blue' : 'lose'})` : 'var(--t2)';
        row.appendChild(pEl);
        c.appendChild(row);
      });
      return c;
    };

    if (data.championship_probs) grid.appendChild(mkMCCard('Probabilidad de Título', data.championship_probs, 'champ', 20));
    if (data.top4_probs)         grid.appendChild(mkMCCard('Probabilidad Top-4 / Champions', data.top4_probs, 'top4', 50));
    if (data.relegation_probs)   grid.appendChild(mkMCCard('Probabilidad de Descenso', data.relegation_probs, 'rel', 20));

    con.appendChild(grid);
  });
}

/* ══════════════════════════════════════════════════════════
   VIEW: STANDINGS (uses season-correct new endpoint)
══════════════════════════════════════════════════════════ */
async function vStandings(wrap) {
  wrap.appendChild(el('div', { class: 'pg-head' }, [el('h1', { class: 'pg-title' }, ['Clasificación']), el('p', { class: 'pg-sub' }, ['Calculada directamente por temporada — sin mezcla de temporadas.'])]));

  const bar = el('div', { class: 'fbar' });
  const ls  = mkSel('— Liga —',       lgOpts(), curLid());
  const ss  = mkSel('— Temporada —',  snOpts(), curSid());
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['LIGA']), ls]));
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['TEMPORADA']), ss]));
  wrap.appendChild(bar);

  const con = el('div', {}); wrap.appendChild(con);

  async function load() {
    const lid = ls.value, sid = ss.value;
    con.innerHTML = '';
    if (!lid || !sid) { con.appendChild(empt('Selecciona liga y temporada.')); return; }
    con.appendChild(ld());
    // Use the new season-correct endpoint
    const data = await api(`/predict/standings/${lid}/${sid}`);
    con.innerHTML = '';
    if (!data?.length) { con.appendChild(empt('Sin datos.')); return; }

    const normalized = normalizeTeams(data);
    const w = el('div', { class: 'card std-wrap' });
    const t = el('table', { class: 'std-tbl' });
    const thead = el('thead'); const hr = el('tr');
    ['#', 'EQUIPO', 'PJ', 'G', 'E', 'P', 'GF', 'GC', 'DG', 'PTS'].forEach((h, i) => hr.appendChild(el('th', {}, [h])));
    thead.appendChild(hr); t.appendChild(thead);
    const tbody = el('tbody');
    normalized.forEach((row, i) => {
      const tr = el('tr');
      tr.addEventListener('click', () => nav('teamProfile', { name: row.team_name, leagueId: lid, seasonId: sid }));
      tr.appendChild(el('td', {}, [el('span', { class: 'std-pos' }, [String(i + 1)])]));
      const tc = el('td', {}); const lnk = el('div', { class: 'std-tc' });
      lnk.appendChild(teamImg(row.team_name, 'width:16px;height:16px;object-fit:contain;'));
      lnk.appendChild(el('span', {}, [row.team_name || '—']));
      tc.appendChild(lnk); tr.appendChild(tc);
      [row.played, row.wins, row.draws, row.losses, row.goals_for, row.goals_against].forEach(v => tr.appendChild(el('td', {}, [String(v ?? '—')])));
      const gd = row.goal_diff ?? 0;
      tr.appendChild(el('td', { class: `std-gd${gd >= 0 ? ' pos' : ' neg'}` }, [(gd >= 0 ? '+' : '') + gd]));
      tr.appendChild(el('td', { class: 'std-pts' }, [String(row.points ?? '—')]));
      tbody.appendChild(tr);
    });
    t.appendChild(tbody); w.appendChild(t); con.appendChild(w);
  }

  ls.addEventListener('change', () => { S.leagueId = ls.value; syncCtx('gLeague', ls.value); load(); });
  ss.addEventListener('change', load);
  if (ls.value && ss.value) load();
  else con.appendChild(empt('Selecciona liga y temporada.'));
}

/* ══════════════════════════════════════════════════════════
   VIEW: MATCHES
══════════════════════════════════════════════════════════ */
async function vMatches(wrap) {
  wrap.appendChild(el('div', { class: 'pg-head' }, [el('h1', { class: 'pg-title' }, ['Partidos'])]));
  const bar = el('div', { class: 'fbar' });
  const ls  = mkSel('— Liga —',      lgOpts(), curLid());
  const ss  = mkSel('— Temporada —', [{ v: '', t: 'Todas' }, ...snOpts()], curSid());
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['LIGA']), ls]));
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['TEMPORADA']), ss]));
  wrap.appendChild(bar);
  let all = [], pg = 0;
  const con = el('div', {}); wrap.appendChild(con);

  async function load() {
    pg = 0; all = [];
    const lid = ls.value, sid = ss.value;
    con.innerHTML = '';
    if (!lid) { con.appendChild(empt('Selecciona una liga.')); return; }
    con.appendChild(ld());
    const data = sid ? await api(`/matches/league/${lid}/season/${sid}`) : await api(`/matches/league/${lid}`);
    con.innerHTML = '';
    if (!data?.length) { con.appendChild(empt('Sin partidos.')); return; }
    all = data; render();
  }
  function render() {
    con.innerHTML = '';
    const slice = all.slice(pg * PAGE, (pg + 1) * PAGE);
    const list = el('div', { class: 'match-list' });
    slice.forEach(m => list.appendChild(mkHistoricalMatchCard(m)));
    con.appendChild(list);
    const tp = Math.ceil(all.length / PAGE);
    if (tp > 1) con.appendChild(mkPgn(pg, tp, p => { pg = p; render(); }));
  }
  ls.addEventListener('change', () => { S.leagueId = ls.value; syncCtx('gLeague', ls.value); load(); });
  ss.addEventListener('change', load);
  if (ls.value) load(); else con.appendChild(empt('Selecciona una liga.'));
}

function mkHistoricalMatchCard(m) {
  const card = el('div', { class: 'match-card' });
  const home = el('div', { class: 'match-team' });
  home.appendChild(teamImg(m.home_team, 'width:20px;height:20px;object-fit:contain;'));
  const hn = el('span', { class: 'match-team-name' }, [m.home_team || '—']);
  hn.addEventListener('click', e => { e.stopPropagation(); if (m.home_team) nav('teamProfile', { name: m.home_team }); });
  home.appendChild(hn); card.appendChild(home);
  const cen = el('div', { class: 'match-center' });
  const hs = m.home_goals != null && m.away_goals != null;
  cen.appendChild(el('div', { class: 'match-score' }, [hs ? `${m.home_goals} – ${m.away_goals}` : 'vs']));
  cen.appendChild(el('div', { class: 'match-meta' }, [fmtD(m.match_date)]));
  card.appendChild(cen);
  const away = el('div', { class: 'match-team r' });
  const an   = el('span', { class: 'match-team-name' }, [m.away_team || '—']);
  an.addEventListener('click', e => { e.stopPropagation(); if (m.away_team) nav('teamProfile', { name: m.away_team }); });
  away.appendChild(an); away.appendChild(teamImg(m.away_team, 'width:20px;height:20px;object-fit:contain;'));
  card.appendChild(away);
  return card;
}

function mkPgn(cur, total, onP) {
  const p = el('div', { style: 'display:flex;align-items:center;gap:5px;margin-top:12px;justify-content:center;flex-wrap:wrap;' });
  const prev = el('button', { class: 'round-btn' }, ['‹']); if (!cur) prev.disabled = true;
  prev.addEventListener('click', () => onP(cur - 1)); p.appendChild(prev);
  let s = Math.max(0, cur - 3), e = Math.min(total, s + 7);
  if (e - s < 7) s = Math.max(0, e - 7);
  for (let i = s; i < e; i++) {
    const b = el('button', { class: `round-btn${i === cur ? ' active' : ''}` }, [String(i + 1)]);
    b.addEventListener('click', () => onP(i)); p.appendChild(b);
  }
  const next = el('button', { class: 'round-btn' }, ['›']); if (cur >= total - 1) next.disabled = true;
  next.addEventListener('click', () => onP(cur + 1)); p.appendChild(next);
  return p;
}

/* ══════════════════════════════════════════════════════════
   VIEW: PLAYERS (season-correct)
══════════════════════════════════════════════════════════ */
async function vPlayers(wrap) {
  wrap.appendChild(el('div', { class: 'pg-head' }, [el('h1', { class: 'pg-title' }, ['Jugadores']), el('p', { class: 'pg-sub' }, ['Filtrados por liga y temporada.'])]));
  const bar = el('div', { class: 'fbar' });
  const ls  = mkSel('Todas las ligas', [{ v: '', t: 'Todas' }, ...lgOpts()], curLid());
  const ss  = mkSel('— Temporada —',   snOpts(), curSid());
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['LIGA']), ls]));
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['TEMPORADA']), ss]));
  wrap.appendChild(bar);

  let tab = 'sc';
  const tabRow = el('div', { class: 'fca gap8 mb12' });
  const tS = el('button', { class: 'btn btn-g btn-sm' }, ['Goleadores']);
  const tA = el('button', { class: 'btn btn-ghost btn-sm' }, ['Asistentes']);
  tabRow.appendChild(tS); tabRow.appendChild(tA); wrap.appendChild(tabRow);

  const con = el('div', {}); wrap.appendChild(con);
  let cSc = null, cAs = null;

  async function load() {
    con.innerHTML = ''; con.appendChild(ld());
    const lid = ls.value, sid = ss.value;
    if (lid && sid) {
      [cSc, cAs] = await Promise.all([
        api(`/topscorers/league/${lid}/season/${sid}`),
        api(`/topassists/league/${lid}/season/${sid}`),
      ]);
    } else if (lid) {
      [cSc, cAs] = await Promise.all([api(`/topscorers/league/${lid}`), api(`/topassists/league/${lid}`)]);
    } else {
      [cSc, cAs] = await Promise.all([api('/topscorers'), api('/topassists')]);
    }
    // Always deduplicate even with season filter (defensive)
    if (!sid) { cSc = dedupe(cSc, 'goals'); cAs = dedupe(cAs, 'assists'); }
    S.C.sc = cSc; S.C.as = cAs;
    con.innerHTML = ''; render();
  }

  function render() {
    con.innerHTML = '';
    const data = tab === 'sc' ? cSc : cAs;
    const vk   = tab === 'sc' ? 'goals' : 'assists';
    const vl   = tab === 'sc' ? 'GOLES' : 'ASIST.';
    if (!data?.length) { con.appendChild(empt('Sin datos para este filtro.')); return; }
    const w = el('div', { class: 'card ptbl-wrap' });
    const t = el('table', { class: 'ptbl' });
    const thead = el('thead'); const hr = el('tr');
    ['#', 'JUGADOR', 'EQUIPO', vl].forEach((h, i) => hr.appendChild(el('th', i === 3 ? { class: 'r' } : {}, [h])));
    thead.appendChild(hr); t.appendChild(thead);
    const tbody = el('tbody');
    data.forEach((p, i) => {
      const tr = el('tr');
      tr.addEventListener('click', () => nav('playerProfile', { name: p.player_name, team: p.team_name, seasonId: ss.value }));
      tr.appendChild(el('td', { style: 'font-family:var(--fm);font-size:11px;color:var(--t2);width:24px;' }, [String(i + 1)]));
      const ntd = el('td', {}); const nd = el('div', { class: 'pnc' });
      nd.appendChild(el('div', { class: 'pav' }, [ini(p.player_name)]));
      nd.appendChild(el('span', { class: 'pnm' }, [p.player_name || '—']));
      ntd.appendChild(nd); tr.appendChild(ntd);
      const ttd = el('td', {}); if (p.team_name) { const li = teamImg(p.team_name, 'width:14px;height:14px;object-fit:contain;display:inline-block;vertical-align:middle;margin-right:4px;'); ttd.appendChild(li); ttd.appendChild(document.createTextNode(p.team_name)); } else ttd.textContent = '—'; tr.appendChild(ttd);
      tr.appendChild(el('td', { class: tab === 'sc' ? 'td-g' : 'td-a' }, [String(p[vk] ?? '—')]));
      tbody.appendChild(tr);
    });
    t.appendChild(tbody); w.appendChild(t); con.appendChild(w);
  }

  tS.addEventListener('click', () => { tab = 'sc'; tS.className = 'btn btn-g btn-sm'; tA.className = 'btn btn-ghost btn-sm'; render(); });
  tA.addEventListener('click', () => { tab = 'as'; tS.className = 'btn btn-ghost btn-sm'; tA.className = 'btn btn-g btn-sm'; render(); });
  ls.addEventListener('change', () => { S.leagueId = ls.value; load(); });
  ss.addEventListener('change', load);
  load();
}

/* ══════════════════════════════════════════════════════════
   VIEW: TEAMS
══════════════════════════════════════════════════════════ */
async function vTeams(wrap) {
  wrap.appendChild(el('div', { class: 'pg-head' }, [el('h1', { class: 'pg-title' }, ['Equipos']), el('p', { class: 'pg-sub' }, ['Clasificados por rendimiento de la temporada seleccionada.'])]));
  const bar = el('div', { class: 'fbar' });
  const ls  = mkSel('— Liga —',      lgOpts(), curLid());
  const ss  = mkSel('— Temporada —', snOpts(), curSid());
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['LIGA']), ls]));
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['TEMPORADA']), ss]));
  wrap.appendChild(bar);
  const con = el('div', {}); wrap.appendChild(con);

  async function load() {
    const lid = ls.value, sid = ss.value;
    con.innerHTML = '';
    if (!lid || !sid) { con.appendChild(empt('Selecciona liga y temporada.')); return; }
    con.appendChild(ld());
    const data = await api(`/predict/standings/${lid}/${sid}`);
    con.innerHTML = '';
    if (!data?.length) { con.appendChild(empt('Sin equipos.')); return; }
    const teams = normalizeTeams(data);
    const card = el('div', { class: 'card card-b' });
    teams.forEach(t => {
      const row = el('div', { class: 'team-row' });
      row.addEventListener('click', () => nav('teamProfile', { name: t.team_name, leagueId: lid, seasonId: sid }));
      row.appendChild(teamImg(t.team_name, 'width:20px;height:20px;object-fit:contain;flex-shrink:0;'));
      row.appendChild(el('span', { class: 'team-row-name' }, [t.team_name || '—']));
      const bars = el('div', { class: 'team-bars' });
      bars.appendChild(tbar('ATK', t.atkPct, 'tbar-fg-a'));
      bars.appendChild(tbar('DEF', t.defPct, 'tbar-fg-d'));
      row.appendChild(bars);
      const pts = el('div', { class: 'team-pcts' });
      pts.appendChild(el('span', { class: 'tp-a' }, [`${t.atkPct}%`]));
      pts.appendChild(el('span', { class: 'tp-d' }, [`${t.defPct}%`]));
      row.appendChild(pts);
      card.appendChild(row);
    });
    con.appendChild(card);
  }
  function tbar(lbl, pct, cls) { const r = el('div', { class: 'tbar-row' }); r.appendChild(el('span', { class: 'tbar-lbl' }, [lbl])); const bg = el('div', { class: 'tbar-bg' }); bg.appendChild(el('div', { class: `tbar-fg ${cls}`, style: `width:${pct}%` })); r.appendChild(bg); return r; }
  ls.addEventListener('change', () => { S.leagueId = ls.value; load(); });
  ss.addEventListener('change', load);
  if (ls.value && ss.value) load(); else con.appendChild(empt('Selecciona liga y temporada.'));
}

/* ══════════════════════════════════════════════════════════
   PROFILE VIEWS (simplified — data from season-correct endpoints)
══════════════════════════════════════════════════════════ */
async function vTeamProfile(wrap, data) {
  const { name, leagueId, seasonId } = data || {};
  if (!name) { nav('teams'); return; }
  const back = el('div', { class: 'back' });
  back.innerHTML = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="12 3 6 9 12 15"/></svg> Volver';
  back.addEventListener('click', () => nav(S.prev || 'teams'));
  wrap.appendChild(back);
  const con = el('div', {}); wrap.appendChild(con); con.appendChild(ld());

  const sid = seasonId || actSid();
  const lid = leagueId || curLid();

  const [standings, formArr, goalsArr] = await Promise.all([
    lid && sid ? api(`/predict/standings/${lid}/${sid}`) : null,
    api(`/form/${encodeURIComponent(name)}`),
    api(`/teamgoals/${encodeURIComponent(name)}`),
  ]);
  con.innerHTML = '';

  const teamRow = standings?.find(t => t.team_name === name);
  const goals   = goalsArr?.[0];
  const form    = formArr || [];

  // Hero
  const hero = el('div', { class: 'prof-hero' });
  const lb   = el('div', { class: 'prof-logo-box' });
  lb.appendChild(teamImg(name, 'width:66px;height:66px;object-fit:contain;'));
  hero.appendChild(lb);
  const bd = el('div', { class: 'prof-body' });
  bd.appendChild(el('h1', { class: 'prof-name' }, [name]));
  const pills = el('div', { class: 'prof-pills' });
  if (teamRow?.points != null) pills.appendChild(el('span', { class: 'pill pill-g' }, [`${teamRow.points} PTS`]));
  if (teamRow?.played != null) pills.appendChild(el('span', { class: 'pill pill-d' }, [`${teamRow.played} PJ`]));
  bd.appendChild(pills);
  hero.appendChild(bd); con.appendChild(hero);

  if (teamRow) {
    const boxes = el('div', { class: 'sboxes' });
    const sb = (v, l, cls) => { const b = el('div', { class: `sbox${cls ? ' '+cls : ''}` }); b.appendChild(el('div', { class: 'sv' }, [String(v ?? '—')])); b.appendChild(el('span', { class: 'sl' }, [l])); return b; };
    boxes.appendChild(sb(teamRow.wins, 'VICTORIAS'));
    boxes.appendChild(sb(teamRow.draws, 'EMPATES', 'amber'));
    boxes.appendChild(sb(teamRow.losses, 'DERROTAS', 'red'));
    if (goals?.avg_scored != null) boxes.appendChild(sb(goals.avg_scored, 'GOL PROM'));
    con.appendChild(boxes);
  }

  if (form.length) {
    con.appendChild(el('p', { style: 'font-family:var(--fm);font-size:9.5px;color:var(--t2);letter-spacing:2px;margin-bottom:8px;margin-top:16px;' }, ['FORMA RECIENTE']));
    const fr = el('div', { class: 'form-dots' });
    form.forEach(f => fr.appendChild(el('div', { class: `fd-sm ${f.result}` }, [f.result])));
    con.appendChild(fr);
  }

  // Matches
  con.appendChild(el('p', { style: 'font-family:var(--fm);font-size:9.5px;color:var(--t2);letter-spacing:2px;margin-top:18px;margin-bottom:10px;' }, ['HISTORIAL DE PARTIDOS']));
  const matchCon = el('div', {}); con.appendChild(matchCon);
  matchCon.appendChild(ld());
  const mdata = sid ? await api(`/team/${encodeURIComponent(name)}/season/${sid}`) : await api(`/team/${encodeURIComponent(name)}/matches`);
  matchCon.innerHTML = '';
  if (!mdata?.length) { matchCon.appendChild(empt('Sin partidos.')); return; }
  const list = el('div', { class: 'match-list' });
  mdata.slice(0, 20).forEach(m => list.appendChild(mkHistoricalMatchCard(m)));
  matchCon.appendChild(list);
}

async function vPlayerProfile(wrap, data) {
  const { name, team, seasonId } = data || {};
  const back = el('div', { class: 'back' });
  back.innerHTML = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="12 3 6 9 12 15"/></svg> Volver';
  back.addEventListener('click', () => nav(S.prev || 'players'));
  wrap.appendChild(back);
  const con = el('div', {}); wrap.appendChild(con); con.appendChild(ld());

  const sid = seasonId || actSid();
  const playerData = name ? await api(`/player/${encodeURIComponent(name)}/season/${sid}`) : null;
  con.innerHTML = '';

  const player = playerData?.[0] || null;

  const hero  = el('div', { class: 'prof-hero' });
  const av    = el('div', { class: 'prof-av-xl' }, [ini(name || '')]);
  hero.appendChild(av);
  const bd = el('div', { class: 'prof-body' });
  bd.appendChild(el('h1', { class: 'prof-name' }, [player?.player_name || name || '—']));
  const pills = el('div', { class: 'prof-pills' });
  if (player?.position)   pills.appendChild(el('span', { class: 'pill pill-g' }, [player.position]));
  if (player?.nation)     pills.appendChild(el('span', { class: 'pill pill-d' }, [player.nation]));
  if (player?.birth_year) pills.appendChild(el('span', { class: 'pill pill-d' }, [`${new Date().getFullYear() - player.birth_year} años`]));
  if (player?.team_name || team) pills.appendChild(el('span', { class: 'pill pill-b' }, [player?.team_name || team]));
  if (player?.league_name) pills.appendChild(el('span', { class: 'pill pill-d' }, [fmtLg(player.league_name)]));
  bd.appendChild(pills);
  hero.appendChild(bd); con.appendChild(hero);

  if (player) {
    const boxes = el('div', { class: 'sboxes' });
    const sb = (v, l, cls) => { if (v == null) return null; const b = el('div', { class: `sbox${cls ? ' '+cls : ''}` }); b.appendChild(el('div', { class: 'sv' }, [String(v)])); b.appendChild(el('span', { class: 'sl' }, [l])); return b; };
    const items = [
      sb(player.goals,   'GOLES'),
      sb(player.assists, 'ASISTENCIAS', 'blue'),
      sb(player.mp,      'PARTIDOS'),
      sb(player.minutes, 'MINUTOS', 'amber'),
    ].filter(Boolean);
    items.forEach(b => boxes.appendChild(b));
    if (boxes.children.length) con.appendChild(boxes);
  } else {
    con.appendChild(el('div', { style: 'padding:18px;background:var(--c2);border:1px solid var(--br1);border-radius:9px;text-align:center;color:var(--t2);font-size:13px;' }, ['Sin estadísticas registradas para esta temporada.']));
  }
}

/* ══════════════════════════════════════════════════════════
   SEARCH
══════════════════════════════════════════════════════════ */
let _st = null;
async function doSearch(q) {
  const dd = $('srchDrop');
  if (!q?.trim()) { dd.classList.add('hidden'); return; }
  dd.classList.remove('hidden'); dd.innerHTML = '<div class="sd-empty">Buscando…</div>';
  const data = await api(`/search/${encodeURIComponent(q.trim())}`);
  dd.innerHTML = '';
  if (!data) { dd.innerHTML = '<div class="sd-empty">Error de conexión.</div>'; return; }
  const { players = [], teams = [] } = data;
  if (!players.length && !teams.length) { dd.innerHTML = `<div class="sd-empty">Sin resultados para "${q}"</div>`; return; }
  if (teams.length) {
    dd.appendChild(el('div', { class: 'sd-g' }, ['EQUIPOS']));
    teams.slice(0, 7).forEach(t => {
      const it = el('div', { class: 'sd-r' });
      it.appendChild(teamImg(t.team_name, 'width:18px;height:18px;object-fit:contain;border-radius:3px;'));
      it.appendChild(el('span', {}, [t.team_name]));
      it.appendChild(el('span', { class: 'sd-sub' }, ['equipo']));
      it.addEventListener('click', () => { dd.classList.add('hidden'); $('srchInput').value = ''; nav('teamProfile', { name: t.team_name }); });
      dd.appendChild(it);
    });
  }
  if (players.length) {
    dd.appendChild(el('div', { class: 'sd-g' }, ['JUGADORES']));
    players.slice(0, 7).forEach(p => {
      const it = el('div', { class: 'sd-r' });
      it.appendChild(el('div', { class: 'sd-av' }, [ini(p.player_name)]));
      it.appendChild(el('span', {}, [p.player_name]));
      it.appendChild(el('span', { class: 'sd-sub' }, ['jugador']));
      it.addEventListener('click', () => { dd.classList.add('hidden'); $('srchInput').value = ''; nav('playerProfile', { name: p.player_name }); });
      dd.appendChild(it);
    });
  }
}

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
async function init() {
  const dot = $('sDot'), txt = $('sTxt');
  dot.className = 's-dot loading'; txt.textContent = 'Conectando…';

  const [leagues, seasons] = await Promise.all([api('/leagues'), api('/seasons')]);

  if (!leagues) {
    dot.className = 's-dot error'; txt.textContent = 'Sin conexión';
    toast('No se pudo conectar al backend. ¿Está corriendo en puerto 3000?', 'err', 7000);
  } else {
    dot.className = 's-dot ok'; txt.textContent = 'Conectado';
    S.leagues = leagues;
    S.seasons = seasons || [];
    // Sort by season_name DESC to find most recent regardless of season_id order
    const sortedSeasons = [...S.seasons].sort((a, b) => b.season_name.localeCompare(a.season_name));
    const active = S.seasons.find(s => s.season_name === ACT_SN) || sortedSeasons[0] || null;
    S.activeSid  = active?.season_id || null;

    const gLg = $('gLeague');
    S.leagues.forEach(l => gLg.appendChild(el('option', { value: l.league_id }, [fmtLg(l.league_name)])));
    gLg.addEventListener('change', () => { S.leagueId = gLg.value; nav(S.view, S.prevData); });
  }

  document.querySelectorAll('.nl[data-view]').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); nav(a.dataset.view); }));

  $('menuBtn').addEventListener('click', () => { $('sidebar').classList.toggle('open'); $('overlay').classList.toggle('hidden'); });
  $('overlay').addEventListener('click', () => { $('sidebar').classList.remove('open'); $('overlay').classList.add('hidden'); });

  const si = $('srchInput'), sd = $('srchDrop');
  si.addEventListener('input', () => { clearTimeout(_st); _st = setTimeout(() => doSearch(si.value), 340); });
  si.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(_st); doSearch(si.value); } if (e.key === 'Escape') sd.classList.add('hidden'); });
  document.addEventListener('click', e => { if (!$('srchBox').contains(e.target)) sd.classList.add('hidden'); });

  nav('simulator');
}

document.addEventListener('DOMContentLoaded', init);