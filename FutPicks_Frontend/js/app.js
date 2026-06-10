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
  // Query backend which does ORDER BY season_name DESC → finds '2025_2026' → returns '2026'
  try {
    const data = await api('/predict/next-season-year');
    if (data?.year) return data.year;
  } catch(e) {}
  // Fallback: sort seasons by name DESC, take the end year of the most recent
  const sorted = [...S.seasons].sort((a,b) => b.season_name.localeCompare(a.season_name));
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
function syncCtx(id, v) { /* sidebar ctx removed */ }

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
  backtest:     'Validación del Modelo',
};

function nav(view, data = null) {
  S.prev = S.view; // always track previous view so Volver returns to the right place
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
    backtest:     () => vBacktest(wrap),
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
  // ── 1. RENDER HERO IMMEDIATELY (synchronous, no API calls) ──
  const _hero = el('div', { class: 'sim-hero' });
  _hero.innerHTML = '<p class="sim-hero-eye">MOTOR PREDICTIVO IA &nbsp;&middot;&nbsp; DIXON-COLES &nbsp;&middot;&nbsp; POISSON</p>'
    + '<h1 class="sim-hero-title"><span>PREDICE.</span><span>ANALIZA.</span><span>PROYECTA.</span></h1>'
    + '<p class="sim-hero-sub">5 temporadas de datos reales. Predicciones jornada por jornada sobre 260 equipos en 10 ligas.</p>'
    + '<div class="sim-hero-chips"><span class="hero-chip">10 Ligas</span><span class="hero-chip">260 Equipos</span><span class="hero-chip">5 Temporadas</span><span class="hero-chip">Dixon-Coles · Poisson</span></div>';
  wrap.appendChild(_hero);

  // ── 2. KPI cards placeholder — load async in background ──
  const kpiSection = el('div');
  wrap.appendChild(kpiSection);
  (async () => {
    try {
      const kpiData = await api('/summary');
      if (!kpiData) return;
      const lbl = el('div', { class: 'home-section-lbl' }, ['MOTOR DE DATOS']);
      const kgrid = el('div', { class: 'kpi-grid' });
      [
        { val: kpiData.leagues,  lbl: 'LIGAS' },
        { val: kpiData.seasons,  lbl: 'TEMPORADAS' },
        { val: kpiData.teams,    lbl: 'EQUIPOS' },
        { val: kpiData.matches ? kpiData.matches.toLocaleString('es-MX') : '—', lbl: 'PARTIDOS' },
        { val: kpiData.players ? kpiData.players.toLocaleString('es-MX') : '—', lbl: 'JUGADORES' },
      ].forEach(item => {
        const card = el('div', { class: 'kpi-card' });
        card.appendChild(el('div', { class: 'kpi-val' }, [String(item.val ?? '—')]));
        card.appendChild(el('div', { class: 'kpi-lbl' }, [item.lbl]));
        kgrid.appendChild(card);
      });
      kpiSection.appendChild(lbl);
      kpiSection.appendChild(kgrid);
    } catch(e) {}
  })();

  // ── 3. Featured match — PREDICCIÓN IA async ──
  const featSection = el('div');
  wrap.appendChild(featSection);
  (async () => {
    try {
      if (!S.leagues.length || !S.activeSid) return;
      // Find a league with enough teams
      let featLid = null, featTeams = null;
      for (const lg of S.leagues) {
        const t = await api(`/teams/league/${lg.league_id}/season/${S.activeSid}`);
        if (t?.length >= 4) { featLid = lg.league_id; featTeams = t; break; }
      }
      if (!featTeams) return;

      // Pick 2 random teams from top pool (fresh pick each load)
      const pool = featTeams.slice(0, Math.min(featTeams.length, 10));
      const i1 = Math.floor(Math.random() * pool.length);
      let i2 = Math.floor(Math.random() * (pool.length - 1));
      if (i2 >= i1) i2++;
      const homeTeam = pool[i1].team_name, awayTeam = pool[i2].team_name;

      featSection.appendChild(el('div', { class: 'home-section-lbl' }, ['PARTIDO DESTACADO · PREDICCIÓN IA']));
      const fc  = el('div', { class: 'featured-card' });
      const mu  = el('div', { class: 'featured-matchup' });

      const mkSide = (name) => {
        const d = el('div', { class: 'featured-team' });
        d.appendChild(teamImg(name, 'width:52px;height:52px;object-fit:contain;'));
        d.appendChild(el('span', { class: 'featured-team-name' }, [name]));
        return d;
      };
      const cen = el('div', { class: 'featured-center' });
      const scoreEl = el('div', { class: 'featured-vs' }, ['· · ·']);
      const metaEl  = el('div', { class: 'featured-meta' }, ['Calculando predicción IA…']);
      cen.appendChild(scoreEl); cen.appendChild(metaEl);
      mu.appendChild(mkSide(homeTeam)); mu.appendChild(cen); mu.appendChild(mkSide(awayTeam));
      fc.appendChild(mu);

      const probsEl = el('div', { class: 'featured-probs' });
      fc.appendChild(probsEl);

      const abtn = el('div', { style: 'text-align:center;margin-top:14px;' });
      const analyzeBtn = el('button', { class: 'feat-btn' }, ['⚡ ANALIZAR PARTIDO']);
      analyzeBtn.addEventListener('click', () => { S.leagueId = featLid; S.pendingHome = homeTeam; S.pendingAway = awayTeam; nav('matchPredict'); });
      abtn.appendChild(analyzeBtn); fc.appendChild(abtn);
      featSection.appendChild(fc);

      // Fetch prediction (slow) — updates card when ready
      const pred = await api(`/predict/match/${featLid}/${encodeURIComponent(homeTeam)}/${encodeURIComponent(awayTeam)}`);
      if (!pred || pred.error) { metaEl.textContent = 'Sin datos suficientes'; return; }

      const rH = Math.round(parseFloat(pred.expected_home) || 1);
      const rA = Math.round(parseFloat(pred.expected_away) || 1);
      scoreEl.className = 'featured-score';
      scoreEl.textContent = `${rH} – ${rA}`;
      metaEl.textContent = `Marcador más probable: ${pred.most_likely_score}`;

      const mkFP = (val, lbl, cls) => {
        const d = el('div', { class: `feat-prob feat-prob-${cls}` });
        d.appendChild(el('div', { class: `feat-pct feat-pct-${cls}` }, [`${val}%`]));
        d.appendChild(el('div', { class: 'feat-plbl' }, [lbl]));
        return d;
      };
      probsEl.appendChild(mkFP(pred.prob_home, 'LOCAL', 'h'));
      probsEl.appendChild(mkFP(pred.prob_draw, 'EMPATE', 'd'));
      probsEl.appendChild(mkFP(pred.prob_away, 'VISITANTE', 'a'));
    } catch(e) {}
  })();

  // ── 4. SIMULATOR FORM (renders immediately, no awaits before this) ──
  const layout  = el('div', { class: 'sim-layout' }); wrap.appendChild(layout);
  const simPanel = el('div', { class: 'sim-panel' }); layout.appendChild(simPanel);

  simPanel.appendChild(el('h2', {}, ['Configurar']));
  simPanel.appendChild(el('p', { class: 'sim-sub' }, [
    'El motor genera cada jornada secuencialmente.\nLas jornadas predichas alimentan a las siguientes.',
  ]));

  const lgGrp = el('div', { class: 'sim-form-grp' });
  lgGrp.appendChild(el('label', { class: 'sim-lbl' }, ['LIGA']));
  const lgSel = el('select', { class: 'sim-sel' });
  lgSel.appendChild(el('option', { value: '' }, ['— Seleccionar liga —']));
  S.leagues.forEach(l => lgSel.appendChild(el('option', { value: l.league_id }, [fmtLg(l.league_name)])));
  if (S.leagueId) lgSel.value = S.leagueId;
  lgGrp.appendChild(lgSel); simPanel.appendChild(lgGrp);

  // Season selector — populate async without blocking form render
  const snGrp = el('div', { class: 'sim-form-grp' });
  snGrp.appendChild(el('label', { class: 'sim-lbl' }, ['TEMPORADA FUTURA']));
  const snSel = el('select', { class: 'sim-sel' });
  // Default options while waiting
  const base0 = 2026;
  [0,1,2,3].forEach(i => snSel.appendChild(el('option', { value: String(base0+i) }, [`${base0+i}/${base0+i+1}`])));
  snGrp.appendChild(snSel); simPanel.appendChild(snGrp);
  // Then update with real values
  futureSeasonOptions().then(futOpts => {
    snSel.innerHTML = '';
    futOpts.forEach(o => snSel.appendChild(el('option', { value: o.v }, [o.t])));
  }).catch(() => {});

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
    const simTotal  = data.standings.length;
    const simChampE = simTotal >= 12 ? 4 : 2;
    const simEuroE  = simTotal >= 12 ? 6 : simChampE;
    const simRelS   = simTotal >= 10 ? simTotal - 3 : simTotal - 2;
    const tbody = el('tbody');
    data.standings.forEach((row, i) => {
      let zc = '';
      if (i + 1 <= simChampE)      zc = 'zone-champ';
      else if (i + 1 <= simEuroE)  zc = 'zone-euro';
      else if (i >= simRelS)       zc = 'zone-rel';
      const tr = el('tr', zc ? { class: zc } : {});
      tr.appendChild(el('td', {}, [el('span', { class: 'std-pos pos-num' }, [String(i + 1)])]));
      const tc2 = el('td', {});
      const lnk = el('div', { class: 'std-logo' });
      lnk.appendChild(teamImg(row.team_name, 'width:20px;height:20px;object-fit:contain;'));
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
    // Auto-select and fire if navigated from featured match
    if (S.pendingHome && S.pendingAway) {
      const ph = S.pendingHome, pa = S.pendingAway;
      S.pendingHome = S.pendingAway = null;
      hSel.value = ph; aSel.value = pa;
      chk();
      setTimeout(() => runAnalysis(lid, ph, pa), 0);
    }
  }
  const chk = () => { btn.disabled = !(hSel.value && aSel.value && hSel.value !== aSel.value); };

  async function runAnalysis(lid, ht, at) {
    btn.textContent = 'ANALIZANDO…'; btn.disabled = true;
    ra.innerHTML = ''; ra.appendChild(ld());
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

    renderMatchPredResult(ra, pred, h2h, hFm, aFm, lid, actSid());
  }

  lgSel.addEventListener('change', () => { S.leagueId = lgSel.value; syncCtx('gLeague', lgSel.value); if (lgSel.value) loadTeams(lgSel.value); });
  hSel.addEventListener('change', chk); aSel.addEventListener('change', chk);
  if (S.leagueId) loadTeams(S.leagueId);

  btn.addEventListener('click', () => {
    const lid = lgSel.value, ht = hSel.value, at = aSel.value;
    if (!lid || !ht || !at || ht === at) return;
    runAnalysis(lid, ht, at);
  });
}

function renderMatchPredResult(container, pred, h2h, hFm, aFm, leagueId, seasonId) {
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
  const pH = Math.round(pred.prob_home), pD = Math.round(pred.prob_draw), pA = Math.round(pred.prob_away);
  pr.appendChild(mkP(pH, 'LOCAL', 'home', pred.home_team));
  pr.appendChild(mkP(pD, 'EMPATE', 'draw', 'Empate'));
  pr.appendChild(mkP(pA, 'VISITANTE', 'away', pred.away_team));
  pm.appendChild(pr);

  const ps = el('div', { class: 'pred-score-row' });
  ps.appendChild(el('div', { class: 'pred-score-val' }, [`${pred.expected_home} – ${pred.expected_away}`]));
  ps.appendChild(el('div', { class: 'pred-score-lbl' }, [`RESULTADO ESPERADO · ${pred.most_likely_score} MÁS PROBABLE (${pred.score_prob}%)`]));
  pm.appendChild(ps);

  // Confidence
  const conf = el('div', { style: `margin-top:10px;text-align:center;font-family:var(--fm);font-size:10px;color:var(--t2);letter-spacing:1px;` },
    [`CONFIANZA DEL MODELO: ${pred.confidence}% · OUTCOME: ${pred.outcome?.toUpperCase()}`]);
  pm.appendChild(conf);

  // Probability timeline bar
  const ptlWrap = el('div', { class: 'prob-timeline-wrap', style: 'margin-top:14px;' });
  const ptlBar  = el('div', { class: 'prob-timeline-bar' });
  const ptlH = el('div', { class: 'ptl-home', style: `flex:${pH}` });
  const ptlD = el('div', { class: 'ptl-draw', style: `flex:${pD}` });
  const ptlA = el('div', { class: 'ptl-away', style: `flex:${pA}` });
  ptlBar.appendChild(ptlH); ptlBar.appendChild(ptlD); ptlBar.appendChild(ptlA);
  const ptlLbls = el('div', { class: 'ptl-labels' });
  ptlLbls.appendChild(el('span', { class: 'ptl-lbl' }, [`${pred.home_team} ${pH}%`]));
  ptlLbls.appendChild(el('span', { class: 'ptl-lbl', style: 'text-align:center;' }, ['EMPATE']));
  ptlLbls.appendChild(el('span', { class: 'ptl-lbl', style: 'text-align:right;' }, [`${pA}% ${pred.away_team}`]));
  ptlWrap.appendChild(ptlBar); ptlWrap.appendChild(ptlLbls);
  pm.appendChild(ptlWrap);

  // Simulated betting markets
  function _poissonCDF(lambda, k) {
    let p = Math.exp(-lambda), acc = p;
    for (let i = 1; i <= k; i++) { p *= lambda / i; acc += p; }
    return acc;
  }
  function _odd(pct) { return pct > 0 ? (100 / pct).toFixed(2) : '—'; }
  const lH = parseFloat(pred.lambda_home) || 1.4;
  const lA = parseFloat(pred.lambda_away) || 1.1;
  const over25  = Math.round((1 - _poissonCDF(lH + lA, 2)) * 100);
  const under25 = 100 - over25;
  const btts    = Math.round((1 - Math.exp(-lH)) * (1 - Math.exp(-lA)) * 100);
  const maxP    = Math.max(pred.prob_home, pred.prob_draw, pred.prob_away);
  const mktSection = el('div', { class: 'mkt-section' });
  mktSection.appendChild(el('div', { class: 'mkt-title' }, ['MERCADOS SIMULADOS']));
  const mktGrid = el('div', { class: 'mkt-grid' });
  // Extra markets using Poisson
  const over15 = Math.round((1 - _poissonCDF(lH + lA, 1)) * 100);
  const over35 = Math.round((1 - _poissonCDF(lH + lA, 3)) * 100);
  // Handicap -1 local: home wins by 2+ = Σ P(H=h)*P(A=a) h-a>=2
  let hcap = 0;
  for (let h = 2; h <= 9; h++) {
    const ph = Math.exp(-lH) * Math.pow(lH, h) / [1,1,2,6,24,120,720,5040,40320,362880][h];
    for (let a = 0; a <= h - 2; a++) {
      const pa = Math.exp(-lA) * Math.pow(lA, a) / [1,1,2,6,24,120,720,5040,40320,362880][a];
      hcap += ph * pa;
    }
  }
  const handicapHome = Math.round(hcap * 100);
  const handicapAway = Math.round((1 - hcap - pred.prob_draw / 100) * 100); // rough approx
  const csHome = Math.round(Math.exp(-lA) * 100); // clean sheet home = away scores 0
  const csAway = Math.round(Math.exp(-lH) * 100); // clean sheet away = home scores 0
  const bttsOver = Math.round(btts * over25 / 100);

  const mkMkt = (name, pct, hot) => {
    const p = Math.max(1, Math.min(99, Math.round(pct)));
    const c = el('div', { class: `mkt-card${hot ? ' hot' : ''}` });
    c.appendChild(el('div', { class: 'mkt-name' }, [name]));
    c.appendChild(el('div', { class: 'mkt-odd' }, [`${p}%`]));
    return c;
  };
  mktGrid.appendChild(mkMkt('OVER 1.5',           over15,      over15 > 65));
  mktGrid.appendChild(mkMkt('OVER 2.5',           over25,      over25 > 50));
  mktGrid.appendChild(mkMkt('OVER 3.5',           over35,      over35 > 40));
  mktGrid.appendChild(mkMkt('UNDER 2.5',          under25,     under25 > 50));
  mktGrid.appendChild(mkMkt('AMBOS MARCAN',       btts,        btts   > 50));
  mktGrid.appendChild(mkMkt('BTTS + OVER 2.5',    bttsOver,    bttsOver > 40));
  mktGrid.appendChild(mkMkt('HC -1 LOCAL',        handicapHome,handicapHome > 30));
  mktGrid.appendChild(mkMkt('CS LOCAL',           csHome,      csHome > 25));
  mktGrid.appendChild(mkMkt('CS VISITANTE',       csAway,      csAway > 25));
  mktSection.appendChild(mktGrid);
  pm.appendChild(mktSection);

  // AI explanation text
  const aiBox = el('div', { class: 'ai-explanation' });
  const f = pred.factors || {};
  const fav = pred.prob_home > pred.prob_away ? pred.home_team : (pred.prob_away > pred.prob_home ? pred.away_team : null);
  const favPct = Math.max(pred.prob_home, pred.prob_away);
  const hWins = (hFm || []).slice(-5).filter(r => r.result === 'W').length;
  const aWins = (aFm || []).slice(-5).filter(r => r.result === 'W').length;
  let aiTxt = '';
  if (fav) aiTxt += `El modelo favorita a <strong>${fav}</strong> con una probabilidad del <strong>${favPct}%</strong>. `;
  else     aiTxt += `El encuentro está muy igualado — empate con <strong>${pred.prob_draw}%</strong> de probabilidad. `;
  if (f.home_attack && f.away_attack) {
    const betterAtk = f.home_attack > f.away_attack ? pred.home_team : pred.away_team;
    const betterLambda = f.home_attack > f.away_attack ? pred.lambda_home : pred.lambda_away;
    aiTxt += `<strong>${betterAtk}</strong> tiene mayor potencia ofensiva (λ = ${betterLambda}). `;
  }
  if (hWins >= 3) aiTxt += `${pred.home_team} llega en forma con ${hWins}/5 victorias recientes. `;
  if (aWins >= 3) aiTxt += `${pred.away_team} también llega con momento positivo (${aWins}/5). `;
  aiTxt += `El marcador más probable según Dixon-Coles es <strong>${pred.most_likely_score}</strong> (${pred.score_prob}%).`;
  aiBox.appendChild(el('p', { class: 'ai-exp-text', html: aiTxt }));
  pm.appendChild(aiBox);

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

  // ── JUGADORES CLAVE (async, no bloquea render) ──
  const playerSec = el('div', {});
  container.appendChild(playerSec);
  (async () => {
    try {
      const [hPlayers, aPlayers, hCards, aCards] = await Promise.all([
        api(`/players/team/${encodeURIComponent(pred.home_team)}/season/${seasonId || actSid()}`),
        api(`/players/team/${encodeURIComponent(pred.away_team)}/season/${seasonId || actSid()}`),
        api(`/players/team/${encodeURIComponent(pred.home_team)}/season/${seasonId || actSid()}/cards`),
        api(`/players/team/${encodeURIComponent(pred.away_team)}/season/${seasonId || actSid()}/cards`),
      ]);
      if ((!hPlayers?.length) && (!aPlayers?.length)) return;

      playerSec.appendChild(el('div', { class: 'mkt-title', style: 'margin-top:18px;padding:0 4px 8px;border-bottom:1px solid var(--br1);' }, ['JUGADORES CLAVE · PREDICCIÓN POR PARTIDO']));

      // Poisson P(>=1 gol) = 1 - e^(-lambda)
      const poissonProb = (lam) => Math.min(98, Math.round((1 - Math.exp(-Math.max(0, lam))) * 100));

      const mkTeamBlock = (teamName, players, matchXg) => {
        const block = el('div', { class: 'player-pred-block' });
        block.appendChild(el('div', { class: 'player-pred-team-lbl' }, [
          teamImg(teamName, 'width:18px;height:18px;object-fit:contain;vertical-align:middle;margin-right:6px;'),
          teamName,
        ]));
        const grid = el('div', { class: 'player-pred-grid' });

        players.slice(0, 4).forEach(p => {
          const mp    = p.mp    || 1;
          const nin   = p.nineties || mp;
          const goals = p.goals || 0;
          const ttlGoals = p.team_total_goals || 1;

          // Player share × match xG (already accounts for home/away via Dixon-Coles)
          const share  = goals / Math.max(ttlGoals, 1);
          const nin90  = nin > 0 ? nin : mp;
          const pxg    = share * matchXg;
          const gpn    = nin90 > 0 ? goals / nin90 : 0;
          const apn    = nin90 > 0 ? (p.assists || 0) / nin90 : 0;
          // Use max of share-based and rate-based estimates
          const pxgFinal = Math.max(pxg, gpn * matchXg / 1.5);
          const gProb  = poissonProb(pxgFinal);
          const aProb  = poissonProb(apn * matchXg / 1.5);
          const sRate  = p.shots_per90 != null ? parseFloat(p.shots_per90) : 0;
          const sProb  = sRate > 0 ? Math.min(97, Math.round(sRate * 25)) : 0;

          const card = el('div', { class: 'player-pred-card' });
          // Avatar + name + pos
          const hdr = el('div', { class: 'pp-hdr' });
          hdr.appendChild(el('div', { class: 'pp-av' }, [ini(p.player_name)]));
          const info = el('div', { class: 'pp-info' });
          info.appendChild(el('div', { class: 'pp-name' }, [p.player_name]));
          info.appendChild(el('div', { class: 'pp-pos' }, [p.position || '—']));
          hdr.appendChild(info);
          card.appendChild(hdr);

          // Stats row
          const stats = el('div', { class: 'pp-season-stats' }, [
            `${goals}G · ${p.assists || 0}A · ${mp}PJ`
          ]);
          card.appendChild(stats);

          // Probability bars
          const mkBar = (pct, lbl, cls) => {
            const row = el('div', { class: 'pp-bar-row' });
            row.appendChild(el('span', { class: 'pp-bar-lbl' }, [lbl]));
            const bw = el('div', { class: 'pp-bar-wrap' });
            bw.appendChild(el('div', { class: `pp-bar-fill ${cls}`, style: `width:${pct}%` }));
            row.appendChild(bw);
            row.appendChild(el('span', { class: 'pp-bar-pct' }, [`${pct}%`]));
            return row;
          };
          card.appendChild(mkBar(gProb,  'GOL',      gProb > 25  ? 'hot' : ''));
          card.appendChild(mkBar(aProb,  'ASIST.',   aProb > 20  ? 'hot' : ''));
          if (sRate > 0) card.appendChild(mkBar(sProb, 'DISPARO', sProb > 50 ? 'hot' : ''));
          grid.appendChild(card);
        });
        block.appendChild(grid);
        return block;
      };

      const twoCol = el('div', { class: 'player-pred-teams' });
      if (hPlayers?.length) twoCol.appendChild(mkTeamBlock(pred.home_team, hPlayers, parseFloat(pred.expected_home) || 1.3));
      if (aPlayers?.length) twoCol.appendChild(mkTeamBlock(pred.away_team, aPlayers, parseFloat(pred.expected_away) || 1.1));
      playerSec.appendChild(twoCol);

      // ── TARJETAS ESPERADAS ──
      const allCardPlayers = [
        ...(hCards || []).map(cp => ({ ...cp, _team: pred.home_team, _lambda: parseFloat(pred.lambda_home) || 1.4 })),
        ...(aCards || []).map(cp => ({ ...cp, _team: pred.away_team, _lambda: parseFloat(pred.lambda_away) || 1.1 })),
      ];
      if (allCardPlayers.length) {
        const cardSec = el('div', { style: 'margin-top:18px;' });
        cardSec.appendChild(el('div', { class: 'mkt-title', style: 'padding:0 4px 8px;border-bottom:1px solid var(--br1);margin-bottom:12px;' }, ['TARJETAS ESPERADAS · JUGADORES EN RIESGO']));
        const cardGrid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;' });

        allCardPlayers.forEach(cp => {
          const mp  = cp.mp || 1;
          const yc  = cp.yellow_cards || 0;
          const rc  = cp.red_cards    || 0;
          const cardRate = (yc + rc * 2) / mp;         // weighted cards per match
          const cardProb = Math.min(97, Math.round((1 - Math.exp(-cardRate)) * 100));
          const isHot    = cardProb >= 40;

          const card = el('div', { class: `mkt-card${isHot ? ' hot' : ''}`, style: 'padding:10px 12px;' });
          const nameRow = el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:6px;' });
          nameRow.appendChild(el('div', { class: 'pp-av', style: 'width:26px;height:26px;font-size:9px;flex-shrink:0;' }, [ini(cp.player_name)]));
          const nameInfo = el('div', {});
          nameInfo.appendChild(el('div', { style: 'font-size:11px;font-weight:600;color:var(--t1);line-height:1.2;' }, [cp.player_name]));
          nameInfo.appendChild(el('div', { style: 'font-size:9px;color:var(--t2);' }, [cp._team]));
          nameRow.appendChild(nameInfo);
          card.appendChild(nameRow);

          const statsRow = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' });
          statsRow.appendChild(el('div', { style: 'font-size:10px;color:var(--t2);' }, [
            `🟨 ${yc}${rc > 0 ? ` 🟥 ${rc}` : ''} · ${mp}PJ`
          ]));
          statsRow.appendChild(el('div', { style: `font-size:18px;font-weight:700;color:${isHot ? 'var(--amber)' : 'var(--t1)'};` }, [`${cardProb}%`]));
          card.appendChild(statsRow);
          card.appendChild(el('div', { class: 'mkt-name', style: 'margin-top:2px;font-size:9px;' }, ['PROB. TARJETA']));
          cardGrid.appendChild(card);
        });

        cardSec.appendChild(cardGrid);
        playerSec.appendChild(cardSec);
      }

    } catch(e) { console.error('player pred section:', e); }
  })();
}

/* ══════════════════════════════════════════════════════════
   VIEW: MONTE CARLO
   Uses /api/predict/montecarlo/:leagueId/:year?sims=N
══════════════════════════════════════════════════════════ */
async function vMonteCarlo(wrap) {
  wrap.appendChild(el('div', { class: 'pg-head' }, [
    el('h1', { class: 'pg-title' }, ['Monte Carlo']),
    el('p',  { class: 'pg-sub'  }, ['Simula la temporada 2026/2027 completa N veces. Calcula probabilidades de título, top-4 y descenso usando el histórico de 5 temporadas reales.']),
  ]));

  // Load future season options from backend
  const futOpts = await futureSeasonOptions();

  const bar = el('div', { class: 'fbar' });
  const lg   = mkSel('— Liga —', lgOpts(), curLid(), 'f-sel');
  const fut  = mkSel(null, futOpts, futOpts[0]?.v, 'f-sel');
  const si   = el('div', { class: 'f-grp' });
  si.appendChild(el('span', { class: 'f-lbl' }, ['SIMULACIONES']));
  const siInp = el('input', { type: 'number', class: 'f-inp', value: '500', min: '100', max: '2000' });
  si.appendChild(siInp);
  const btn = el('button', { class: 'btn btn-g btn-sm' }, ['EJECUTAR']);
  btn.disabled = !lg.value;
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['LIGA']), lg]));
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['TEMPORADA FUTURA']), fut]));
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

    // AI insight summary
    const insightBox = el('div', { class: 'mc-insight-box' });
    let insight = '';
    if (data.championship_probs) {
      const champEntries = Object.entries(data.championship_probs).sort((a, b) => b[1] - a[1]);
      if (champEntries.length) {
        const [top1, pct1] = champEntries[0];
        insight += `<strong>${top1}</strong> es el máximo favorito al título con <strong>${pct1}%</strong> de probabilidad en ${data.simulations} simulaciones. `;
        if (champEntries[1]) insight += `Le sigue <strong>${champEntries[1][0]}</strong> (${champEntries[1][1]}%). `;
      }
    }
    if (data.relegation_probs) {
      const relEntries = Object.entries(data.relegation_probs).sort((a, b) => b[1] - a[1]);
      if (relEntries.length && relEntries[0][1] > 30) {
        insight += `En zona de peligro, <strong>${relEntries[0][0]}</strong> tiene un <strong>${relEntries[0][1]}%</strong> de riesgo de descenso. `;
      }
    }
    if (!insight) insight = `Simulación completada con <strong>${data.simulations}</strong> iteraciones usando el histórico completo de la liga.`;
    insightBox.appendChild(el('p', { html: insight }));
    con.appendChild(insightBox);
  });
}

