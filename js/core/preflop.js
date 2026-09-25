// Preflop equity helpers backed by the precomputed 169x169 matrix.
import { MATRIX_B64, VS_RANDOM_B64, VS_RANDOM_MAX } from '../data/preflop-data.js';
import {
  NUM_CLASSES, CLASS_COMBOS, CLASS_COMBO_COUNT, COMBO_A, COMBO_B, classOfCards, className, classType,
} from './cards.js';

function decodeU16(b64) {
  let bin;
  if (typeof atob === 'function') bin = atob(b64);
  else bin = Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const u16 = new Uint16Array(bytes.buffer);
  const f = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) f[i] = u16[i] / 65535;
  return f;
}

export const MATRIX = decodeU16(MATRIX_B64); // MATRIX[h*169+v] = equity of class h vs class v
export const VS_RANDOM = decodeU16(VS_RANDOM_B64); // [cls*8 + (n-1)]

export const eqVsRandom = (cls, nOpp = 1) =>
  VS_RANDOM[cls * VS_RANDOM_MAX + Math.min(VS_RANDOM_MAX, Math.max(1, nOpp)) - 1];

/** Number of combos of class v still available given specific hero cards. */
export function availableCombos(v, deadA, deadB) {
  let n = 0;
  for (const k of CLASS_COMBOS[v]) {
    const a = COMBO_A[k], b = COMBO_B[k];
    if (a === deadA || a === deadB || b === deadA || b === deadB) continue;
    n++;
  }
  return n;
}

/**
 * Equity of a hero hand (specific cards, or class) vs a villain class-weight range.
 * Card removal is applied to the villain combo counts.
 */
export function equityVsRange(hero, rangeW) {
  let cls, a = -1, b = -1;
  if (Array.isArray(hero)) { [a, b] = hero; cls = classOfCards(a, b); } else cls = hero;
  let num = 0, den = 0;
  for (let v = 0; v < NUM_CLASSES; v++) {
    const w = rangeW[v];
    if (w <= 0) continue;
    const n = a >= 0 ? availableCombos(v, a, b) : CLASS_COMBO_COUNT[v];
    if (!n) continue;
    num += w * n * MATRIX[cls * NUM_CLASSES + v];
    den += w * n;
  }
  return den > 0 ? num / den : 0.5;
}

/** Equity of every class vs a range -> Float32Array(169). */
export function allEquitiesVsRange(rangeW) {
  const out = new Float32Array(NUM_CLASSES);
  for (let h = 0; h < NUM_CLASSES; h++) {
    let num = 0, den = 0;
    for (let v = 0; v < NUM_CLASSES; v++) {
      const w = rangeW[v];
      if (w <= 0) continue;
      const n = CLASS_COMBO_COUNT[v];
      num += w * n * MATRIX[h * NUM_CLASSES + v];
      den += w * n;
    }
    out[h] = den > 0 ? num / den : 0.5;
  }
  return out;
}

/**
 * Preflop hand ordering blending heads-up strength with multiway playability.
 * Used for "top X%" ranges (e.g. opponent calling ranges, push/fold).
 */
function buildOrder() {
  const score = new Float32Array(NUM_CLASSES);
  for (let c = 0; c < NUM_CLASSES; c++) {
    const row = Math.floor(c / 13), col = c % 13, t = classType(c);
    const gap = Math.abs(row - col) - 1;
    let bonus = 0;
    if (t === 'suited') bonus += 0.012;
    if (t === 'pair') bonus += 0.004;
    else if (gap === 0) bonus += 0.012;
    else if (gap === 1) bonus += 0.007;
    else if (gap === 2) bonus += 0.003;
    score[c] = 0.5 * eqVsRandom(c, 1) + 0.5 * eqVsRandom(c, 3) * 2.2 + bonus;
  }
  const order = Array.from({ length: NUM_CLASSES }, (_, i) => i).sort((x, y) => score[y] - score[x]);
  return { order, score };
}
export const { order: PREFLOP_ORDER, score: PREFLOP_SCORE } = buildOrder();

