// Opponent range modelling: preflop range from the scenario, then Bayesian narrowing
// by each postflop action (bet / check / call / raise) using per-combo strengths.
import { NUM_COMBOS, NUM_CLASSES, CLASS_COMBOS } from './cards.js';
import { toCombos, rangeWidth, topRange } from './ranges.js';
import { comboStrengths } from './board.js';
import { PREFLOP_ORDER } from './preflop.js';
import {
  rfiRange, vsOpenRanges, vs3betRanges, vs4betRanges, VILLAIN_TYPES, adjustRangeWidth, playersBehind,
} from './charts.js';

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** Limping range: medium/speculative hands (no premiums), roughly top 60% minus top 6%. */
function limpRange() {
  const all = topRange(0.6, PREFLOP_ORDER);
  const prem = topRange(0.06, PREFLOP_ORDER);
  const out = new Float32Array(NUM_CLASSES);
  for (let c = 0; c < NUM_CLASSES; c++) out[c] = Math.max(0, all[c] - prem[c] * 0.85);
  return out;
}

/**
 * Villain preflop range (169 class weights) for a postflop spot.
 * @param {object} p { tableSize, heroPos, villainPos, potType, heroAggressor, villainType }
 */
export function villainPreflopRange(p) {
  const size = p.tableSize;
  const vPos = p.villainPos || (p.heroPos === 'BB' ? 'BTN' : 'BB');
  const hPos = p.heroPos;
  const type = VILLAIN_TYPES[p.villainType] || VILLAIN_TYPES.unknown;
  let base, desc;
  switch (p.potType) {
    case 'limped':
      base = limpRange(); desc = '跛入範圍'; break;
    case '3bet':
      if (p.heroAggressor) {
        base = vs3betRanges(vPos, size).call;
        desc = `${vPos} 開池後跟注 3-bet`;
      } else {
        base = vsOpenRanges(hPos, vPos, size).raise;
        desc = `${vPos} 對 ${hPos} 的 3-bet 範圍`;
      }
      break;
    case '4bet':
      if (p.heroAggressor) { base = vs4betRanges().call; desc = '跟注 4-bet 範圍'; }
      else { base = vs3betRanges(vPos, size).raise; desc = `${vPos} 的 4-bet 範圍`; }
      break;
    default: // single raised pot
      if (p.heroAggressor) {
        // villain called hero's open (or iso-raise)
        const r = vsOpenRanges(hPos, vPos, size);
        base = r.call;
        desc = `${vPos} 跟注 ${hPos} 開池`;
        if (rangeWidth(base) < 0.02) base = rfiRange(hPos, size);
      } else {
        base = rfiRange(vPos, size);
        if (rangeWidth(base) < 0.02) base = rfiRange('BTN', size);
        desc = `${vPos} 開池範圍`;
      }
  }
  const adj = adjustRangeWidth(base, type.width);
  return { classes: adj, desc };
}

/**
 * Likelihood of a villain action given combo strength.
 * action: 'bet' | 'check' | 'call' | 'raise'
 * ctx: { sizeRatio, isPFR, street, type, role: 'cbet'|'donk'|'stab', wetness }
 */
