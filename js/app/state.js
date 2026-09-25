// App state, persistence and the hand-flow model (UI state -> engine spot).
import { store } from './ui.js';
import { positionsFor, postflopOrder, playersBehind } from '../core/charts.js';

export const SETTINGS_DEFAULT = {
  tableSize: 6,
  stack: 100,
  openSize: 2.5,
  ante: 0,
  villainType: 'unknown',
  fourColor: true,
  haptics: true,
  bbValue: 0,          // optional: real money per BB (0 = show BB only)
  currency: '$',
  aiKey: '',
  aiModel: 'claude-opus-5',
  detectModel: 'accurate', // fast | accurate | off (accurate: 98.8% precision on real photos)
  gpu: false,
  seenIntro: false,
};

export function newHand(settings, prev) {
  return {
    id: Date.now(),
    hero: [-1, -1],
    board: [-1, -1, -1, -1, -1],
    heroPos: prev?.heroPos || 'BTN',
    pre: {
      scenario: 'unopened', openerPos: '', openSize: settings.openSize, limpers: 1, callers: 0,
      heroOpen: settings.openSize, threeBet: 0, fourBet: 0,
    },
    flop: null,      // postflop setup captured at the flop (editable)
    log: {},         // per completed street: { kind: 'xx'|'hb'|'vb'|'hbr'|'vbr', amount }
    cur: { street: 'preflop', facing: 'none', bet: 0, heroBet: 0 },
    recs: {},        // last recommendation per street {key,sizeBB,facing,bet}
  };
}

const KEY = 'pokerlens.v1';
export const state = (() => {
  const saved = store.get(KEY, null);
  const settings = { ...SETTINGS_DEFAULT, ...(saved?.settings || {}) };
  const hand = saved?.hand && saved.hand.hero ? { ...newHand(settings), ...saved.hand } : newHand(settings);
  return { settings, hand, history: saved?.history || [], tab: 'table', activeSlot: null, result: null, busy: false };
})();

export function save() {
  store.set(KEY, { settings: state.settings, hand: state.hand, history: state.history.slice(0, 60) });
}

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(reason) { save(); for (const fn of listeners) fn(reason); }

// ---------- Board helpers ----------
export function boardCards(h = state.hand) {
  const b = h.board;
  if (!(b[0] >= 0 && b[1] >= 0 && b[2] >= 0)) return [];
  const out = b.slice(0, 3);
  if (b[3] >= 0) { out.push(b[3]); if (b[4] >= 0) out.push(b[4]); }
  return out;
}
export function streetOf(n) { return n === 0 ? 'preflop' : n === 3 ? 'flop' : n === 4 ? 'turn' : 'river'; }
export const STREET_N = { preflop: 0, flop: 3, turn: 4, river: 5 };
export const STREET_ZH = { preflop: '翻前', flop: '翻牌', turn: '轉牌', river: '河牌' };
export function usedCards(h = state.hand) {
  return new Set([...h.hero, ...h.board].filter((c) => c >= 0));
}

// ---------- Preflop helpers ----------
export function positionsBefore(pos, size) {
  const list = positionsFor(size);
  const i = list.indexOf(pos);
  return i < 0 ? [] : list.slice(0, i);
}
export function positionsAfter(pos, size) {
  const list = positionsFor(size);
  const i = list.indexOf(pos);
  return i < 0 ? [] : list.slice(i + 1);
}
export function defaultOpener(h, size) {
  const before = positionsBefore(h.heroPos, size);
  if (h.pre.openerPos && before.includes(h.pre.openerPos)) return h.pre.openerPos;
  return before.includes('CO') ? 'CO' : before[before.length - 1] || '';
}
export function default3Bettor(h, size) {
  const after = positionsAfter(h.heroPos, size);
  if (h.pre.openerPos && after.includes(h.pre.openerPos)) return h.pre.openerPos;
  return after.includes('BTN') ? 'BTN' : after.includes('BB') ? 'BB' : after[0] || 'BB';
}

function deadMoney(size, ante, involved) {
  let d = ante * size;
  if (!involved.includes('SB')) d += 0.5;
  if (!involved.includes('BB')) d += 1;
  return d;
}

/**
 * Postflop setup derived from the preflop scenario + what hero (probably) did.
 * Returns { potType, heroAggressor, villainPos, villains, pot, heroInvested, desc, allIn? , folded? }
 */
