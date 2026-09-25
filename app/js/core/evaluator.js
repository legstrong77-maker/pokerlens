// Fast 5–7 card hand evaluator using 13-bit rank masks.
// score = category << 20 | tiebreak (5 nibbles). Higher score = better hand.
import { rankOf, suitOf, RANK_NAMES } from './cards.js';

export const CAT = {
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
};
export const CAT_NAMES = ['高牌', '一對', '兩對', '三條', '順子', '同花', '葫蘆', '四條', '同花順'];
export const CAT_NAMES_EN = ['High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'];

export const POPCNT = new Uint8Array(8192);
export const STRAIGHT_HI = new Int8Array(8192);
const TOP5 = new Int32Array(8192);
for (let m = 0; m < 8192; m++) {
  let c = 0;
  for (let b = 0; b < 13; b++) if (m & (1 << b)) c++;
  POPCNT[m] = c;
  let st = -1;
  for (let top = 12; top >= 4; top--) {
    const w = 0x1f << (top - 4);
    if ((m & w) === w) { st = top; break; }
  }
  if (st < 0 && (m & 0x100f) === 0x100f) st = 3; // wheel A-2-3-4-5
  STRAIGHT_HI[m] = st;
  let packed = 0, n = 0;
  for (let b = 12; b >= 0 && n < 5; b--) {
    if (m & (1 << b)) { packed |= b << (4 * (4 - n)); n++; }
  }
  TOP5[m] = packed;
}

const hiBit = (m) => 31 - Math.clz32(m);

/** Evaluate n (5..7) cards from array `cards` starting at 0. */
export function evaluate(cards, n = cards.length) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  let m1 = 0, m2 = 0, m3 = 0, m4 = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const bit = 1 << (c >> 2);
    switch (c & 3) {
      case 0: s0 |= bit; break;
      case 1: s1 |= bit; break;
      case 2: s2 |= bit; break;
      default: s3 |= bit;
    }
    m4 |= m3 & bit; m3 |= m2 & bit; m2 |= m1 & bit; m1 |= bit;
  }
  return scoreFromMasks(s0, s1, s2, s3, m1, m2, m3, m4);
}

export function scoreFromMasks(s0, s1, s2, s3, m1, m2, m3, m4) {
  let fm = 0;
  if (POPCNT[s0] >= 5) fm = s0;
  else if (POPCNT[s1] >= 5) fm = s1;
  else if (POPCNT[s2] >= 5) fm = s2;
  else if (POPCNT[s3] >= 5) fm = s3;
  if (fm) {
    const sf = STRAIGHT_HI[fm];
    if (sf >= 0) return (8 << 20) | (sf << 16);
    return (5 << 20) | TOP5[fm];
  }
  if (m4) {
    const q = hiBit(m4);
    return (7 << 20) | (q << 16) | (hiBit(m1 & ~(1 << q)) << 12);
  }
  if (m3) {
    const t = hiBit(m3);
    const pairs = m2 & ~(1 << t);
    if (pairs) return (6 << 20) | (t << 16) | (hiBit(pairs) << 12);
  }
  const st = STRAIGHT_HI[m1];
  if (st >= 0) return (4 << 20) | (st << 16);
  if (m3) {
    const t = hiBit(m3);
    let k = m1 & ~(1 << t);
    const k1 = hiBit(k); k &= ~(1 << k1);
    const k2 = hiBit(k);
    return (3 << 20) | (t << 16) | (k1 << 12) | (k2 << 8);
  }
  if (m2) {
    const p1 = hiBit(m2);
    const rem = m2 & ~(1 << p1);
    if (rem) {
      const p2 = hiBit(rem);
      const k = hiBit(m1 & ~(1 << p1) & ~(1 << p2));
      return (2 << 20) | (p1 << 16) | (p2 << 12) | (k << 8);
    }
    let k = m1 & ~(1 << p1);
    const k1 = hiBit(k); k &= ~(1 << k1);
    const k2 = hiBit(k); k &= ~(1 << k2);
    const k3 = hiBit(k);
    return (1 << 20) | (p1 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4);
  }
  return TOP5[m1];
}

/**
 * Incremental helper: precompute masks for a fixed set of cards (e.g. board),
 * then evaluate adding 2 more cards quickly.
 */
export function masksOf(cards, n = cards.length) {
  const s = [0, 0, 0, 0];
  let m1 = 0, m2 = 0, m3 = 0, m4 = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const bit = 1 << (c >> 2);
    s[c & 3] |= bit;
    m4 |= m3 & bit; m3 |= m2 & bit; m2 |= m1 & bit; m1 |= bit;
  }
  return { s0: s[0], s1: s[1], s2: s[2], s3: s[3], m1, m2, m3, m4 };
}

