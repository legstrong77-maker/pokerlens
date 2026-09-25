// Range utilities: parse "22+, A2s+, KTs-K7s, AKo:0.5" into 169 class weights,
// expand to 1326 combo weights, compress back to text, etc.
import {
  RANK_CHARS, NUM_CLASSES, NUM_COMBOS, CLASS_COMBO_COUNT, CLASS_COMBOS, COMBO_A, COMBO_B,
  COMBO_CLASS, className,
} from './cards.js';

const R = (ch) => RANK_CHARS.indexOf(ch === '1' ? 'T' : ch.toUpperCase());
const idx = (hiRank, loRank, type) => {
  const i = 12 - hiRank, j = 12 - loRank;
  if (type === 'p') return i * 13 + i;
  if (type === 's') return i * 13 + j;
  return j * 13 + i;
};

function setW(w, cls, val) { w[cls] = Math.max(w[cls], val); }

/** Parse a range string into Float32Array(169) weights in [0,1]. */
export function parseRange(str) {
  const w = new Float32Array(NUM_CLASSES);
  if (!str) return w;
  const s = str.trim().toLowerCase();
  if (s === 'any' || s === 'random' || s === '100%' || s === '*') { w.fill(1); return w; }
  const tokens = str.replace(/10/g, 'T').split(/[\s,;]+/).filter(Boolean);
  for (let tok of tokens) {
    let weight = 1;
    const colon = tok.indexOf(':');
    if (colon >= 0) { weight = parseFloat(tok.slice(colon + 1)); tok = tok.slice(0, colon); if (!(weight >= 0)) weight = 1; weight = Math.min(1, weight); }
    const up = tok.toUpperCase();
    const plus = up.endsWith('+');
    const body = plus ? up.slice(0, -1) : up;
    const dash = body.split('-');
    const parseOne = (t) => {
      const a = R(t[0]), b = R(t[1]);
      if (a < 0 || b < 0) return null;
      const suf = (t[2] || '').toLowerCase();
      return { hi: Math.max(a, b), lo: Math.min(a, b), suf };
    };
    if (dash.length === 2) {
      const x = parseOne(dash[0]), y = parseOne(dash[1]);
      if (!x || !y) continue;
      if (x.hi === x.lo && y.hi === y.lo) { // TT-77
        const lo = Math.min(x.hi, y.hi), hi = Math.max(x.hi, y.hi);
        for (let r = lo; r <= hi; r++) setW(w, idx(r, r, 'p'), weight);
      } else if (x.hi === y.hi) { // KTs-K7s
        const lo = Math.min(x.lo, y.lo), hi = Math.max(x.lo, y.lo);
        const types = x.suf ? [x.suf] : ['s', 'o'];
        for (let r = lo; r <= hi; r++) for (const t of types) setW(w, idx(x.hi, r, t), weight);
      }
      continue;
    }
    const h = parseOne(body);
    if (!h) continue;
    if (h.hi === h.lo) { // pair
      if (plus) for (let r = h.hi; r <= 12; r++) setW(w, idx(r, r, 'p'), weight);
      else setW(w, idx(h.hi, h.hi, 'p'), weight);
      continue;
    }
    const types = h.suf === 's' || h.suf === 'o' ? [h.suf] : ['s', 'o'];
    if (plus) { for (let r = h.lo; r < h.hi; r++) for (const t of types) setW(w, idx(h.hi, r, t), weight); }
    else for (const t of types) setW(w, idx(h.hi, h.lo, t), weight);
  }
  return w;
}

export function emptyRange() { return new Float32Array(NUM_CLASSES); }
export function fullRange() { return new Float32Array(NUM_CLASSES).fill(1); }

/** Fraction (0..1) of all 1326 combos covered by the range. */
export function rangeWidth(w) {
  let s = 0;
  for (let c = 0; c < NUM_CLASSES; c++) s += w[c] * CLASS_COMBO_COUNT[c];
  return s / NUM_COMBOS;
}

export function addRanges(...rs) {
  const out = new Float32Array(NUM_CLASSES);
  for (const r of rs) for (let c = 0; c < NUM_CLASSES; c++) out[c] = Math.min(1, out[c] + r[c]);
  return out;
}

