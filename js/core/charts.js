// Preflop strategy charts (100bb cash approximations of solver outputs).
// Ranges are text so they stay readable/editable. Weight suffix ":0.5" = mixed frequency.
import { parseRange, rangeWidth, topRange, addRanges, subtractRange } from './ranges.js';
import { PREFLOP_ORDER, PREFLOP_SCORE, ALLIN_ORDER, solvePushFold } from './preflop.js';
import { NUM_CLASSES, CLASS_COMBO_COUNT } from './cards.js';

// ---------- Positions ----------
export const POSITIONS_BY_SIZE = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['CO', 'BTN', 'SB', 'BB'],
  5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7: ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};
export const POS_LABEL = {
  UTG: '槍口', UTG1: '槍口+1', UTG2: '槍口+2', LJ: '低位', HJ: '劫位', CO: '關煞', BTN: '按鈕', SB: '小盲', BB: '大盲',
};
export const POS_SHORT = { UTG: 'UTG', UTG1: 'UTG+1', UTG2: 'UTG+2', LJ: 'LJ', HJ: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB' };

export function positionsFor(size) { return POSITIONS_BY_SIZE[Math.max(2, Math.min(9, size))]; }
/** Players left to act behind `pos` preflop. */
export function playersBehind(pos, size) {
  const list = positionsFor(size);
  const i = list.indexOf(pos);
  return i < 0 ? 0 : list.length - 1 - i;
}
/** Postflop acting order index (SB first ... BTN last). Higher = acts later (more in position). */
export function postflopOrder(pos, size) {
  const list = positionsFor(size);
  if (size === 2) return pos === 'BTN' ? 1 : 0; // heads-up: BTN acts last postflop
  const order = ['SB', 'BB', ...list.filter((p) => p !== 'SB' && p !== 'BB')];
  return order.indexOf(pos);
}
export const isBlind = (pos) => pos === 'SB' || pos === 'BB';

// ---------- RFI (raise first in) by players behind ----------
const RFI = {
  8: '55+, 44:0.5, 33:0.3, 22:0.3, ATs+, A9s:0.5, A5s, A4s:0.5, KTs+, QTs+, JTs, T9s:0.5, AJo+, KQo:0.6',
  7: '44+, 33:0.5, 22:0.5, A9s+, A5s-A4s, KTs+, K9s:0.5, QTs+, Q9s:0.5, JTs, J9s:0.5, T9s, 98s:0.5, AJo+, KQo',
  6: '33+, 22:0.6, A8s+, A5s-A3s, K9s+, Q9s+, J9s+, T9s, 98s, 87s:0.5, AJo+, ATo:0.5, KQo, KJo:0.3',
  5: '22+, A2s+, K9s+, K8s:0.5, Q9s+, J9s+, T9s, 98s, 87s:0.5, 76s:0.5, 65s:0.5, AJo+, ATo:0.5, KQo, KJo:0.5',
  4: '22+, A2s+, K7s+, Q9s+, Q8s:0.5, J9s+, T8s+, 97s+, 87s, 76s, 65s, 54s:0.5, ATo+, KJo+, KTo:0.5, QJo',
  3: '22+, A2s+, K6s+, K5s:0.5, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A8o+, A5o:0.5, KTo+, QTo+, JTo',
  2: '22+, A2s+, K2s+, Q4s+, Q3s:0.5, Q2s:0.5, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 53s+, 43s, A4o+, A3o:0.5, A2o:0.5, K8o+, K7o:0.5, Q9o+, Q8o:0.5, J9o+, T8o+, 98o:0.5',
  1: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, A3o+, A2o:0.5, K9o+, Q9o+, J9o+, T9o',
  HU: '22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o+, K2o+, Q2o+, J4o+, T6o+, 96o+, 86o+, 75o+, 64o+, 54o',
};

// ---------- Versus an open: 3-bet / call ----------
// opener groups: EP_TIGHT (>=7 behind), EP (5-6), MP (4), CO (3), BTN (2), SB (1)
const VS_OPEN = {
  EP_TIGHT: {
    IP: { r: 'QQ+, AKs, AKo:0.7, A5s:0.3', c: 'JJ-66, 55:0.5, 44:0.3, AQs, AJs, ATs:0.5, KQs, KJs:0.5, QJs:0.5, JTs:0.5, T9s:0.3, AKo:0.3, AQo:0.5' },
    SB: { r: 'QQ+, AK, AQs:0.5, A5s:0.3', c: 'JJ:0.5, TT:0.5, 99:0.3, AQs:0.5, KQs:0.3' },
    BB: { r: 'QQ+, AKs, AKo:0.8, A5s:0.4', c: 'JJ-22, AQs-A2s, KQs-K9s, QJs-Q9s, JTs-J9s, T9s, T8s:0.5, 98s, 97s:0.3, 87s, 76s, 65s, 54s:0.5, AKo:0.2, AQo, AJo, ATo:0.5, KQo, KJo:0.5, QJo:0.3' },
  },
  EP: {
    IP: { r: 'QQ+, AK, AQs:0.4, A5s-A4s:0.5, KQs:0.2', c: 'JJ-22, AQs:0.6, AJs-ATs, KQs:0.8, KJs-KTs, QJs, QTs, JTs, T9s, 98s, 87s, 76s:0.5, 65s:0.5, AQo:0.7, AJo:0.3, KQo:0.4' },
    SB: { r: 'JJ+, AK, AQs, AJs:0.5, KQs:0.5, A5s-A4s:0.5', c: 'TT-88:0.5, AQo:0.3' },
    BB: { r: 'QQ+, AK, AQs:0.4, A5s-A3s:0.5, K9s:0.2', c: 'JJ-22, AQs:0.6, AJs-A2s, KQs-K8s, QJs-Q8s, JTs-J8s, T9s-T8s, 98s-97s, 87s-86s, 76s-75s, 65s-64s, 54s, AQo-ATo, A9o:0.3, KQo-KTo, QJo-QTo, JTo' },
  },
  MP: {
    IP: { r: 'JJ+, AK, AQs, AJs:0.3, KQs:0.4, A5s-A3s:0.5, KJs:0.2, 76s:0.2, 65s:0.2', c: 'TT-22, AJs:0.7, ATs-A9s, KJs:0.8, KTs-K9s, QJs-Q9s, JTs-J9s, T9s, T8s:0.5, 98s, 87s, 76s:0.8, 65s:0.8, 54s:0.4, AQo, AJo:0.6, KQo:0.7, KJo:0.3' },
    SB: { r: 'TT+, AJs+, AQo+, KQs, KJs:0.6, QJs:0.4, A5s-A4s, A3s:0.5, 76s:0.2', c: '99-77:0.4, ATs:0.4, JTs:0.3' },
    BB: { r: 'JJ+, AQs+, AKo, A5s-A3s:0.6, K9s:0.3, Q9s:0.2, 76s:0.2, AQo:0.4', c: 'TT-22, AJs-A2s, KQs-K6s, QJs-Q7s, JTs-J7s, T9s-T7s, 98s-96s, 87s-85s, 76s-74s, 65s-64s, 54s-53s, AQo:0.6, AJo-A9o, A8o:0.4, KQo-KTo, K9o:0.3, QJo-QTo, JTo, T9o:0.4' },
  },
  CO: {
    IP: { r: 'TT+, AJs+, AQo+, KQs, KJs:0.5, A5s-A2s:0.6, K9s:0.3, Q9s:0.3, J9s:0.3, T8s:0.3, 76s:0.3, 65s:0.3, KJo:0.3, ATs:0.4', c: '99-22, ATs:0.6, A9s-A6s, KJs:0.5, KTs-K9s, QJs-Q9s, JTs-J9s, T9s, 98s, 87s, 76s:0.7, 65s:0.7, 54s:0.5, AJo, ATo:0.5, KQo, KJo:0.5, QJo:0.5' },
    SB: { r: '88+, ATs+, AJo+, KTs+, QTs+, JTs, A5s-A2s, KQo, K9s:0.5, 98s:0.4, 87s:0.4, 76s:0.4, ATo:0.5, A9s:0.5, 77:0.5', c: '66-55:0.3' },
    BB: { r: 'JJ+, AQs+, AKo, A5s-A2s:0.5, KJs:0.4, K8s:0.3, Q9s:0.3, J9s:0.3, 76s:0.3, 65s:0.3, AQo:0.5', c: 'TT-22, AJs-A2s, KQs-K2s, QJs-Q5s, JTs-J7s, T9s-T6s, 98s-96s, 87s-85s, 76s-74s, 65s-63s, 54s-53s, 43s, AQo:0.5, AJo-A5o, A4o:0.5, KQo-K9o, QJo-Q9o, JTo-J9o, T9o, 98o, 87o:0.5' },
  },
  BTN: {
    IP: { r: 'TT+, AJs+, AQo+, KQs, A5s-A2s:0.5, K9s:0.3, KJo:0.3', c: '99-22, ATs-A6s, KJs-K9s, QJs-Q9s, JTs-J9s, T9s, 98s, 87s, 76s, 65s, AJo, ATo:0.5, KQo' },
    SB: { r: '77+, A8s+, A5s-A2s, KTs+, QTs+, JTs, T9s, AJo+, KQo, KJo:0.6, ATo:0.6, K9s:0.5, Q9s:0.5, J9s:0.5, 98s:0.5, 87s:0.4, 76s:0.4, 66:0.5, A7s:0.5', c: '55-22:0.3, A6s:0.3' },
    BB: { r: 'TT+, AJs+, AQo+, KQs, A5s-A2s:0.5, A9s:0.3, K9s:0.3, Q9s:0.3, J9s:0.3, T8s:0.3, 97s:0.3, 86s:0.3, 75s:0.3, 64s:0.3, 53s:0.3, KJo:0.3, 99:0.3', c: '99:0.7, 88-22, ATs-A2s, KJs-K2s, QJs-Q2s, JTs-J4s, T9s-T5s, 98s-95s, 87s-85s, 76s-74s, 65s-63s, 54s-53s, 43s, AJo-A2o, KQo-K7o, QJo-Q8o, JTo-J8o, T9o-T8o, 98o, 87o, 76o, 65o' },
  },
  SB: {
    BB: { r: 'TT+, ATs+, AJo+, KJs+, KQo, QJs, A5s-A2s, 98s:0.3, 87s:0.3, 76s:0.3, 65s:0.3, K9s:0.3, Q9s:0.3, J9s:0.3, 99:0.5', c: '99:0.5, 88-22, A9s-A6s, KTs-K2s, QTs-Q2s, JTs-J3s, T9s-T5s, 98s-95s, 87s-85s, 76s-74s, 65s-64s, 54s-53s, 43s, ATo-A2o, KJo-K5o, QJo-Q7o, JTo-J7o, T9o-T7o, 98o-97o, 87o-86o, 76o, 65o' },
  },
};

// ---------- Hero opened, facing a 3-bet ----------
const VS_3BET = {
  EP: { r: 'KK+, AKs, AKo:0.5, A5s:0.2', c: 'QQ-TT, 99:0.5, 88:0.3, AKo:0.5, AQs, AJs:0.5, KQs, KJs:0.3, QJs:0.3, JTs:0.4' },
  MP: { r: 'QQ+, AK, A5s-A4s:0.4, KQs:0.2', c: 'JJ-77, 66:0.5, AQs-ATs, AQo:0.5, KQs:0.8, KJs-KTs, QJs, QTs:0.5, JTs, T9s, 98s:0.5, 87s:0.3' },
  LATE: { r: 'QQ+, AK, A5s-A2s:0.4, K9s:0.2, AQo:0.3', c: 'JJ-55, 44:0.5, AQs-A7s, AQo:0.7, AJo:0.4, KQs-K9s, QJs-Q9s, JTs-J9s, T9s, T8s:0.5, 98s, 87s, 76s, 65s, KQo:0.5' },
  SB: { r: 'QQ+, AK, A5s-A4s:0.5, KQs:0.2', c: 'JJ-66, AQs-ATs, KQs:0.8, KJs, QJs, JTs, T9s:0.5, AQo:0.6' },
};
// ---------- Hero 3-bet, facing a 4-bet ----------
const VS_4BET = { r: 'KK+, AKs, QQ:0.5, AKo:0.6, A5s:0.15', c: 'QQ:0.5, JJ:0.5, AKo:0.4, AQs:0.3, TT:0.2' };
// ---------- Facing a 5-bet shove ----------
const VS_5BET = { c: 'QQ+, AK, JJ:0.4' };

// Villain-side ranges derived from the same tables
export function openerGroup(behind, size) {
  if (size === 2) return 'SB';
  if (behind >= 7) return 'EP_TIGHT';
  if (behind >= 5) return 'EP';
  if (behind === 4) return 'MP';
  if (behind === 3) return 'CO';
  if (behind === 2) return 'BTN';
  return 'SB';
}
function vs3betGroup(behind, pos) {
  if (pos === 'SB') return 'SB';
  if (behind >= 5) return 'EP';
  if (behind >= 3) return 'MP';
  return 'LATE';
}

const cache = new Map();
const R = (s) => { if (!cache.has(s)) cache.set(s, parseRange(s)); return cache.get(s); };

export function rfiRange(pos, size) {
  if (size === 2 && pos === 'BTN') return R(RFI.HU);
  const b = playersBehind(pos, size);
  if (b <= 0) return new Float32Array(NUM_CLASSES);
  return R(RFI[Math.min(8, b)]);
}

function heroSlot(heroPos) { return heroPos === 'SB' ? 'SB' : heroPos === 'BB' ? 'BB' : 'IP'; }

/** Raise and call frequencies may overlap in the text charts: call := min(call, 1 - raise). */
const rcCache = new Map();
function RC(r, c) {
  const key = r + '|' + c;
  if (!rcCache.has(key)) {
    const raise = R(r), call0 = R(c);
    const call = new Float32Array(NUM_CLASSES);
    for (let i = 0; i < NUM_CLASSES; i++) call[i] = Math.max(0, Math.min(call0[i], 1 - raise[i]));
    rcCache.set(key, { raise, call });
  }
  return rcCache.get(key);
}

export function vsOpenRanges(openerPos, heroPos, size) {
  const g = openerGroup(playersBehind(openerPos, size), size);
  const slot = heroSlot(heroPos);
  const tbl = VS_OPEN[g] || VS_OPEN.CO;
  const e = tbl[slot] || tbl.BB || tbl.IP || Object.values(tbl)[0];
  return { ...RC(e.r, e.c), group: g, slot };
}

export function vs3betRanges(heroPos, size) {
  const g = vs3betGroup(playersBehind(heroPos, size), heroPos);
  const e = VS_3BET[g];
  return { ...RC(e.r, e.c), group: g };
}
export function vs4betRanges() { return RC(VS_4BET.r, VS_4BET.c); }
export function vs5betRanges() { return { raise: new Float32Array(NUM_CLASSES), call: R(VS_5BET.c) }; }

// ---------- Opponent-type range width adjustment ----------
export const VILLAIN_TYPES = {
  unknown: { label: '未知 / 常規', short: '常規', width: 1.0, bluff: 0.2, callAdj: 1.0, raiseAdj: 1.0, desc: '接近平衡的常規玩家' },
  nit: { label: '緊弱 (Nit)', short: '緊弱', width: 0.7, bluff: 0.06, callAdj: 0.8, raiseAdj: 0.6, desc: '只玩強牌，很少詐唬' },
  tag: { label: '緊兇 (TAG)', short: '緊兇', width: 0.95, bluff: 0.22, callAdj: 0.95, raiseAdj: 1.1, desc: '選擇性強、下注積極' },
  lag: { label: '鬆兇 (LAG)', short: '鬆兇', width: 1.35, bluff: 0.34, callAdj: 1.1, raiseAdj: 1.3, desc: '範圍寬、詐唬多' },
  station: { label: '跟注站', short: '跟注站', width: 1.6, bluff: 0.07, callAdj: 1.45, raiseAdj: 0.7, desc: '很少棄牌、也很少詐唬' },
  maniac: { label: '瘋子 (Maniac)', short: '瘋子', width: 2.0, bluff: 0.5, callAdj: 1.2, raiseAdj: 1.8, desc: '極度激進，大量詐唬' },
};

/** Widen/narrow a class range by factor k using the preflop strength order. */
export function adjustRangeWidth(range, k) {
  if (Math.abs(k - 1) < 0.02) return range;
  const w0 = rangeWidth(range);
  const target = Math.max(0.01, Math.min(1, w0 * k));
  const out = new Float32Array(range);
  if (k < 1) {
    // remove weakest members first
    let remove = (w0 - target) * 1326;
    const members = [];
    for (let c = 0; c < NUM_CLASSES; c++) if (out[c] > 0) members.push(c);
    members.sort((a, b) => PREFLOP_SCORE[a] - PREFLOP_SCORE[b]);
    for (const c of members) {
      if (remove <= 0) break;
      const have = out[c] * CLASS_COMBO_COUNT[c];
      const take = Math.min(have, remove);
      out[c] -= take / CLASS_COMBO_COUNT[c];
      remove -= take;
    }
  } else {
    let add = (target - w0) * 1326;
    for (const c of PREFLOP_ORDER) {
      if (add <= 0) break;
      const room = (1 - out[c]) * CLASS_COMBO_COUNT[c];
      if (room <= 0) continue;
      const take = Math.min(room, add);
      out[c] += take / CLASS_COMBO_COUNT[c];
      add -= take;
    }
  }
  return out;
}

// ---------- Push / fold ----------
const PUSH_FACTOR = { 1: 1, 2: 0.6, 3: 0.43, 4: 0.35, 5: 0.3, 6: 0.26, 7: 0.23, 8: 0.21 };
const pfCache = new Map();
function sbNash(stack, ante) {
  const key = `${Math.round(stack * 2) / 2}|${ante}`;
  if (!pfCache.has(key)) pfCache.set(key, solvePushFold(Math.max(1, Math.round(stack * 2) / 2), ante));
  return pfCache.get(key);
}
/** Push range (class weights) for hero first-in with stack S (BB). */
export function pushRange(pos, size, S, ante = 0) {
  const nash = sbNash(S, ante);
  const behind = size === 2 ? 1 : playersBehind(pos, size);
  let sbWidth = 0;
  for (let c = 0; c < NUM_CLASSES; c++) sbWidth += nash.push[c] * CLASS_COMBO_COUNT[c];
  sbWidth /= 1326;
  if (behind <= 1) return { range: nash.push, width: sbWidth };
  const w = sbWidth * (PUSH_FACTOR[Math.min(8, behind)] || 0.2);
  return { range: topRange(w, ALLIN_ORDER), width: w };
}
/** Calling range vs a shove from a player whose push width is `pushWidth`. */
export function callVsShoveRange(S, pushWidth, heroIsBB, ante = 0) {
  // Use SB-vs-BB Nash call range as a base, tighten for non-BB callers and tighter pushers
  const nash = sbNash(S, ante);
  let cw = 0;
  for (let c = 0; c < NUM_CLASSES; c++) cw += nash.call[c] * CLASS_COMBO_COUNT[c];
  cw /= 1326;
  let pw = 0;
  for (let c = 0; c < NUM_CLASSES; c++) pw += nash.push[c] * CLASS_COMBO_COUNT[c];
  pw /= 1326;
  const tight = Math.min(1, Math.max(0.25, pushWidth / Math.max(0.05, pw)));
  const width = cw * Math.sqrt(tight) * (heroIsBB ? 1 : 0.7);
  return topRange(width, ALLIN_ORDER);
}

export function describeWidth(r) { return `${(rangeWidth(r) * 100).toFixed(1)}%`; }
export { addRanges, subtractRange };