/* ══════════════════════════════════════════════════════════
   VIEW: STANDINGS (uses season-correct new endpoint)
══════════════════════════════════════════════════════════ */
async function vStandings(wrap) {
  wrap.appendChild(el('div', { class: 'pg-head' }, [
    el('h1', { class: 'pg-title' }, ['Clasificación']),
    el('p',  { class: 'pg-sub'   }, ['Temporada regular · solo ligas con datos disponibles']),
  ]));

  const bar = el('div', { class: 'fbar' });
  const ls  = mkSel('— Liga —',      lgOpts(), curLid());
  const ss  = el('select', { class: 'f-sel' });
  ss.appendChild(el('option', { value: '' }, ['— Temporada —']));
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['LIGA']),      ls]));
  bar.appendChild(el('div', { class: 'f-grp' }, [el('span', { class: 'f-lbl' }, ['TEMPORADA']), ss]));
  wrap.appendChild(bar);

  const con = el('div', {}); wrap.appendChild(con);

  /* Reload season options to only those with real data for selected league */
  async function updateSeasons(lid) {
    ss.innerHTML = '<option value="">— Temporada —</option>';
    if (!lid) return;
    const seasons = await api(`/seasons/league/${lid}`);
    (seasons || []).forEach(s => {
      ss.appendChild(el('option', { value: String(s.season_id) }, [fmtSn(s.season_name)]));
    });
    if (seasons?.length) { ss.value = String(seasons[0].season_id); load(); }
    else con.innerHTML = '', con.appendChild(empt('Sin datos para esta liga.'));
  }

  async function load() {
    const lid = ls.value, sid = ss.value;
    con.innerHTML = '';
    if (!lid || !sid) { con.appendChild(empt('Selecciona liga y temporada.')); return; }
    con.appendChild(ld());

    let data = await api(`/predict/standings/${lid}/${sid}`);
    con.innerHTML = '';
    if (!data?.length) { con.appendChild(empt('Sin datos para esta temporada.')); return; }

    /* ── Filtro mínimo de partidos ─────────────────────────────────
       Excluye equipos con muy pocos partidos vs el resto de la liga.
       Umbral: 50% de la mediana de partidos jugados. */
    const playedVals = data.map(t => t.played || 0).filter(p => p > 0).sort((a, b) => a - b);
    if (playedVals.length) {
      const median  = playedVals[Math.floor(playedVals.length / 2)];
      const minGames = Math.max(2, Math.floor(median * 0.5));
      data = data.filter(t => (t.played || 0) >= minGames);
    }

    const normalized = normalizeTeams(data);
    const w = el('div', { class: 'card std-wrap' });
    const t = el('table', { class: 'std-tbl' });
    const thead = el('thead'); const hr = el('tr');
    ['#', 'EQUIPO', 'PJ', 'G', 'E', 'P', 'GF', 'GC', 'DG', 'PTS'].forEach(h => hr.appendChild(el('th', {}, [h])));
    thead.appendChild(hr); t.appendChild(thead);
    // Zone boundaries
    const total = normalized.length;
    const champEnd = total >= 12 ? 4 : 2;
    const euroEnd  = total >= 12 ? 6 : champEnd;
    const confEnd  = total >= 14 ? 7 : euroEnd;
    const relStart = total >= 10 ? total - 3 : total - 2;

    const tbody = el('tbody');
    normalized.forEach((row, i) => {
      const pos = i + 1;
      let zoneClass = '';
      if (pos <= champEnd)       zoneClass = 'zone-champ';
      else if (pos <= euroEnd)   zoneClass = 'zone-euro';
      else if (pos <= confEnd)   zoneClass = 'zone-conf';
      else if (i >= relStart)    zoneClass = 'zone-rel';

      const tr = el('tr', zoneClass ? { class: zoneClass } : {});
      tr.addEventListener('click', () => nav('teamProfile', { name: row.team_name, leagueId: lid, seasonId: sid }));
      const posCell = el('td', {});
      const posSpan = el('span', { class: 'std-pos pos-num' }, [String(pos)]);
      posCell.appendChild(posSpan);
      tr.appendChild(posCell);
      const tc = el('td', {}); const lnk = el('div', { class: 'std-logo' });
      lnk.appendChild(teamImg(row.team_name, 'width:20px;height:20px;object-fit:contain;'));
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

  ls.addEventListener('change', () => { S.leagueId = ls.value; syncCtx('gLeague', ls.value); updateSeasons(ls.value); });
  ss.addEventListener('change', load);

  if (ls.value) updateSeasons(ls.value);
  else con.appendChild(empt('Selecciona una liga.'));
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
  const tS  = el('button', { class: 'btn btn-g btn-sm' },     ['Goleadores']);
  const tA  = el('button', { class: 'btn btn-ghost btn-sm' }, ['Asistentes']);
  const tGK = el('button', { class: 'btn btn-ghost btn-sm' }, ['Porteros']);
  tabRow.appendChild(tS); tabRow.appendChild(tA); tabRow.appendChild(tGK);
  wrap.appendChild(tabRow);

  const con = el('div', {}); wrap.appendChild(con);
  let cSc = null, cAs = null, cGk = null;

  const setActive = (active) => {
    [tS, tA, tGK].forEach(b => b.className = 'btn btn-ghost btn-sm');
    active.className = 'btn btn-g btn-sm';
  };

  async function load() {
    con.innerHTML = ''; con.appendChild(ld());
    const lid = ls.value, sid = ss.value;
    if (lid && sid) {
      [cSc, cAs, cGk] = await Promise.all([
        api(`/topscorers/league/${lid}/season/${sid}`),
        api(`/topassists/league/${lid}/season/${sid}`),
        api(`/goalkeepers/league/${lid}/season/${sid}`),
      ]);
    } else if (!lid && sid) {
      const allLeagueIds = S.leagues.map(l => l.league_id);
      const [scArrays, asArrays, gkArrays] = await Promise.all([
        Promise.all(allLeagueIds.map(l => api(`/topscorers/league/${l}/season/${sid}`))),
        Promise.all(allLeagueIds.map(l => api(`/topassists/league/${l}/season/${sid}`))),
        Promise.all(allLeagueIds.map(l => api(`/goalkeepers/league/${l}/season/${sid}`))),
      ]);
      cSc = dedupe(scArrays.flat().filter(Boolean), 'goals');
      cAs = dedupe(asArrays.flat().filter(Boolean), 'assists');
      // GKs: dedupe by player_name, keep highest-volume entry, sort by bayesian score
      const gkScore = g => (parseFloat(g.score) || 0) || ((parseFloat(g.saves || 0) + 25) / (parseFloat(g.saves || 0) + parseFloat(g.goals_against || 0) + 37) * 100);
      const rawGk = gkArrays.flat().filter(Boolean);
      const gkMap = new Map();
      rawGk.forEach(g => {
        const ex = gkMap.get(g.player_name);
        if (!ex || (parseFloat(g.saves) || 0) > (parseFloat(ex.saves) || 0)) gkMap.set(g.player_name, g);
      });
      cGk = [...gkMap.values()].sort((a, b) => gkScore(b) - gkScore(a));
    } else if (lid) {
      [cSc, cAs] = await Promise.all([api(`/topscorers/league/${lid}`), api(`/topassists/league/${lid}`)]);
      cSc = dedupe(cSc, 'goals'); cAs = dedupe(cAs, 'assists'); cGk = null;
    } else {
      [cSc, cAs] = await Promise.all([api('/topscorers'), api('/topassists')]);
      cSc = dedupe(cSc, 'goals'); cAs = dedupe(cAs, 'assists'); cGk = null;
    }
    S.C.sc = cSc; S.C.as = cAs;
    con.innerHTML = ''; render();
  }

  function renderGk(data) {
    if (!data?.length) { con.appendChild(empt('Selecciona liga y temporada para ver porteros.')); return; }
    const fmtPct = v => (v == null || v === '' || parseFloat(v) === 0) ? '—' : parseFloat(v).toFixed(1) + '%';
    const fmtN   = v => (v == null || v === '') ? '—' : String(v);
    const w = el('div', { class: 'card ptbl-wrap' });
    const t = el('table', { class: 'ptbl' });
    const thead = el('thead'); const hr = el('tr');
    ['#', 'PORTERO', 'EQUIPO', 'GA', 'PARADAS', '% PAR.', 'CS', '% CS'].forEach((h, i) => {
      hr.appendChild(el('th', i >= 3 ? { class: 'r' } : {}, [h]));
    });
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
      const ttd = el('td', {});
      if (p.team_name) {
        ttd.appendChild(teamImg(p.team_name, 'width:14px;height:14px;object-fit:contain;display:inline-block;vertical-align:middle;margin-right:4px;'));
        ttd.appendChild(document.createTextNode(p.team_name));
      } else ttd.textContent = '—';
      tr.appendChild(ttd);
      tr.appendChild(el('td', { class: 'r', style: 'color:var(--t2);' }, [fmtN(p.goals_against)]));
      tr.appendChild(el('td', { class: 'r' }, [fmtN(p.saves)]));
      // save_pct highlight: green >72%, amber 60-72%, default below
      const spv = parseFloat(p.save_pct) || 0;
      const spCls = spv >= 72 ? 'td-g' : spv >= 60 ? 'td-a' : 'r';
      tr.appendChild(el('td', { class: spCls }, [fmtPct(p.save_pct)]));
      tr.appendChild(el('td', { class: 'r' }, [fmtN(p.clean_sheets)]));
      const cspv = parseFloat(p.clean_sheet_pct) || 0;
      const cspCls = cspv >= 35 ? 'td-g' : cspv >= 20 ? 'td-a' : 'r';
      tr.appendChild(el('td', { class: cspCls }, [fmtPct(p.clean_sheet_pct)]));
      tbody.appendChild(tr);
    });
    t.appendChild(tbody); w.appendChild(t); con.appendChild(w);
  }

  function render() {
    con.innerHTML = '';
    if (tab === 'gk') { renderGk(cGk); return; }
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

  tS.addEventListener('click',  () => { tab = 'sc'; setActive(tS);  render(); });
  tA.addEventListener('click',  () => { tab = 'as'; setActive(tA);  render(); });
  tGK.addEventListener('click', () => { tab = 'gk'; setActive(tGK); render(); });
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
    con.appendChild(el('div', { class: 'home-section-lbl', style: 'margin-top:18px;' }, ['FORMA RECIENTE']));
    const fr = el('div', { class: 'form-dots' });
    form.forEach(f => fr.appendChild(el('div', { class: `fd-sm ${f.result}` }, [f.result])));
    con.appendChild(fr);
  }

  // AI Metrics cards
  if (teamRow && goals) {
    con.appendChild(el('div', { class: 'home-section-lbl', style: 'margin-top:20px;' }, ['METRICAS IA']));
    const atkScore  = Math.min(100, Math.round((goals.avg_scored  || 0) / 3.5 * 100));
    const defScore  = Math.min(100, Math.round(Math.max(0, (3.5 - (goals.avg_conceded || 3.5))) / 3.5 * 100));
    const winRate   = teamRow.played ? Math.round(teamRow.wins / teamRow.played * 100) : 0;
    const overall   = Math.round(atkScore * 0.4 + defScore * 0.4 + winRate * 0.2);
    const xg        = goals.avg_scored ? Number(goals.avg_scored).toFixed(2) : '---';

    const aiMGrid = el('div', { class: 'ai-metrics-grid' });
    const mkAiM = (val, lbl, pct, color) => {
      const c = el('div', { class: 'ai-metric' });
      c.appendChild(el('div', { class: 'ai-metric-val', style: `color:${color}` }, [String(val)]));
      c.appendChild(el('div', { class: 'ai-metric-lbl' }, [lbl]));
      const barWrap = el('div', { class: 'ai-metric-bar' });
      barWrap.appendChild(el('div', { class: 'ai-metric-fill', style: `width:${pct}%;background:${color}` }));
      c.appendChild(barWrap);
      return c;
    };
    aiMGrid.appendChild(mkAiM(atkScore,      'FUERZA OFENSIVA',  atkScore, 'var(--g)'));
    aiMGrid.appendChild(mkAiM(defScore,      'FUERZA DEFENSIVA', defScore, 'var(--pur)'));
    aiMGrid.appendChild(mkAiM(overall,       'RATING GENERAL',   overall,  'var(--draw)'));
    aiMGrid.appendChild(mkAiM(winRate + '%', 'WIN RATE',         winRate,  'var(--win)'));
    aiMGrid.appendChild(mkAiM(xg,           'GOL ESPERADO',     Math.min(100, Math.round((goals.avg_scored || 0)), 'var(--g)')));
    con.appendChild(aiMGrid);

    // SVG sparkline from form results
    if (form.length >= 3) {
      con.appendChild(el('div', { class: 'home-section-lbl', style: 'margin-top:16px;' }, ['RENDIMIENTO']));
      const chartWrap = el('div', { class: 'perf-chart-wrap' });
      const formSlice = form.slice(-10);
      const pts = [];
      let cum = 0;
      formSlice.forEach(f => { cum += (f.result === 'W' ? 3 : f.result === 'D' ? 1 : 0); pts.push(cum); });
      const maxPts = Math.max(...pts) || 1;
      const W = 500, H = 120, padL = 10, padR = 10, padT = 14, padB = 20;
      const step = (W - padL - padR) / (pts.length - 1 || 1);
      const coords = pts.map((p, i) => ({
        x: padL + i * step,
        y: padT + (H - padT - padB) * (1 - p / maxPts),
      }));
      const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
      const areaD = pathD + ` L${coords[coords.length-1].x.toFixed(1)},${H - padB} L${coords[0].x.toFixed(1)},${H - padB} Z`;
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('class', 'perf-chart-svg');
      const defs = document.createElementNS(svgNS, 'defs');
      const grad = document.createElementNS(svgNS, 'linearGradient');
      grad.id = 'perf-grad'; grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0'); grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
      const s1 = document.createElementNS(svgNS, 'stop'); s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', '#3b82f6'); s1.setAttribute('stop-opacity', '0.25');
      const s2 = document.createElementNS(svgNS, 'stop'); s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#3b82f6'); s2.setAttribute('stop-opacity', '0');
      grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad); svg.appendChild(defs);
      const area = document.createElementNS(svgNS, 'path'); area.setAttribute('d', areaD); area.setAttribute('fill', 'url(#perf-grad)'); svg.appendChild(area);
      const line = document.createElementNS(svgNS, 'path'); line.setAttribute('d', pathD); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#3b82f6'); line.setAttribute('stroke-width', '2.5'); line.setAttribute('stroke-linecap', 'round'); svg.appendChild(line);
      coords.forEach(c => {
        const dot = document.createElementNS(svgNS, 'circle'); dot.setAttribute('cx', String(c.x.toFixed(1))); dot.setAttribute('cy', String(c.y.toFixed(1))); dot.setAttribute('r', '4'); dot.setAttribute('fill', '#3b82f6'); dot.setAttribute('stroke', '#080808'); dot.setAttribute('stroke-width', '2'); svg.appendChild(dot);
      });
      chartWrap.appendChild(svg);
      con.appendChild(chartWrap);
    }
  }

  // Matches
  con.appendChild(el('div', { class: 'home-section-lbl', style: 'margin-top:18px;' }, ['HISTORIAL DE PARTIDOS']));
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
  const { name, team } = data || {};
  const back = el('div', { class: 'back' });
  back.innerHTML = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="12 3 6 9 12 15"/></svg> Volver';
  back.addEventListener('click', () => nav(S.prev || 'players'));
  wrap.appendChild(back);

  const con = el('div', {}); wrap.appendChild(con); con.appendChild(ld());

  // 1. Fetch seasons list (fast - no heavy data)
  const seasons = name ? await api(`/player/${encodeURIComponent(name)}/seasons`) : [];
  con.innerHTML = '';

  // Season selector bar
  let curSid = seasons?.[0]?.season_id || actSid();
  if (seasons?.length) {
    const snBar = el('div', { class: 'player-sn-bar' });
    snBar.appendChild(el('span', { class: 'player-sn-lbl' }, ['TEMPORADA']));
    const snSel = el('select', { class: 'sim-sel', style: 'min-width:220px;' });
    seasons.forEach(s => {
      const opt = el('option', { value: s.season_id }, [
        `${fmtSn(s.season_name)}  ·  ${s.team_name}  ·  ${s.goals ?? 0}G ${s.assists ?? 0}A`
      ]);
      snSel.appendChild(opt);
    });
    snSel.value = curSid;
    snBar.appendChild(snSel);
    con.appendChild(snBar);
    snSel.addEventListener('change', () => { curSid = snSel.value; loadStats(curSid); });
  }

  // Stats container (reloads on season change)
  const sc = el('div', {}); con.appendChild(sc);

  async function loadStats(sid) {
    sc.innerHTML = ''; sc.appendChild(ld());
    const rows = await api(`/player/${encodeURIComponent(name)}/fullstats/${sid}`);
    const p = rows?.[0] || null;
    sc.innerHTML = '';

    // ── Hero ──
    const hero = el('div', { class: 'prof-hero' });
    hero.appendChild(el('div', { class: 'prof-av-xl' }, [ini(name || '')]));
    const bd = el('div', { class: 'prof-body' });
    bd.appendChild(el('h1', { class: 'prof-name' }, [p?.player_name || name || '—']));
    const pills = el('div', { class: 'prof-pills' });
    if (p?.position)   pills.appendChild(el('span', { class: 'pill pill-g' }, [p.position]));
    if (p?.nation)     pills.appendChild(el('span', { class: 'pill pill-d' }, [p.nation]));
    if (p?.birth_year) pills.appendChild(el('span', { class: 'pill pill-d' }, [`${new Date().getFullYear() - p.birth_year} años`]));
    if (p?.team_name || team) pills.appendChild(el('span', { class: 'pill pill-b' }, [p?.team_name || team]));
    if (p?.league_name) pills.appendChild(el('span', { class: 'pill pill-d' }, [fmtLg(p.league_name)]));
    bd.appendChild(pills); hero.appendChild(bd); sc.appendChild(hero);

    if (!p) { sc.appendChild(el('div', { class: 'empty-msg' }, ['Sin datos para esta temporada.'])); return; }

    // ── Quick stat boxes ──
    const boxes = el('div', { class: 'sboxes' });
    const sb = (v, l, cls) => {
      if (v == null || v === '') return null;
      const b = el('div', { class: `sbox${cls ? ' '+cls : ''}` });
      b.appendChild(el('div', { class: 'sv' }, [String(v)]));
      b.appendChild(el('span', { class: 'sl' }, [l]));
      return b;
    };
    [sb(p.std_goals, 'GOLES'), sb(p.std_assists, 'ASIST.', 'blue'),
     sb(p.mp, 'PARTIDOS'), sb(p.minutes, 'MINUTOS', 'amber')].filter(Boolean).forEach(b => boxes.appendChild(b));
    sc.appendChild(boxes);

    // ── Stat category sections ──
    const mkStatRow = (lbl, val, unit) => {
      const row = el('div', { class: 'pstat-row' });
      row.appendChild(el('span', { class: 'pstat-lbl' }, [lbl]));
      const isNull = (val == null || val === '' || val === 0 || val === '0' || val === '0.00');
      const display = isNull ? '—' : `${val}${unit ? ' ' + unit : ''}`;
      const valEl = el('span', { class: 'pstat-val' }, [display]);
      if (isNull) valEl.style.color = 'var(--t2)';
      row.appendChild(valEl);
      return row;
    };
    // Helper: only show rows AND category when values are non-zero non-null
    const hasVal = (v) => v != null && v !== '' && v !== 0 && v !== '0' && parseFloat(v) !== 0;
    // mkCatFiltered: renders only rows that have real data
    const mkCatFiltered = (title, rowDefs) => {
      const valid = rowDefs.filter(([, v]) => hasVal(v));
      if (!valid.length) return null;
      return mkCat(title, valid.map(([l, v, u]) => mkStatRow(l, v, u)));
    };
    const mkCat = (title, rows) => {
      const card = el('div', { class: 'pstat-card' });
      card.appendChild(el('div', { class: 'pstat-cat-title' }, [title]));
      rows.forEach(r => r && card.appendChild(r));
      return card;
    };
    const statGrid = el('div', { class: 'pstat-grid' });

    // Best assists: pass_assists if higher, else std_assists
    const bestAssists = Math.max(p.pass_assists || 0, p.std_assists || 0);

    // OFENSIVO: always show (main section, show — for zeroes)
    statGrid.appendChild(mkCat('⚽ OFENSIVO', [
      mkStatRow('Goles',              p.std_goals,    ''),
      mkStatRow('Asistencias',        bestAssists,    ''),
      mkStatRow('Partidos',           p.mp,           ''),
      mkStatRow('Minutos',            p.minutes,      ''),
      mkStatRow('Tarjetas amarillas', p.yellow_cards, ''),
      mkStatRow('Tarjetas rojas',     p.red_cards,    ''),
    ]));

    // Secondary sections: only render rows that actually have data
    const dispCat = mkCatFiltered('🎯 DISPAROS', [
      ['Disparos totales', p.shots, ''],
      ['A puerta', p.shots_on_target, ''],
      ['Precisión', p.shot_accuracy != null && p.shot_accuracy !== 0 ? p.shot_accuracy + '%' : null, ''],
      ['Disparos/90', p.shots_per90, '/90'],
      ['Goles', p.sh_goals, ''],
    ]);
    if (dispCat) statGrid.appendChild(dispCat);

    const defCat = mkCatFiltered('🛡 DEFENSIVO', [
      ['Entradas', p.tackles, ''],
      ['Entradas ganadas', p.tackles_won, ''],
      ['Intercepciones', p.interceptions, ''],
      ['Despejes', p.clearances, ''],
      ['Errores', p.errors, ''],
    ]);
    if (defCat) statGrid.appendChild(defCat);

    const creaCat = mkCatFiltered('⚡ CREACIÓN', [
      ['SCA (→tiro)', p.sca, ''],
      ['SCA/90', p.sca90, '/90'],
      ['GCA (→gol)', p.gca, ''],
      ['GCA/90', p.gca90, '/90'],
    ]);
    if (creaCat) statGrid.appendChild(creaCat);

    const discCat = mkCatFiltered('📋 DISCIPLINA', [
      ['Faltas cometidas', p.fouls_committed, ''],
      ['Faltas recibidas', p.fouls_drawn, ''],
      ['Fuera de juego', p.offsides, ''],
    ]);
    if (discCat) statGrid.appendChild(discCat);

    // Goalkeeper stats (only if GK position and data exists)
    const isGK = (p.position || '').toUpperCase().includes('GK');
    if (isGK) {
      const gkCat = mkCatFiltered('🧤 PORTERO', [
        ['Goles en contra', p.goals_against, ''],
        ['Paradas', p.saves, ''],
        ['% Paradas', p.gk_save_pct != null && p.gk_save_pct !== 0 ? p.gk_save_pct + '%' : null, ''],
        ['Porterías a cero', p.clean_sheets, ''],
        ['% Portería a cero', p.clean_sheet_pct != null && p.clean_sheet_pct !== 0 ? p.clean_sheet_pct + '%' : null, ''],
      ]);
      if (gkCat) statGrid.appendChild(gkCat);
    }

    sc.appendChild(statGrid);

    // ── Predicciones IA (basadas en stats reales) ──
    if (p.mp > 0) {
      sc.appendChild(el('div', { class: 'home-section-lbl', style: 'margin-top:24px;' }, ['PREDICCIONES IA POR PARTIDO']));
      const nin = p.nineties || (p.minutes / 90) || p.mp;
      const gpn  = (p.std_goals  || 0) / Math.max(nin, 1);  // goals per 90
      const rawA = Math.max(p.pass_assists || 0, p.std_assists || 0);
      const apn  = rawA / Math.max(nin, 1);  // assists per 90
      const spn  = p.shots_per90 || 0;
      const gcap = p.gca90 || 0;

      // Poisson: P(X>=1) = 1 - e^(-lambda)
      const poissonMin1 = (lam) => Math.min(98, Math.round((1 - Math.exp(-Math.max(0, lam))) * 100));

      const goalProb   = poissonMin1(gpn);
      const assistProb = poissonMin1(apn);
      const shotProb   = spn > 0 ? Math.min(99, Math.round(spn * 30)) : Math.min(99, Math.round((p.shots || 0) / Math.max(p.mp, 1)));
      const impactProb = poissonMin1(gpn + apn);

      const predGrid = el('div', { class: 'ai-pred-grid' });
      const mkPred = (pct, lbl, sub, hot) => {
        const c = el('div', { class: `ai-pred-card${hot ? ' hot' : ''}` });
        c.appendChild(el('div', { class: 'ai-pred-pct' }, [`${pct}%`]));
        c.appendChild(el('div', { class: 'ai-pred-lbl' }, [lbl]));
        if (sub) c.appendChild(el('div', { class: 'ai-pred-sub' }, [sub]));
        return c;
      };
      if (isGK && p.saves != null && p.saves > 0) {
        // Goalkeeper-specific prediction cards
        const savePct     = Math.round(parseFloat(p.gk_save_pct)      || 0);
        const csPct       = Math.round(parseFloat(p.clean_sheet_pct)   || 0);
        const savesPerGame= (p.saves          || 0) / Math.max(p.mp, 1);
        const gaPerGame   = (p.goals_against  || 0) / Math.max(p.mp, 1);
        const probGA      = poissonMin1(gaPerGame);
        const cargaDef    = Math.min(97, Math.round(savesPerGame * 14));
        predGrid.appendChild(mkPred(savePct,   'EFICIENCIA',          `${savePct}% paradas`, savePct > 72));
        predGrid.appendChild(mkPred(csPct,     'PORTERÍA A CERO',     `${csPct}% histórico`, csPct > 30));
        predGrid.appendChild(mkPred(probGA,    'PROB. GOL EN CONTRA', `${gaPerGame.toFixed(2)} GA/p`));
        predGrid.appendChild(mkPred(cargaDef,  'CARGA DEFENSIVA',     `${savesPerGame.toFixed(1)} paradas/p`, cargaDef > 40));
      } else {
        // Field player prediction cards
        predGrid.appendChild(mkPred(goalProb,   'PROB. GOL',        `${gpn.toFixed(2)} goles/90`, goalProb > 30));
        predGrid.appendChild(mkPred(assistProb, 'PROB. ASISTENCIA', `${apn.toFixed(2)} asist/90`, assistProb > 20));
        predGrid.appendChild(mkPred(shotProb,   'PROB. DISPARO',    `${p.shots_per90 ? p.shots_per90 + '/90' : ((p.shots||0)+' total')}`));
        predGrid.appendChild(mkPred(impactProb, 'IMPACTO G+A',      `xG+xA = ${(gpn+apn).toFixed(2)}/90`));
        if (p.gca90 > 0) predGrid.appendChild(mkPred(Math.min(99, Math.round(gcap * 40)), 'ACCIONES CREATIVAS', `GCA: ${gcap.toFixed(2)}/90`));
      }
      sc.appendChild(predGrid);
    }
  }

  loadStats(curSid);
}

