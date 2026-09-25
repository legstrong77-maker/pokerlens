// Per-player action tracker: a replayable action log -> table state -> engine spot.
// Pure logic (no DOM) so it can be unit-tested in Node.
import { positionsFor, postflopOrder } from '../core/charts.js';

export const STREET_ZH = ['翻前', '翻牌', '轉牌', '河牌'];
const BET_KINDS = ['bet', 'raise', 'allin'];
const r1 = (x) => Math.round(x * 100) / 100;

/** New tracker. Everything else is derived by replaying `actions`. */
export function newTrack({ size, heroPos, stack = 100, ante = 0 }) {
  return { size, heroPos, stack, ante, actions: [] };
}

function orderFor(size, street) {
  const list = positionsFor(size).slice();
  if (street === 0) return list; // UTG ... SB, BB (heads-up: BTN/SB first)
  return list.sort((a, b) => postflopOrder(a, size) - postflopOrder(b, size));
}

function initial(track) {
  const { size, ante } = track;
  const seats = positionsFor(size).map((pos) => ({ pos, inHand: true, allIn: false, total: 0, street: 0, acted: false }));
  const t = {
    size, seats, street: 0, currentBet: 1, lastAggressor: null, pot: ante * size,
    preflopRaises: [], preflopAggressor: null, streetStartPot: [ante * size], streetActs: [[], [], [], []],
    done: false, winner: null, order: orderFor(size, 0), toAct: null,
  };
  const post = (pos, amt) => { const s = seat(t, pos); s.street += amt; s.total += amt; t.pot += amt; };
  post(size === 2 ? 'BTN' : 'SB', 0.5);
  post('BB', 1);
  t.streetStartPot[0] = t.pot; // blinds + antes
  t.toAct = nextFrom(t, t.order.indexOf('BB') + 1);
  return t;
}
const seat = (t, pos) => t.seats.find((x) => x.pos === pos);

/** First seat at or after order index `idx` that still has to act; null = round closed. */
function nextFrom(t, idx) {
  const n = t.order.length;
  for (let k = 0; k < n; k++) {
    const s = seat(t, t.order[(idx + k) % n]);
    if (!s.inHand || s.allIn) continue;
    if (!s.acted || s.street < t.currentBet - 1e-9) return s.pos;
  }
  return null;
}

function applyAction(t, a, stack) {
  if (a.kind === 'street') {
    if (t.street >= 3 || t.done) return;
    t.street++;
    t.streetStartPot[t.street] = t.pot;
    for (const s of t.seats) { s.street = 0; s.acted = false; }
    t.currentBet = 0; t.lastAggressor = null;
    t.order = orderFor(t.size, t.street);
    t.toAct = nextFrom(t, 0);
    return;
  }
  const s = seat(t, a.pos);
  if (!s || !s.inHand || s.allIn || t.done) return;
  const remaining = stack - s.total;
  let kind = a.kind;
  if (kind === 'fold') { s.inHand = false; s.acted = true; }
  else if (kind === 'check') s.acted = true;
  else if (kind === 'call') {
    const add = Math.max(0, Math.min(t.currentBet - s.street, remaining));
    s.street += add; s.total += add; t.pot += add; s.acted = true;
    if (add >= remaining - 1e-9) s.allIn = true;
  } else if (BET_KINDS.includes(kind) && kind !== 'allin' && !(a.to > t.currentBet + 1e-9)) {
    // a "raise" that doesn't exceed the current bet is just a call
    const add = Math.max(0, Math.min(t.currentBet - s.street, remaining));
    s.street += add; s.total += add; t.pot += add; s.acted = true; kind = 'call';
    if (add >= remaining - 1e-9) s.allIn = true;
  } else if (BET_KINDS.includes(kind)) {
    const to = Math.min(kind === 'allin' ? s.street + remaining : a.to, s.street + remaining);
    const add = Math.max(0, to - s.street);
    if (to > t.currentBet + 1e-9) {
      const wasOpen = t.street > 0 && t.currentBet <= 0;
      t.currentBet = to;
      t.lastAggressor = s.pos;
      for (const o of t.seats) if (o !== s) o.acted = false;
      if (t.street === 0) { t.preflopRaises.push({ pos: s.pos, to }); t.preflopAggressor = s.pos; }
      if (kind !== 'allin') kind = wasOpen ? 'bet' : 'raise';
    }
    s.street = to; s.total += add; t.pot += add; s.acted = true;
    if (add >= remaining - 1e-9) s.allIn = true;
  } else return;
  t.streetActs[t.street].push({ pos: s.pos, kind, to: r1(s.street) });
  const live = t.seats.filter((x) => x.inHand);
  if (live.length === 1) { t.done = true; t.winner = live[0].pos; t.toAct = null; return; }
  t.toAct = nextFrom(t, t.order.indexOf(s.pos) + 1);
}