export function autoFlopSetup(st = state) {
  const s = st.settings, h = st.hand, size = s.tableSize;
  const pre = h.pre;
  const rec = h.recs.preflop?.key || 'call';
  const hp = h.heroPos;
  const O = pre.openSize || s.openSize;
  switch (pre.scenario) {
    case 'limped': {
      const L = Math.max(1, pre.limpers || 1);
      if (rec === 'raise') {
        const to = h.recs.preflop?.sizeBB || 4 + L;
        return { potType: 'srp', heroAggressor: true, villainPos: 'BB' === hp ? 'UTG' : 'BB', villains: 1, pot: 2 * to + (L - 1) + deadMoney(size, s.ante, [hp, 'BB']), heroInvested: to, desc: `你加注孤立到 ${to} BB，1 人跟注` };
      }
      const players = L + 1 + (hp === 'BB' ? 0 : 1);
      const pot = L + 1 + (hp === 'BB' ? 0 : 1) + (hp === 'SB' ? 0 : 0.5) + s.ante * size;
      return { potType: 'limped', heroAggressor: false, villainPos: hp === 'BB' ? 'BTN' : 'BB', villains: Math.min(5, players - 1), pot, heroInvested: 1, desc: `跛入底池，${players} 人看翻牌` };
    }
    case 'vsOpen': {
      const opener = pre.openerPos || defaultOpener(h, size);
      const C = pre.callers || 0;
      if (rec === 'raise') {
        const to = h.recs.preflop?.sizeBB || O * 3;
        return { potType: '3bet', heroAggressor: true, villainPos: opener, villains: 1, pot: 2 * to + C * O + deadMoney(size, s.ante, [hp, opener]), heroInvested: to, desc: `你 3-bet 到 ${to} BB，${opener} 跟注` };
      }
      if (rec === 'allin') return { allIn: true, desc: '翻前全下' };
      return { potType: 'srp', heroAggressor: false, villainPos: opener, villains: 1 + C, pot: O * (2 + C) + deadMoney(size, s.ante, [hp, opener]), heroInvested: O, desc: `你跟注 ${opener} 的 ${O} BB 開池` };
    }
    case 'vs3bet': {
      const v = pre.openerPos || default3Bettor(h, size);
      const T = pre.threeBet || (pre.heroOpen || O) * 3.5;
      if (rec === 'raise') {
        const to = h.recs.preflop?.sizeBB || T * 2.3;
        return { potType: '4bet', heroAggressor: true, villainPos: v, villains: 1, pot: 2 * to + deadMoney(size, s.ante, [hp, v]), heroInvested: to, desc: `你 4-bet 到 ${to} BB，對手跟注` };
      }
      if (rec === 'allin') return { allIn: true, desc: '翻前全下' };
      return { potType: '3bet', heroAggressor: false, villainPos: v, villains: 1, pot: 2 * T + deadMoney(size, s.ante, [hp, v]), heroInvested: T, desc: `你跟注 ${v} 的 3-bet（${T} BB）` };
    }
    case 'vs4bet': {
      const v = pre.openerPos || default3Bettor(h, size);
      const F = pre.fourBet || 22;
      return { potType: '4bet', heroAggressor: false, villainPos: v, villains: 1, pot: 2 * F + deadMoney(size, s.ante, [hp, v]), heroInvested: F, desc: `你跟注 4-bet（${F} BB）` };
    }
    default: {
      if (hp === 'BB') return { potType: 'limped', heroAggressor: false, villainPos: 'SB', villains: 1, pot: 2 + s.ante * size, heroInvested: 1, desc: '大盲看翻牌' };
      const to = h.recs.preflop?.sizeBB || (hp === 'SB' ? 3 : s.openSize);
      const v = hp === 'SB' ? 'BB' : 'BB';
      return { potType: 'srp', heroAggressor: true, villainPos: v, villains: 1, pot: 2 * to + deadMoney(size, s.ante, [hp, v]), heroInvested: to, desc: `你開池 ${to} BB，大盲跟注` };
    }
  }
}