/* ══════════════════════════════════════════════════════════
   SEARCH
══════════════════════════════════════════════════════════ */
let _st = null;
async function doSearch(q) {
  const dd = $('srchDrop');
  if (!q?.trim()) { dd.classList.add('hidden'); return; }
  dd.classList.remove('hidden'); dd.innerHTML = '<div class="sd-empty">Buscando...</div>';
  const data = await api(`/search/${encodeURIComponent(q.trim())}`);
  dd.innerHTML = '';
  if (!data) { dd.innerHTML = '<div class="sd-empty">Error de conexion.</div>'; return; }
  const { players = [], teams = [] } = data;
  if (!players.length && !teams.length) { dd.innerHTML = `<div class="sd-empty">Sin resultados para "${q}"</div>`; return; }
  if (teams.length) {
    dd.appendChild(el('div', { class: 'sd-g' }, ['EQUIPOS']));
    teams.slice(0, 7).forEach(t => {
      const it = el('div', { class: 'sd-r' });
      it.appendChild(teamImg(t.team_name, 'width:18px;height:18px;object-fit:contain;border-radius:3px;'));
      it.appendChild(el('span', {}, [t.team_name]));
      it.appendChild(el('span', { class: 'sd-sub' }, ['equipo']));
      it.addEventListener('click', () => { dd.classes.add('hidden'); $('srchInput').value = ''; nav('teamProfile', { name: t.team_name }); });
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
  dot.className = 's-dot loading'; txt.textContent = 'Conectando...';

  const [leagues, seasons] = await Promise.all([api('/leagues'), api('/seasons')]);

  if (!leagues) {
    dot.className = 's-dot error'; txt.textContent = 'Sin conexion';
    toast('No se pudo conectar al backend. Esta corriendo en puerto 3000?', 'err', 7000);
  } else {
    dot.className = 's-dot ok'; txt.textContent = 'Conectado';
    S.leagues = leagues;
    S.seasons = seasons || [];
    const sortedSeasons = [...S.seasons].sort((a,b) => b.season_name.localeCompare(a.season_name));
    const active = S.seasons.find(s => s.season_name === ACT_SN) || sortedSeasons[0] || null;
    S.activeSid  = active?.season_id || null;
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


/* ══════════════════════════════════════════════════════════════
   VALIDACIÓN DEL MODELO — Backtest sobre temporada actual
   Divide la temporada actual en entrenamiento (primeras N jornadas)
   y prueba (resto), y muestra qué tan bien predijo el modelo.
══════════════════════════════════════════════════════════════ */
async function vBacktest(wrap) {
  wrap.appendChild(el('div', { class: 'pg-head' }, [
    el('h1', { class: 'pg-title' }, ['Validación del Modelo']),
    el('p',  { class: 'pg-sub'   }, ['Entrena con historial + primeras N jornadas · proyecta el resto · compara tabla final']),
  ]));

  /* ── Controles ── */
  const ctrl = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:20px;' });

  const lgGrp = el('div', { style: 'display:flex;flex-direction:column;gap:4px;' });
  lgGrp.appendChild(el('label', { style: 'font-size:.75rem;color:var(--t2);letter-spacing:.5px;' }, ['LIGA']));
  const lgSel = el('select', { class: 'f-sel', style: 'min-width:160px;' });
  lgSel.appendChild(el('option', { value: '' }, ['— Selecciona —']));
  lgGrp.appendChild(lgSel);

  const rndGrp = el('div', { style: 'display:flex;flex-direction:column;gap:4px;' });
  rndGrp.appendChild(el('label', { style: 'font-size:.75rem;color:var(--t2);letter-spacing:.5px;' }, ['JORNADA DE CORTE']));
  const rndRow = el('div', { style: 'display:flex;align-items:center;gap:6px;' });
  const rndInp = el('input', { type: 'number', min: '1',
    style: 'width:68px;padding:8px 10px;border-radius:8px;border:1px solid var(--br1);background:var(--bg2);color:var(--t1);font-size:.9rem;text-align:center;' });
  const rndInfo = el('span', { style: 'font-size:.78rem;color:var(--t2);' }, ['(vacío = mitad)']);
  rndRow.append(rndInp, rndInfo); rndGrp.appendChild(rndRow);

  const runBtn = el('button', { class: 'btn btn-g', style: 'align-self:flex-end;min-width:130px;justify-content:center;' }, ['ANALIZAR']);
  ctrl.append(lgGrp, rndGrp, runBtn);
  wrap.appendChild(ctrl);

  const ra = el('div', {}); wrap.appendChild(ra);

  /* ── Ligas ── */
  const leagues = await api('/leagues');
  (leagues || []).forEach(l => lgSel.appendChild(el('option', { value: l.league_id }, [l.league_name])));
  if (S.leagueId) lgSel.value = String(S.leagueId);
  lgSel.addEventListener('change', () => { rndInp.value = ''; rndInfo.textContent = '(vacío = mitad)'; });

  async function run() {
    const lid = lgSel.value;
    if (!lid) { ra.innerHTML = ''; ra.appendChild(empt('Selecciona una liga primero.')); return; }
    const cutoff = rndInp.value ? Number(rndInp.value) : null;
    runBtn.disabled = true; runBtn.textContent = '⏳ ANALIZANDO…';
    ra.innerHTML = '';
    const _statusDiv = el('div', { style: 'padding:20px;color:var(--t1);font-size:.9rem;' }, ['🔄 Calculando proyección, un momento…']);
    ra.appendChild(_statusDiv);

    let data;
    try {
      data = await api(`/predict/backtest/${lid}${cutoff ? '?cutoffRound=' + cutoff : ''}`);
    } catch(e) {
      ra.innerHTML = ''; ra.appendChild(empt('Error de red: ' + e.message));
      runBtn.disabled = false; runBtn.textContent = 'ANALIZAR'; return;
    }
    runBtn.disabled = false; runBtn.textContent = 'ANALIZAR';
    ra.innerHTML = '';

    if (!data || data.error) { ra.appendChild(empt(data?.error || 'Error del servidor.')); return; }

    /* Actualizar info jornadas */
    rndInfo.textContent = `/ ${data.total_rounds} jornadas`;
    rndInp.max = String(data.total_rounds - 1);

    /* ── KPIs ── */
    const m = data.metrics;
    const kRow = el('div', { class: 'kpi-row', style: 'margin-bottom:18px;' });
    const mkK = (lbl, val, sub, cls = '') => {
      const k = el('div', { class: `kpi-card ${cls}` });
      k.append(el('div', { class: 'kpi-val' }, [val]),
               el('div', { class: 'kpi-lbl' }, [lbl]));
      if (sub) k.appendChild(el('div', { class: 'kpi-sub' }, [sub]));
      return k;
    };
    kRow.append(
      mkK('PRECISIÓN GANADOR', `${m.accuracy_winner_pct}%`,
          m.accuracy_winner_pct >= 55 ? '✓ Bueno (>55%)' : m.accuracy_winner_pct >= 45 ? '~ Aceptable' : '✗ Bajo',
          m.accuracy_winner_pct >= 55 ? 'kpi-green' : m.accuracy_winner_pct >= 45 ? 'kpi-amber' : ''),
      mkK('POSICIÓN ±1 PUESTO', `${m.rank_within_1_pct}%`,  'Equipos en rango ±1'),
      mkK('POSICIÓN ±3 PUESTOS', `${m.rank_within_3_pct}%`, 'Equipos en rango ±3'),
      mkK('ERROR MEDIO POSICIÓN', `${m.avg_rank_error}`, 'Puestos promedio de diferencia'),
    );
    ra.appendChild(kRow);

    /* ── Info partición ── */
    const info = el('div', { class: 'pred-explain', style: 'margin-bottom:16px;font-size:.82rem;' });
    info.innerHTML =
      `<strong>Temporada:</strong> ${fmtSn(data.season)} &nbsp;·&nbsp;` +
      `<strong>Entrenamiento:</strong> jornadas 1–${data.train_rounds} (${data.train_matches} partidos) &nbsp;·&nbsp;` +
      `<strong>Proyección:</strong> jornadas ${data.train_rounds + 1}–${data.total_rounds} (${data.test_matches} partidos) &nbsp;·&nbsp;` +
      `<strong>Corte:</strong> ${data.cutoff_date}`;
    ra.appendChild(info);

    /* ── Tabla comparativa de standings ── */
    const sec = el('div', { class: 'pred-section', style: 'overflow-x:auto;margin-bottom:20px;' });
    sec.appendChild(el('div', { class: 'mkt-title', style: 'margin-bottom:8px;' }, ['TABLA PROYECTADA vs TABLA REAL FINAL']));

    const tbl = el('table', { class: 'bt-table' });
    const th = (...cols) => {
      const tr = el('tr');
      cols.forEach(([txt, st]) => tr.appendChild(el('th', { style: st || '' }, [txt])));
      return tr;
    };
    const thead = el('thead');
    thead.appendChild(th(
      ['#', 'text-align:center;width:28px;'], ['Equipo', ''],
      ['PJ', 'text-align:center;'], ['Pts PROY', 'text-align:center;color:#7ec8e3;'],
      ['Pts REAL', 'text-align:center;color:#a8e6a3;'], ['Δ Pts', 'text-align:center;'],
      ['Pos PROY', 'text-align:center;color:#7ec8e3;'], ['Pos REAL', 'text-align:center;color:#a8e6a3;'],
      ['Δ Pos', 'text-align:center;'],
    ));
    tbl.appendChild(thead);

    /* Map real standings for lookup */
    const realMap = new Map(data.actual_standings.map(t => [t.team, t]));
    const tbody = el('tbody');

    for (const p of data.projected_standings) {
      const r   = realMap.get(p.team);
      const dPts = r ? parseFloat((p.pts - r.pts).toFixed(1)) : '—';
      const dPos = p.real_rank !== '?' ? (p.real_rank - p.rank) : '—';
      const posCls = typeof dPos === 'number'
        ? (dPos > 0 ? 'color:#4caf7d;font-weight:700;' : dPos < 0 ? 'color:#ef5350;font-weight:700;' : '')
        : '';
      const tr = el('tr');
      tr.append(
        el('td', { style: 'text-align:center;font-weight:700;color:var(--t2);' }, [String(p.rank)]),
        el('td', {}, [
          teamImg(p.team, 'width:16px;height:16px;margin-right:6px;vertical-align:middle;'),
          p.team,
        ]),
        el('td', { style: 'text-align:center;color:var(--t2);' }, [String(p.played)]),
        el('td', { style: 'text-align:center;font-weight:700;color:#7ec8e3;' }, [String(p.pts)]),
        el('td', { style: 'text-align:center;font-weight:700;color:#a8e6a3;' }, [r ? String(r.pts) : '—']),
        el('td', { style: `text-align:center;${typeof dPts === 'number' && dPts > 0 ? 'color:#4caf7d;' : dPts < 0 ? 'color:#ef5350;' : ''}` },
            [typeof dPts === 'number' ? (dPts > 0 ? '+' + dPts : String(dPts)) : dPts]),
        el('td', { style: 'text-align:center;color:#7ec8e3;font-weight:600;' }, [String(p.rank)]),
        el('td', { style: 'text-align:center;color:#a8e6a3;font-weight:600;' }, [String(p.real_rank)]),
        el('td', { style: `text-align:center;${posCls}` },
            [typeof dPos === 'number' ? (dPos > 0 ? '▲' + dPos : dPos < 0 ? '▼' + Math.abs(dPos) : '=') : dPos]),
      );
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    sec.appendChild(tbl);
    ra.appendChild(sec);

    /* ── Predicciones partido a partido (colapsable) ── */
    if (data.match_predictions?.length) {
      const det = el('details', { style: 'margin-top:8px;' });
      det.appendChild(el('summary', { class: 'mkt-title', style: 'cursor:pointer;margin-bottom:8px;list-style:none;' },
        [`▶ PARTIDOS DE PRUEBA — ${data.test_matches} partidos · ${m.accuracy_winner_pct}% ganador correcto`]));

      const tbl2 = el('table', { class: 'bt-table' });
      const thead2 = el('thead');
      thead2.appendChild(th(
        ['Fecha',''], ['Local',''], ['Pred','text-align:center;'], ['Real','text-align:center;'],
        ['Visitante',''], ['%L','text-align:center;'], ['%E','text-align:center;'],
        ['%V','text-align:center;'], ['✓','text-align:center;'],
      ));
      tbl2.appendChild(thead2);
      const tbody2 = el('tbody');
      for (const p of data.match_predictions) {
        const exact = (p.pred_home === p.real_home && p.pred_away === p.real_away);
        const tr2 = el('tr', { class: p.correct ? 'bt-ok' : 'bt-fail' });
        tr2.append(
          el('td', {}, [p.match_date]),
          el('td', { class: 'bt-tn' }, [teamImg(p.home_team, 'width:13px;height:13px;margin-right:4px;vertical-align:middle;'), p.home_team]),
          el('td', { style: 'text-align:center;font-weight:600;' }, [p.pred_home + '–' + p.pred_away]),
          el('td', { style: `text-align:center;font-weight:700;${exact ? 'color:var(--acc);' : ''}` }, [p.real_home + '–' + p.real_away]),
          el('td', { class: 'bt-tn' }, [teamImg(p.away_team, 'width:13px;height:13px;margin-right:4px;vertical-align:middle;'), p.away_team]),
          el('td', { style: 'text-align:center;font-size:.78rem;color:var(--t2);' }, [p.home_win_prob + '%']),
          el('td', { style: 'text-align:center;font-size:.78rem;color:var(--t2);' }, [p.draw_prob + '%']),
          el('td', { style: 'text-align:center;font-size:.78rem;color:var(--t2);' }, [p.away_win_prob + '%']),
          el('td', { style: 'text-align:center;' }, [p.correct ? '✓' : '✗']),
        );
        tbody2.appendChild(tr2);
      }
      tbl2.appendChild(tbody2);
      det.appendChild(el('div', { style: 'overflow-x:auto;' }, [])).appendChild(tbl2);
      ra.appendChild(det);
    }
  }

  runBtn.addEventListener('click', run);
}

document.addEventListener('DOMContentLoaded', init);