function likelihood(action, s, d, bucket, ctx) {
  const T = ctx.type;
  const r = ctx.sizeRatio ?? 0.6;
  const river = ctx.street === 'river';
  const role = ctx.role || 'cbet';
  if (action === 'bet' || action === 'check') {
    let p;
    if (role === 'donk') {
      // leading into the preflop raiser is rare: mostly strong hands and big draws
      p = 0.03 + 0.14 * sigmoid((s - 0.86) / 0.04) + (!river && d >= 0.3 ? 0.08 : 0);
      p *= T.raiseAdj;
      if (s < 0.4 && d < 0.12) p = Math.max(p, 0.02 * T.raiseAdj);
    } else {
      let vt = r <= 0.4 ? 0.7 : r <= 0.8 ? 0.77 : r <= 1.1 ? 0.83 : 0.87;
      if (T === VILLAIN_TYPES.nit) vt += 0.05;
      if (T === VILLAIN_TYPES.maniac) vt -= 0.1;
      if (T === VILLAIN_TYPES.lag) vt -= 0.04;
      if (T === VILLAIN_TYPES.station) vt += 0.03;
      const pv = 0.86 * sigmoid((s - vt) / 0.035);
      let bluff = T.bluff;
      if (role === 'cbet' && ctx.street === 'flop') bluff *= 1.9 - (ctx.wetness || 0);
      if (role === 'stab') bluff *= 1.6;
      if (river) bluff *= r > 0.6 ? 0.6 : 0.85; // population under-bluffs big river bets
      bluff = Math.min(0.85, bluff);
      if (!river && d >= 0.25) p = Math.max(pv, Math.min(0.8, 0.5 * (T.raiseAdj + 0.2)));
      else if (!river && d >= 0.12) p = Math.max(pv, Math.min(0.6, 0.3 * (T.raiseAdj + 0.2)));
      else if (s < 0.4) p = Math.max(pv, bluff);
      else p = Math.max(pv, Math.min(0.5, (role === 'cbet' ? 0.25 : 0.14) * T.raiseAdj));
    }
    p = Math.max(0.01, Math.min(0.97, p));
    if (action === 'bet') return p;
    return 1 - p * (bucket === 0 && role !== 'donk' ? 0.8 : 1); // monsters sometimes slow-play
  }
  if (action === 'call') {
    const t = callThreshold(r / (1 + 2 * r), ctx.street, T);
    let p = sigmoid((s - t) / 0.045);
    if (!river && d >= 0.25) p = Math.max(p, 0.85);
    else if (!river && d >= 0.14) p = Math.max(p, Math.min(0.9, 0.55 * T.callAdj));
    if (bucket === 0) p = Math.min(p, 0.72); // some monsters raise instead
    return Math.max(0.01, Math.min(0.98, p));
  }
  if (action === 'raise') {
    let p;
    if (bucket === 0) p = 0.5;
    else if (!river && d >= 0.3) p = 0.22;
    else if (bucket === 1) p = 0.08;
    else if (s < 0.35) p = 0.035;
    else p = 0.02;
    return Math.max(0.005, Math.min(0.9, p * T.raiseAdj));
  }
  return 1;
}

/**
 * Continue threshold on blended strength s (percentile vs random hands + draws) when the
 * opponent must put in `req` = call / (final pot) — i.e. the pot odds he is being laid.
 * Population-style: worse price => tighter continues; rivers need more made-hand strength.
 */
export function callThreshold(req, street, T) {
  const q = Math.min(0.5, Math.max(0.05, req));
  let t = street === 'river' ? 0.35 + 1.35 * q : 0.25 + 1.3 * q;
  if (T === VILLAIN_TYPES.station) t -= 0.15;
  else if (T === VILLAIN_TYPES.maniac) t -= 0.08;
  else if (T === VILLAIN_TYPES.lag) t -= 0.05;
  else if (T === VILLAIN_TYPES.nit) t += 0.08;
  else if (T === VILLAIN_TYPES.tag) t += 0.02;
  return t;
}

/** Probability that a combo continues (call or raise) when laid pot odds `req`. */
export function continueProb(s, d, street, req, T, isRaise = false) {
  // vs a raise: fold more on flop/turn (future streets), call down more on the river (final decision)
  const t = callThreshold(req, street, T) + (isRaise ? (street === 'river' ? -0.04 : 0.06) : 0);
  let p = 1 / (1 + Math.exp(-(s - t) / 0.045));
  if (street !== 'river') {
    if (d >= 0.3) p = Math.max(p, req <= 0.36 ? (isRaise ? 0.6 : 0.88) : 0.4);
    else if (d >= 0.15) p = Math.max(p, (isRaise ? 0.12 : 0.5) * Math.min(1.3, T.callAdj) * (req > 0.3 ? 0.6 : 1));
  }
  return Math.max(0, Math.min(1, p));
}

