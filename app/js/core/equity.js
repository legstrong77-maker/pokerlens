// Equity engine: exact enumeration (heads-up postflop) or Monte Carlo (preflop / multiway).
import { COMBO_A, COMBO_B, NUM_COMBOS, makeRng } from './cards.js';
import { masksOf, evalWith, evaluate } from './evaluator.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Zero out combos that use dead cards; null range => uniform. */
export function liveComboWeights(range, dead) {
  const deadMask = new Uint8Array(52);
  for (const d of dead) deadMask[d] = 1;
  const cw = new Float32Array(NUM_COMBOS);
  for (let k = 0; k < NUM_COMBOS; k++) {
    if (deadMask[COMBO_A[k]] || deadMask[COMBO_B[k]]) continue;
    cw[k] = range ? range[k] : 1;
  }
  return cw;
}

/**
 * @param {object} o
 * @param {number[]} o.hero  two hole cards
 * @param {number[]} o.board 0..5 board cards
 * @param {(Float32Array|null)[]} o.villains combo weights per villain (null = random hand)
 * @returns {{equity:number, win:number, tie:number, lose:number, iterations:number, exact:boolean,
 *            heroCats:Float64Array, perCombo?:Float32Array, comboWeights?:Float32Array}}
 */
export function computeEquity(o) {
  const hero = o.hero, board = o.board || [];
  const villains = o.villains && o.villains.length ? o.villains : [null];
  if (villains.length === 1 && board.length >= 3) return exactHeadsUp(hero, board, villains[0]);
  return monteCarlo(hero, board, villains, o.maxIters ?? 150000, o.maxMs ?? 300, o.seed);
}

function exactHeadsUp(hero, board, range) {
  const dead = [...hero, ...board];
  const cw = liveComboWeights(range, dead);
  const deadMask = new Uint8Array(52);
  for (const d of dead) deadMask[d] = 1;
  const unseen = [];
  for (let c = 0; c < 52; c++) if (!deadMask[c]) unseen.push(c);
  const boardM = masksOf(board);
  const heroM = masksOf(dead);
  const perCombo = new Float32Array(NUM_COMBOS);
  const heroCats = new Float64Array(9);
  let wSum = 0, win = 0, tie = 0, lose = 0;
  const nb = board.length;
  const nU = unseen.length;

  if (nb === 5) {
    const hs = evaluate(dead, 7);
    heroCats[hs >> 20] = 1;
    for (let k = 0; k < NUM_COMBOS; k++) {
      const w = cw[k];
      if (w <= 0) continue;
      const vs = evalWith(boardM, COMBO_A[k], COMBO_B[k]);
      const e = hs > vs ? 1 : hs === vs ? 0.5 : 0;
      perCombo[k] = e;
      wSum += w;
      if (e === 1) win += w; else if (e === 0.5) tie += w; else lose += w;
    }
  } else if (nb === 4) {
    const heroByRiver = new Int32Array(52);
    for (const r of unseen) { heroByRiver[r] = evalWith(heroM, r); heroCats[heroByRiver[r] >> 20] += 1 / nU; }
    for (let k = 0; k < NUM_COMBOS; k++) {
      const w = cw[k];
      if (w <= 0) continue;
      const a = COMBO_A[k], b = COMBO_B[k];
      let wn = 0, tn = 0, n = 0;
      for (let i = 0; i < nU; i++) {
        const r = unseen[i];
        if (r === a || r === b) continue;
        const hs = heroByRiver[r], vs = evalWith(boardM, a, b, r);
        if (hs > vs) wn++; else if (hs === vs) tn++;
        n++;
      }
      const e = (wn + tn / 2) / n;
      perCombo[k] = e;
      wSum += w; win += w * wn / n; tie += w * tn / n; lose += w * (n - wn - tn) / n;
    }
  } else { // flop: enumerate turn+river
    const heroTR = new Int32Array(52 * 52);
    let runs = 0;
    for (let i = 0; i < nU; i++) for (let j = i + 1; j < nU; j++) {
      const t = unseen[i], r = unseen[j];
      const s = evalWith(heroM, t, r);
      heroTR[t * 52 + r] = s;
      heroCats[s >> 20]++; runs++;
    }
    for (let c = 0; c < 9; c++) heroCats[c] /= runs;
    for (let k = 0; k < NUM_COMBOS; k++) {
      const w = cw[k];
      if (w <= 0) continue;
      const a = COMBO_A[k], b = COMBO_B[k];
      let wn = 0, tn = 0, n = 0;
      for (let i = 0; i < nU; i++) {
        const t = unseen[i];
        if (t === a || t === b) continue;
        const rowBase = t * 52;
        for (let j = i + 1; j < nU; j++) {
          const r = unseen[j];
          if (r === a || r === b) continue;
          const hs = heroTR[rowBase + r], vs = evalWith(boardM, a, b, t, r);
          if (hs > vs) wn++; else if (hs === vs) tn++;
          n++;
        }
      }
      const e = (wn + tn / 2) / n;
      perCombo[k] = e;
      wSum += w; win += w * wn / n; tie += w * tn / n; lose += w * (n - wn - tn) / n;
    }
  }
  if (wSum <= 0) return { equity: 0, win: 0, tie: 0, lose: 0, iterations: 0, exact: true, heroCats, perCombo, comboWeights: cw, empty: true };
  return {
    equity: (win + tie / 2) / wSum, win: win / wSum, tie: tie / wSum, lose: lose / wSum,
    iterations: wSum, exact: true, heroCats, perCombo, comboWeights: cw,
  };
}