/** Full table state after replaying the log. */
export function state(track) {
  const t = initial(track);
  for (const a of track.actions) applyAction(t, a, track.stack);
  t.heroPos = track.heroPos;
  t.hero = seat(t, track.heroPos);
  return t;
}

/** Legal actions + suggested sizes (to-amounts in BB) for the seat to act. */
export function options(track) {
  const t = state(track);
  if (!t.toAct) return null;
  const s = seat(t, t.toAct);
  const remaining = track.stack - s.total;
  const owe = r1(Math.max(0, t.currentBet - s.street));
  let sizes;
  if (t.street === 0) {
    const limpers = t.streetActs[0].filter((x) => x.kind === 'call').length;
    if (t.currentBet <= 1) sizes = [2, 2.5, 3, 4].map((x) => x + limpers);
    else {
      const R = t.currentBet;
      const callers = t.streetActs[0].filter((x) => x.kind === 'call' && x.to >= R - 1e-9).length;
      sizes = [3, 3.5, 4].map((m) => R * m + callers * R);
    }
  } else if (t.currentBet <= 0) sizes = [0.33, 0.5, 0.66, 0.75, 1].map((f) => t.pot * f);
  else sizes = [2.5, 3, 4].map((m) => t.currentBet * m);
  const cap = s.street + remaining;
  return {
    pos: s.pos, isHero: s.pos === track.heroPos, owe, canCheck: owe <= 0, street: t.street, pot: r1(t.pot),
    sizes: [...new Set(sizes.map((x) => Math.round(x * 2) / 2).filter((x) => x > t.currentBet && x < cap))].slice(0, 5),
    allIn: r1(cap), betWord: t.street > 0 && t.currentBet <= 0 ? '下注' : '加注',
  };
}

export function act(track, kind, to) {
  const t = state(track);
  if (t.toAct) track.actions.push({ pos: t.toAct, kind, to });
  return track;
}
export function undo(track) {
  while (track.actions.length && track.actions[track.actions.length - 1].kind === 'street') track.actions.pop();
  track.actions.pop();
  return track;
}
/** Everyone before the hero on this street folds (or checks when free). */
export function foldToHero(track) {
  for (let guard = 0; guard < 12; guard++) {
    const t = state(track);
    if (!t.toAct || t.toAct === track.heroPos) break;
    const s = seat(t, t.toAct);
    track.actions.push({ pos: t.toAct, kind: s.street >= t.currentBet - 1e-9 ? 'check' : 'fold' });
  }
  return track;
}
/** Close the betting round (still-owing players fold, the hero calls, others check) and deal the next street. */
export function nextStreet(track) {
  for (let guard = 0; guard < 20; guard++) {
    const t = state(track);
    if (!t.toAct || t.done) break;
    const s = seat(t, t.toAct);
    const owes = s.street < t.currentBet - 1e-9;
    track.actions.push({ pos: s.pos, kind: owes ? (s.pos === track.heroPos ? 'call' : 'fold') : 'check' });
  }
  const t = state(track);
  if (!t.done && t.street < 3) track.actions.push({ kind: 'street' });
  return track;
}

/**
 * Engine spot fragment for the hero's decision.
 * Returns { preflop } or { postflop }, plus meta { street, pot, toCall, villains, heroToAct, done, winner }.
 */
