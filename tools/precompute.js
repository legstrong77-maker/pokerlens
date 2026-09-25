// Precompute preflop data tables with Monte Carlo (multi-threaded):
//  1) 169x169 class-vs-class all-in equity matrix
//  2) class equity vs N random opponents (N = 1..8)
// Output: app/js/data/preflop-data.js (base64 Uint16 arrays)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CLASS_COMBOS, COMBO_A, COMBO_B, NUM_CLASSES, makeRng, className } from '../app/js/core/cards.js';
import { evaluate } from '../app/js/core/evaluator.js';

const SAMPLES_PAIR = 120000;
const SAMPLES_RANDOM = 160000;
const MAX_OPP = 8;

function drawBoard(rng, dead, out, offset) {
  // dead: Uint8Array(52) flags; draws 5 distinct cards into out[offset..offset+4]
  let k = 0;
  while (k < 5) {
    const c = rng.int(52);
    if (dead[c]) continue;
    dead[c] = 1;
    out[offset + k++] = c;
  }
  for (let i = 0; i < 5; i++) dead[out[offset + i]] = 0;
}

function pairEquity(i, j, samples, rng) {
  const ci = CLASS_COMBOS[i], cj = CLASS_COMBOS[j];
  const pairs = [];
  for (const a of ci) for (const b of cj) {
    const a1 = COMBO_A[a], a2 = COMBO_B[a], b1 = COMBO_A[b], b2 = COMBO_B[b];
    if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
    pairs.push(a, b);
  }
  const np = pairs.length / 2;
  const dead = new Uint8Array(52);
  const h1 = new Int32Array(7), h2 = new Int32Array(7);
  let eq = 0;
  for (let s = 0; s < samples; s++) {
    const p = rng.int(np);
    const a = pairs[2 * p], b = pairs[2 * p + 1];
    h1[0] = COMBO_A[a]; h1[1] = COMBO_B[a];
    h2[0] = COMBO_A[b]; h2[1] = COMBO_B[b];
    dead[h1[0]] = dead[h1[1]] = dead[h2[0]] = dead[h2[1]] = 1;
    drawBoard(rng, dead, h1, 2);
    for (let k = 2; k < 7; k++) h2[k] = h1[k];
    dead[h1[0]] = dead[h1[1]] = dead[h2[0]] = dead[h2[1]] = 0;
    const v1 = evaluate(h1, 7), v2 = evaluate(h2, 7);
    eq += v1 > v2 ? 1 : v1 === v2 ? 0.5 : 0;
  }
  return eq / samples;
}

function randomEquity(i, nOpp, samples, rng) {
  const ci = CLASS_COMBOS[i];
  const dead = new Uint8Array(52);
  const hero = new Int32Array(7);
  const opp = new Int32Array(7);
  const oppCards = new Int32Array(2 * MAX_OPP);
  let eq = 0;
  for (let s = 0; s < samples; s++) {
    const k = ci[rng.int(ci.length)];
    hero[0] = COMBO_A[k]; hero[1] = COMBO_B[k];
    dead[hero[0]] = dead[hero[1]] = 1;
    for (let o = 0; o < 2 * nOpp; o++) {
      let c; do { c = rng.int(52); } while (dead[c]);
      dead[c] = 1; oppCards[o] = c;
    }
    drawBoard(rng, dead, hero, 2);
    for (let o = 0; o < 2 * nOpp; o++) dead[oppCards[o]] = 0;
    dead[hero[0]] = dead[hero[1]] = 0;
    const hv = evaluate(hero, 7);
    for (let b = 2; b < 7; b++) opp[b] = hero[b];
    let best = -1, ties = 0, lost = false;
    for (let o = 0; o < nOpp; o++) {
      opp[0] = oppCards[2 * o]; opp[1] = oppCards[2 * o + 1];
      const v = evaluate(opp, 7);
      if (v > hv) { lost = true; break; }
      if (v === hv) ties++;
      if (v > best) best = v;
    }
    if (!lost) eq += 1 / (ties + 1);
  }
  return eq / samples;
}