/**
 * Narrow combo weights by a villain action on a given board.
 * @param {Float32Array} cw  combo weights (modified copy returned)
 */
export function narrow(cw, board, dead, action, ctx) {
  const st = comboStrengths(board, dead);
  const out = new Float32Array(cw);
  const c = { ...ctx, street: board.length === 3 ? 'flop' : board.length === 4 ? 'turn' : 'river' };
  for (const k of st.live) {
    if (out[k] <= 0) continue;
    out[k] *= likelihood(action, st.s[k], st.draw[k], st.bucket[k], c);
  }
  // zero dead combos
  for (let k = 0; k < NUM_COMBOS; k++) if (st.score[k] < 0) out[k] = 0;
  return { cw: out, strengths: st };
}

/**
 * Build the full narrowed villain range for the current decision.
 * spot fields used: hero, board, tableSize, heroPos, villainPos, potType, heroAggressor,
 * villainType, history[{street:3|4|5, villain, size}], facing, bet, potStart
 */
export function buildVillainRange(spot) {
  const type = VILLAIN_TYPES[spot.villainType] || VILLAIN_TYPES.unknown;
  const pre = villainPreflopRange(spot);
  const dead = [...spot.hero];
  let cw = toCombos(pre.classes, [...spot.hero, ...spot.board]);
  const steps = [pre.desc];
  const isPFR = !spot.heroAggressor && spot.potType !== 'limped';
  const villainOOP = spot.heroIP !== false; // hero in position => villain acts first
  const roleFor = () => (isPFR ? 'cbet' : villainOOP ? 'donk' : 'stab');
  for (const h of spot.history || []) {
    if (!h || !h.villain || h.street > spot.board.length) continue;
    const b = spot.board.slice(0, h.street);
    const res = narrow(cw, b, dead, h.villain, {
      type, sizeRatio: h.size ?? 0.6, isPFR, wetness: 0, role: roleFor(),
    });
    cw = res.cw;
    steps.push(actionZh(h.villain, h.street));
  }
  // current street action by villain
  if (spot.board.length >= 3) {
    const potBefore = spot.potStart || 1;
    if (spot.facing === 'bet' || spot.facing === 'raise') {
      const sizeRatio = Math.max(0.05, (spot.bet - (spot.heroBet || 0)) / Math.max(0.1, potBefore + 2 * (spot.heroBet || 0)));
      const act = spot.facing === 'raise' ? 'raise' : 'bet';
      const res = narrow(cw, spot.board, dead, act, { type, sizeRatio, isPFR, role: roleFor() });
      cw = res.cw;
      steps.push(actionZh(act, spot.board.length) + ` (${Math.round(sizeRatio * 100)}% 池)`);
    } else if (spot.villainChecked) {
      const res = narrow(cw, spot.board, dead, 'check', { type, sizeRatio: 0.5, isPFR, role: roleFor() });
      cw = res.cw;
      steps.push(actionZh('check', spot.board.length));
    }
  }
  return { cw, preClasses: pre.classes, desc: steps.join(' → '), type };
}

const STREET_ZH = { 3: '翻牌', 4: '轉牌', 5: '河牌' };
function actionZh(a, street) {
  const s = STREET_ZH[street] || '';
  return { bet: `${s}下注`, check: `${s}過牌`, call: `${s}跟注`, raise: `${s}加注` }[a] || a;
}

/** Aggregate combo weights to 169-class weights (fraction of live combos) for display. */
export function combosToGrid(cw, dead = []) {
  const deadMask = new Uint8Array(52);
  for (const d of dead) deadMask[d] = 1;
  const g = new Float32Array(NUM_CLASSES);
  let mx = 0;
  for (let c = 0; c < NUM_CLASSES; c++) {
    let s = 0, n = 0;
    for (const k of CLASS_COMBOS[c]) { s += cw[k]; n++; }
    g[c] = n ? s / n : 0;
    if (g[c] > mx) mx = g[c];
  }
  if (mx > 0) for (let c = 0; c < NUM_CLASSES; c++) g[c] /= mx;
  return g;
}

export { playersBehind };