export function trackerSpot(track) {
  const t = state(track);
  const H = track.heroPos, hero = t.hero;
  const others = t.seats.filter((s) => s.inHand && s.pos !== H);
  const meta = {
    street: t.street, pot: r1(t.pot), toAct: t.toAct, heroToAct: t.toAct === H, done: t.done, winner: t.winner,
    toCall: r1(Math.max(0, t.currentBet - hero.street)), villains: others.length,
  };
  if (t.street === 0) {
    const vol = t.streetActs[0];
    const raises = t.preflopRaises;
    let pre;
    if (!raises.length) {
      const limpers = vol.filter((x) => x.kind === 'call' && x.pos !== H).length;
      pre = limpers ? { scenario: 'limped', limpers } : { scenario: 'unopened' };
    } else if (raises.length === 1) {
      const op = raises[0];
      const callers = vol.filter((x) => x.kind === 'call' && x.pos !== H && x.to >= op.to - 1e-9).map((x) => x.pos);
      pre = { scenario: 'vsOpen', openerPos: op.pos, openSize: op.to, callers: callers.length, callerPositions: callers };
    } else if (raises.length === 2) {
      const [first, last] = raises;
      pre = { scenario: 'vs3bet', openerPos: last.pos, heroOpen: first.pos === H ? first.to : Math.max(hero.street, 1), openSize: last.to, threeBet: last.to };
    } else {
      const last = raises[raises.length - 1], prev = raises[raises.length - 2];
      pre = raises.length >= 4
        ? { scenario: 'vs5bet', openerPos: last.pos, heroOpen: prev.to, openSize: last.to }
        : { scenario: 'vs4bet', openerPos: last.pos, heroOpen: prev.to, openSize: last.to, threeBet: prev.to, fourBet: last.to };
    }
    return { preflop: pre, meta };
  }
  const nR = t.preflopRaises.length;
  const potType = nR === 0 ? 'limped' : nR === 1 ? 'srp' : nR === 2 ? '3bet' : '4bet';
  const heroIP = others.every((o) => postflopOrder(H, track.size) > postflopOrder(o.pos, track.size));
  const facing = t.currentBet > hero.street + 1e-9;
  let villainPos;
  if (facing && t.lastAggressor) villainPos = t.lastAggressor;
  else if (t.preflopAggressor && t.preflopAggressor !== H && others.some((o) => o.pos === t.preflopAggressor)) villainPos = t.preflopAggressor;
  else villainPos = others[0]?.pos || 'BB';
  const history = [];
  for (let st = 1; st < t.street; st++) {
    const mine = t.streetActs[st].filter((x) => x.pos === villainPos);
    if (!mine.length) continue;
    const last = mine[mine.length - 1];
    if (last.kind === 'fold') continue;
    const kind = last.kind === 'allin' ? 'raise' : last.kind;
    history.push({ street: st + 2, villain: kind, size: kind === 'check' ? 0.5 : Math.max(0.1, last.to / (t.streetStartPot[st] || 1)) });
  }
  const potStart = t.streetStartPot[t.street] ?? t.pot;
  const postflop = {
    pot: r1(potStart), effStack: r1(Math.max(0, track.stack - hero.total + hero.street)), villains: Math.max(1, others.length),
    villainPos, potType, heroAggressor: t.preflopAggressor === H, heroIP,
    facing: facing ? (hero.street > 0 ? 'raise' : 'bet') : 'none',
    bet: facing ? r1(t.currentBet) : 0, heroBet: r1(hero.street),
    callersInFront: facing ? t.streetActs[t.street].filter((x) => x.kind === 'call' && x.pos !== H && x.to >= t.currentBet - 1e-9).length : 0,
    villainChecked: !facing && t.streetActs[t.street].some((x) => x.pos === villainPos && x.kind === 'check'),
    history,
  };
  return { postflop, meta };
}

const ZH = { fold: '棄牌', check: '過牌', call: '跟注', bet: '下注', raise: '加注到', allin: '全下' };
/** Human-readable action log (for the AI analyst and the clipboard). */
export function describeTrack(track) {
  const t = state(track);
  const lines = [];
  for (let st = 0; st <= t.street; st++) {
    const acts = t.streetActs[st];
    if (!acts.length) continue;
    lines.push(`${STREET_ZH[st]}（底池 ${r1(t.streetStartPot[st] ?? 0)}）：` + acts.map((a) => `${a.pos}${a.pos === track.heroPos ? '(我)' : ''} ${ZH[a.kind] || a.kind}${a.kind !== 'fold' && a.kind !== 'check' ? ' ' + a.to : ''}`).join('，'));
  }
  return lines.join('\n') || '（尚無動作）';
}