/** Pot/investment contributed during a completed street. */
export function streetContribution(log, villains = 1) {
  if (!log) return { pot: 0, hero: 0 };
  const a = log.amount || 0;
  switch (log.kind) {
    case 'hb': return { pot: a * (1 + (log.callers || 1)), hero: a };
    case 'vb': return { pot: a * 2 + a * (log.others || 0), hero: a };
    case 'hbr': return { pot: a * 2, hero: a };
    case 'vbr': return { pot: a * 2, hero: a };
    default: return { pot: 0, hero: 0 };
  }
}
const LOG_TO_VILLAIN = { xx: 'check', hb: 'call', vb: 'bet', hbr: 'raise', vbr: 'call' };
export const LOG_LABEL = {
  xx: '雙方過牌', hb: '我下注，對手跟注', vb: '對手下注，我跟注', hbr: '我下注，對手加注，我跟注', vbr: '對手下注，我加注，對手跟注',
};

export function heroIsIP(heroPos, villainPos, size) {
  return postflopOrder(heroPos, size) > postflopOrder(villainPos, size);
}

/** Build the engine spot + derived display data from the current state. */
export function deriveSpot(st = state) {
  const s = st.settings, h = st.hand;
  const hero = h.hero.filter((c) => c >= 0);
  const board = boardCards(h);
  const street = streetOf(board.length);
  const base = {
    hero, board, tableSize: s.tableSize, heroPos: h.heroPos, stack: s.stack, ante: s.ante,
    villainType: s.villainType, openSize: s.openSize,
  };
  const d = { street, ready: hero.length === 2, board };
  if (street === 'preflop') {
    const pre = { ...h.pre };
    if (pre.scenario === 'vsOpen') pre.openerPos = pre.openerPos || defaultOpener(h, s.tableSize);
    if (pre.scenario === 'vs3bet') { pre.openerPos = pre.openerPos || default3Bettor(h, s.tableSize); pre.openSize = pre.threeBet || (pre.heroOpen || s.openSize) * 3.5; }
    if (pre.scenario === 'vs4bet') { pre.openerPos = pre.openerPos || default3Bettor(h, s.tableSize); pre.heroOpen = pre.threeBet || 9; pre.openSize = pre.fourBet || 22; }
    base.preflop = pre;
    d.spot = base;
    return d;
  }
  const fs = h.flop || autoFlopSetup(st);
  d.flopSetup = fs;
  if (fs.allIn) { d.allIn = true; d.spot = null; return d; }
  let pot = fs.pot, heroInv = fs.heroInvested || 0;
  const history = [];
  for (const n of [3, 4]) {
    if (n >= board.length) break;
    const lg = h.log[n];
    const c = streetContribution(lg, fs.villains);
    if (lg && LOG_TO_VILLAIN[lg.kind]) history.push({ street: n, villain: LOG_TO_VILLAIN[lg.kind], size: lg.amount && pot > 0 ? lg.amount / pot : 0.5 });
    pot += c.pot; heroInv += c.hero;
  }
  const heroIP = fs.heroIP ?? heroIsIP(h.heroPos, fs.villainPos, s.tableSize);
  const cur = h.cur.street === street ? h.cur : { facing: 'none', bet: 0, heroBet: 0 };
  const effStack = Math.max(0, s.stack - heroInv);
  base.postflop = {
    pot, effStack, villains: fs.villains || 1, villainPos: fs.villainPos, potType: fs.potType,
    heroAggressor: fs.heroAggressor, heroIP, facing: cur.facing, bet: cur.bet || 0, heroBet: cur.heroBet || 0,
    villainChecked: heroIP && cur.facing === 'none', history,
  };
  d.spot = base;
  d.pot = pot; d.effStack = effStack; d.heroIP = heroIP; d.cur = cur;
  return d;
}

/** Default assumption for how a street ended, based on the last recommendation on it. */
export function defaultLogFor(streetN, st = state) {
  const h = st.hand;
  const name = streetOf(streetN);
  const rec = h.recs[name];
  const cur = h.cur.street === name ? h.cur : { facing: 'none' };
  if (!rec) return { kind: cur.facing === 'bet' ? 'vb' : 'xx', amount: cur.bet || 0 };
  if (cur.facing === 'none') {
    if (rec.key === 'bet' || rec.key === 'allin' || rec.key === 'raise') return { kind: 'hb', amount: rec.sizeBB || 0 };
    return { kind: 'xx', amount: 0 };
  }
  if (rec.key === 'raise' || rec.key === 'allin') return { kind: 'vbr', amount: rec.sizeBB || cur.bet * 3 };
  return { kind: 'vb', amount: cur.bet || 0 };
}

export { positionsFor, playersBehind };