if (!isMainThread) {
  const { tasks, seed } = workerData;
  const rng = makeRng(seed);
  const out = [];
  for (const t of tasks) {
    if (t.type === 'pair') out.push({ ...t, v: pairEquity(t.i, t.j, SAMPLES_PAIR, rng) });
    else out.push({ ...t, v: randomEquity(t.i, t.n, SAMPLES_RANDOM, rng) });
  }
  parentPort.postMessage(out);
} else {
  const t0 = Date.now();
  const tasks = [];
  for (let i = 0; i < NUM_CLASSES; i++) for (let j = i; j < NUM_CLASSES; j++) tasks.push({ type: 'pair', i, j });
  for (let i = 0; i < NUM_CLASSES; i++) for (let n = 1; n <= MAX_OPP; n++) tasks.push({ type: 'rand', i, n });
  // interleave for load balance
  for (let k = tasks.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [tasks[k], tasks[r]] = [tasks[r], tasks[k]]; }
  const nw = Math.max(1, os.cpus().length - 2);
  const chunks = Array.from({ length: nw }, () => []);
  tasks.forEach((t, k) => chunks[k % nw].push(t));
  const self = fileURLToPath(import.meta.url);
  const results = await Promise.all(chunks.map((c, w) => new Promise((res, rej) => {
    const wk = new Worker(self, { workerData: { tasks: c, seed: 1000 + w * 7919 } });
    wk.on('message', res); wk.on('error', rej);
  })));
  const M = new Float64Array(NUM_CLASSES * NUM_CLASSES);
  const R = new Float64Array(NUM_CLASSES * MAX_OPP);
  for (const arr of results) for (const r of arr) {
    if (r.type === 'pair') {
      if (r.i === r.j) { M[r.i * 169 + r.j] = 0.5; }
      else { M[r.i * 169 + r.j] = r.v; M[r.j * 169 + r.i] = 1 - r.v; }
    } else R[r.i * MAX_OPP + (r.n - 1)] = r.v;
  }
  const toB64 = (f64) => {
    const u = new Uint16Array(f64.length);
    for (let k = 0; k < f64.length; k++) u[k] = Math.round(Math.min(1, Math.max(0, f64[k])) * 65535);
    return Buffer.from(u.buffer).toString('base64');
  };
  const here = path.dirname(self);
  const outFile = path.join(here, '..', 'app', 'js', 'data', 'preflop-data.js');
  const src = `// AUTO-GENERATED by tools/precompute.js — Monte Carlo (${SAMPLES_PAIR} samples/pair, ${SAMPLES_RANDOM} samples/random)\n` +
    `// MATRIX: 169x169 Uint16 (equity*65535) row=hero class, col=villain class. VS_RANDOM: 169x${MAX_OPP} equity vs N random hands.\n` +
    `export const MATRIX_B64 = '${toB64(M)}';\n` +
    `export const VS_RANDOM_B64 = '${toB64(R)}';\n` +
    `export const VS_RANDOM_MAX = ${MAX_OPP};\n`;
  writeFileSync(outFile, src);
  const idx = (n) => { const m = { AA: 0 }; return n; };
  const find = (name) => { for (let c = 0; c < 169; c++) if (className(c) === name) return c; return -1; };
  const show = (a, b) => console.log(`${a} vs ${b}: ${(M[find(a) * 169 + find(b)] * 100).toFixed(2)}%`);
  show('AA', 'KK'); show('AKs', 'QQ'); show('AKo', '22'); show('72o', 'AA'); show('JTs', 'AKo');
  console.log('AA vs 1 random:', (R[find('AA') * MAX_OPP] * 100).toFixed(2) + '%', ' 72o vs 1:', (R[find('72o') * MAX_OPP] * 100).toFixed(2) + '%');
  console.log('AA vs 8 random:', (R[find('AA') * MAX_OPP + 7] * 100).toFixed(2) + '%');
  console.log(`wrote ${outFile} (${(src.length / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s using ${nw} workers`);
}