/** Heads-up all-in ordering (pure equity vs random) for push/fold. */
export const ALLIN_ORDER = Array.from({ length: NUM_CLASSES }, (_, i) => i)
  .sort((x, y) => eqVsRandom(y, 1) - eqVsRandom(x, 1));

/** Percentile (0 = best) of a class in PREFLOP_ORDER by combos. */
export const CLASS_PERCENTILE = (() => {
  const p = new Float32Array(NUM_CLASSES);
  let cum = 0;
  for (const c of PREFLOP_ORDER) {
    p[c] = (cum + CLASS_COMBO_COUNT[c] / 2) / 1326;
    cum += CLASS_COMBO_COUNT[c];
  }
  return p;
})();

export function describeClass(cls) {
  const t = classType(cls);
  return { name: className(cls), type: t };
}

// ---------- Heads-up push/fold Nash solver (SB shove vs BB call) ----------
/**
 * Solve SB push / BB call equilibrium for effective stack S (in BB, including blinds),
 * with optional per-player ante. Returns push & call frequencies per class.
 */
export function solvePushFold(S, ante = 0, iters = 250) {
  const push = new Float32Array(NUM_CLASSES).fill(0.5);
  const call = new Float32Array(NUM_CLASSES).fill(0.5);
  // S = total stack in BB (blinds and ante come out of it). Net results measured
  // relative to the start of the hand.
  const pairW = pairWeights();
  for (let it = 0; it < iters; it++) {
    const lr = 1 / (it + 2);
    // BB best response to the SB push range
    for (let v = 0; v < NUM_CLASSES; v++) {
      let num = 0, den = 0;
      for (let h = 0; h < NUM_CLASSES; h++) {
        const w = push[h] * pairW[v * NUM_CLASSES + h];
        if (w <= 0) continue;
        num += w * MATRIX[v * NUM_CLASSES + h]; den += w;
      }
      const eq = den > 0 ? num / den : 0;
      const evCall = eq * 2 * S - S;
      const evFold = -1 - ante;
      call[v] += lr * ((evCall > evFold ? 1 : 0) - call[v]);
    }
    // SB best response to the BB call range
    for (let h = 0; h < NUM_CLASSES; h++) {
      let num = 0, den = 0, tot = 0;
      for (let v = 0; v < NUM_CLASSES; v++) {
        const pw = pairW[h * NUM_CLASSES + v];
        tot += pw;
        const w = call[v] * pw;
        if (w <= 0) continue;
        num += w * MATRIX[h * NUM_CLASSES + v]; den += w;
      }
      const pCall = tot > 0 ? den / tot : 0;
      const eq = den > 0 ? num / den : 0;
      const evPush = (1 - pCall) * (1 + ante) + pCall * (eq * 2 * S - S);
      const evFold = -0.5 - ante;
      push[h] += lr * ((evPush > evFold ? 1 : 0) - push[h]);
    }
  }
  return { push, call };
}

let _pairW = null;
function pairWeights() {
  if (_pairW) return _pairW;
  const pw = new Float32Array(NUM_CLASSES * NUM_CLASSES);
  for (let h = 0; h < NUM_CLASSES; h++) {
    const hc = CLASS_COMBOS[h];
    for (let v = 0; v < NUM_CLASSES; v++) {
      let n = 0;
      for (const a of hc) {
        const a1 = COMBO_A[a], a2 = COMBO_B[a];
        for (const b of CLASS_COMBOS[v]) {
          const b1 = COMBO_A[b], b2 = COMBO_B[b];
          if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
          n++;
        }
      }
      pw[h * NUM_CLASSES + v] = n / hc.length; // avg villain combos per hero combo
    }
  }
  _pairW = pw;
  return pw;
}