function buildSampler(range, deadMask) {
  if (!range) return null; // random
  const idx = [];
  const cum = [];
  let s = 0;
  for (let k = 0; k < NUM_COMBOS; k++) {
    const w = range[k];
    if (w <= 0 || deadMask[COMBO_A[k]] || deadMask[COMBO_B[k]]) continue;
    s += w; idx.push(k); cum.push(s);
  }
  return { idx: Int32Array.from(idx), cum: Float64Array.from(cum), total: s };
}

function sampleCombo(sm, u) {
  const x = u * sm.total;
  let lo = 0, hi = sm.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sm.cum[mid] < x) lo = mid + 1; else hi = mid; }
  return sm.idx[lo];
}

function monteCarlo(hero, board, villains, maxIters, maxMs, seed) {
  const rng = makeRng(seed);
  const deadMask = new Uint8Array(52);
  for (const d of hero) deadMask[d] = 1;
  for (const d of board) deadMask[d] = 1;
  const samplers = villains.map((r) => buildSampler(r, deadMask));
  if (samplers.some((s) => s && s.total <= 0)) {
    return { equity: 0, win: 0, tie: 0, lose: 0, iterations: 0, exact: false, heroCats: new Float64Array(9), empty: true };
  }
  const nV = villains.length;
  const need = 5 - board.length;
  const used = new Uint8Array(52);
  const touched = new Int32Array(2 * nV + 5);
  const vc = new Int32Array(2 * nV);
  const heroHand = new Int32Array(7);
  const vHand = new Int32Array(7);
  heroHand[0] = hero[0]; heroHand[1] = hero[1];
  for (let i = 0; i < board.length; i++) heroHand[2 + i] = board[i];
  const heroCats = new Float64Array(9);
  let iters = 0, win = 0, tie = 0, eq = 0, skipped = 0;
  const t0 = now();
  while (iters < maxIters) {
    let nt = 0, ok = true;
    for (let v = 0; v < nV && ok; v++) {
      const sm = samplers[v];
      let tries = 0, a, b;
      for (;;) {
        if (sm) { const k = sampleCombo(sm, rng.float()); a = COMBO_A[k]; b = COMBO_B[k]; }
        else {
          do { a = rng.int(52); } while (deadMask[a] || used[a]);
          do { b = rng.int(52); } while (deadMask[b] || used[b] || b === a);
        }
        if (!used[a] && !used[b]) break;
        if (++tries > 40) { ok = false; break; }
      }
      if (!ok) break;
      used[a] = 1; used[b] = 1; touched[nt++] = a; touched[nt++] = b;
      vc[2 * v] = a; vc[2 * v + 1] = b;
    }
    if (!ok) {
      for (let i = 0; i < nt; i++) used[touched[i]] = 0;
      if (++skipped > maxIters) break;
      continue;
    }
    for (let i = 0; i < need; i++) {
      let c;
      do { c = rng.int(52); } while (deadMask[c] || used[c]);
      used[c] = 1; touched[nt++] = c;
      heroHand[2 + board.length + i] = c;
    }
    const hs = evaluate(heroHand, 7);
    heroCats[hs >> 20]++;
    for (let i = 2; i < 7; i++) vHand[i] = heroHand[i];
    let best = true, ties = 0;
    for (let v = 0; v < nV; v++) {
      vHand[0] = vc[2 * v]; vHand[1] = vc[2 * v + 1];
      const s = evaluate(vHand, 7);
      if (s > hs) { best = false; break; }
      if (s === hs) ties++;
    }
    if (best) {
      if (ties === 0) { win++; eq += 1; } else { tie++; eq += 1 / (ties + 1); }
    }
    for (let i = 0; i < nt; i++) used[touched[i]] = 0;
    iters++;
    if ((iters & 4095) === 0 && now() - t0 > maxMs) break;
  }
  for (let c = 0; c < 9; c++) heroCats[c] /= Math.max(1, iters);
  return {
    equity: iters ? eq / iters : 0, win: iters ? win / iters : 0, tie: iters ? tie / iters : 0,
    lose: iters ? (iters - win - tie) / iters : 0, iterations: iters, exact: false, heroCats,
  };
}