/** Evaluate base masks + extra cards (up to 4). Allocation free. */
export function evalWith(base, a, b = -1, c = -1, d = -1) {
  let s0 = base.s0, s1 = base.s1, s2 = base.s2, s3 = base.s3;
  let m1 = base.m1, m2 = base.m2, m3 = base.m3, m4 = base.m4;
  let bit;
  // card a
  bit = 1 << (a >> 2);
  switch (a & 3) { case 0: s0 |= bit; break; case 1: s1 |= bit; break; case 2: s2 |= bit; break; default: s3 |= bit; }
  m4 |= m3 & bit; m3 |= m2 & bit; m2 |= m1 & bit; m1 |= bit;
  if (b >= 0) {
    bit = 1 << (b >> 2);
    switch (b & 3) { case 0: s0 |= bit; break; case 1: s1 |= bit; break; case 2: s2 |= bit; break; default: s3 |= bit; }
    m4 |= m3 & bit; m3 |= m2 & bit; m2 |= m1 & bit; m1 |= bit;
  }
  if (c >= 0) {
    bit = 1 << (c >> 2);
    switch (c & 3) { case 0: s0 |= bit; break; case 1: s1 |= bit; break; case 2: s2 |= bit; break; default: s3 |= bit; }
    m4 |= m3 & bit; m3 |= m2 & bit; m2 |= m1 & bit; m1 |= bit;
  }
  if (d >= 0) {
    bit = 1 << (d >> 2);
    switch (d & 3) { case 0: s0 |= bit; break; case 1: s1 |= bit; break; case 2: s2 |= bit; break; default: s3 |= bit; }
    m4 |= m3 & bit; m3 |= m2 & bit; m2 |= m1 & bit; m1 |= bit;
  }
  return scoreFromMasks(s0, s1, s2, s3, m1, m2, m3, m4);
}

export const categoryOf = (score) => score >> 20;

const nib = (score, i) => (score >> (16 - 4 * i)) & 15;

/** Human-readable (zh-TW) description of a score, e.g. "兩對 K 與 7". */
export function describeScore(score) {
  const cat = score >> 20;
  const R = (r) => RANK_NAMES[r];
  switch (cat) {
    case 8: return nib(score, 0) === 12 ? '皇家同花順' : `同花順 (${R(nib(score, 0))} 高)`;
    case 7: return `四條 ${R(nib(score, 0))}`;
    case 6: return `葫蘆 ${R(nib(score, 0))} 帶 ${R(nib(score, 1))}`;
    case 5: return `同花 (${R(nib(score, 0))} 高)`;
    case 4: return `順子 (${R(nib(score, 0))} 高)`;
    case 3: return `三條 ${R(nib(score, 0))}`;
    case 2: return `兩對 ${R(nib(score, 0))} 與 ${R(nib(score, 1))}`;
    case 1: return `一對 ${R(nib(score, 0))}`;
    default: return `高牌 ${R(nib(score, 0))}`;
  }
}

// Reference (slow) evaluator for tests: best of all 5-card subsets.
export function evaluateSlow(cards) {
  const n = cards.length;
  let best = -1;
  const pick = [0, 0, 0, 0, 0];
  const rec = (start, depth) => {
    if (depth === 5) {
      const five = pick.map((i) => cards[i]);
      const v = eval5Reference(five);
      if (v > best) best = v;
      return;
    }
    for (let i = start; i < n; i++) { pick[depth] = i; rec(i + 1, depth + 1); }
  };
  rec(0, 0);
  return best;
}

function eval5Reference(five) {
  const ranks = five.map(rankOf).sort((a, b) => b - a);
  const suits = five.map(suitOf);
  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straightHi = -1;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHi = ranks[0];
    else if (ranks[0] === 12 && ranks[1] === 3 && ranks[4] === 0) straightHi = 3;
  }
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts).map(([r, c]) => [+r, c])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const pack = (cat, rs) => {
    let v = cat << 20;
    rs.forEach((r, i) => { v |= r << (16 - 4 * i); });
    return v;
  };
  if (flush && straightHi >= 0) return pack(8, [straightHi]);
  if (groups[0][1] === 4) return pack(7, [groups[0][0], groups[1][0]]);
  if (groups[0][1] === 3 && groups[1][1] === 2) return pack(6, [groups[0][0], groups[1][0]]);
  if (flush) return pack(5, ranks);
  if (straightHi >= 0) return pack(4, [straightHi]);
  if (groups[0][1] === 3) return pack(3, [groups[0][0], groups[1][0], groups[2][0]]);
  if (groups[0][1] === 2 && groups[1][1] === 2) return pack(2, [groups[0][0], groups[1][0], groups[2][0]]);
  if (groups[0][1] === 2) return pack(1, [groups[0][0], groups[1][0], groups[2][0], groups[3][0]]);
  return pack(0, ranks);
}