export function subtractRange(a, b) {
  const out = new Float32Array(NUM_CLASSES);
  for (let c = 0; c < NUM_CLASSES; c++) out[c] = Math.max(0, a[c] - b[c]);
  return out;
}

export function scaleRange(a, k) {
  const out = new Float32Array(NUM_CLASSES);
  for (let c = 0; c < NUM_CLASSES; c++) out[c] = Math.min(1, a[c] * k);
  return out;
}

/** Expand class weights to combo weights, zeroing combos that use dead cards. */
export function toCombos(w, dead = []) {
  const deadMask = new Uint8Array(52);
  for (const d of dead) if (d >= 0) deadMask[d] = 1;
  const cw = new Float32Array(NUM_COMBOS);
  for (let k = 0; k < NUM_COMBOS; k++) {
    if (deadMask[COMBO_A[k]] || deadMask[COMBO_B[k]]) continue;
    cw[k] = w[COMBO_CLASS[k]];
  }
  return cw;
}

/** Collapse combo weights back to class weights (average over live combos). */
export function combosToClasses(cw) {
  const w = new Float32Array(NUM_CLASSES);
  for (let c = 0; c < NUM_CLASSES; c++) {
    let s = 0, n = 0;
    for (const k of CLASS_COMBOS[c]) { s += cw[k]; n++; }
    w[c] = n ? s / n : 0;
  }
  return w;
}

export function comboWeightSum(cw) {
  let s = 0;
  for (let k = 0; k < cw.length; k++) s += cw[k];
  return s;
}

/** Build a range containing the top `pct` (0..1) of combos following `order` (array of classes). */
export function topRange(pct, order) {
  const w = new Float32Array(NUM_CLASSES);
  let need = pct * NUM_COMBOS;
  for (const c of order) {
    if (need <= 0) break;
    const n = CLASS_COMBO_COUNT[c];
    const take = Math.min(1, need / n);
    w[c] = take;
    need -= take * n;
  }
  return w;
}

/** Compress class weights into a readable range string. */
export function rangeToString(w, eps = 0.02) {
  const parts = [];
  const fmt = (name, v) => (v >= 1 - eps ? name : `${name}:${(Math.round(v * 100) / 100)}`);
  // pairs
  let r = 12;
  while (r >= 0) {
    const v = w[idx(r, r, 'p')];
    if (v <= eps) { r--; continue; }
    let lo = r;
    while (lo - 1 >= 0 && Math.abs(w[idx(lo - 1, lo - 1, 'p')] - v) < eps) lo--;
    const hiN = RANK_CHARS[r] + RANK_CHARS[r], loN = RANK_CHARS[lo] + RANK_CHARS[lo];
    if (r === 12 && lo !== r) parts.push(fmt(loN + '+', v));
    else if (lo === r) parts.push(fmt(hiN, v));
    else parts.push(fmt(`${hiN}-${loN}`, v));
    r = lo - 1;
  }
  for (const t of ['s', 'o']) {
    for (let hi = 12; hi >= 1; hi--) {
      let lo = hi - 1;
      while (lo >= 0) {
        const v = w[idx(hi, lo, t)];
        if (v <= eps) { lo--; continue; }
        let end = lo;
        while (end - 1 >= 0 && Math.abs(w[idx(hi, end - 1, t)] - v) < eps) end--;
        const top = RANK_CHARS[hi] + RANK_CHARS[lo] + t, bot = RANK_CHARS[hi] + RANK_CHARS[end] + t;
        if (lo === hi - 1 && end !== lo) parts.push(fmt(bot + '+', v));
        else if (end === lo) parts.push(fmt(top, v));
        else parts.push(fmt(`${top}-${bot}`, v));
        lo = end - 1;
      }
    }
  }
  return parts.join(', ');
}

export function classesIn(w, eps = 0.001) {
  const out = [];
  for (let c = 0; c < NUM_CLASSES; c++) if (w[c] > eps) out.push(className(c));
  return out;
}
