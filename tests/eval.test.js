import { evaluate, evaluateSlow, describeScore, masksOf, evalWith } from '../app/js/core/evaluator.js';
import { parseCards, makeRng, cardsToString } from '../app/js/core/cards.js';

const rng = makeRng(12345);
function randomHand(n) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 0; i < n; i++) { const j = i + rng.int(52 - i); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck.slice(0, n);
}
let bad = 0;
for (let t = 0; t < 200000; t++) {
  const n = 5 + (t % 3);
  const h = randomHand(n);
  const a = evaluate(h), b = evaluateSlow(h);
  if (a !== b) { if (bad++ < 10) console.log('MISMATCH', cardsToString(h), a.toString(16), b.toString(16)); }
}
// evalWith consistency
for (let t = 0; t < 50000; t++) {
  const h = randomHand(7);
  const base = masksOf(h.slice(0, 5));
  if (evalWith(base, h[5], h[6]) !== evaluate(h)) { bad++; console.log('evalWith mismatch'); break; }
}
const cases = [
  ['As Ks Qs Js Ts 2d 3c', '皇家同花順'],
  ['Ah 2h 3h 4h 5h Kd Kc', '同花順 (5 高)'],
  ['Ad 2c 3h 4s 5d 9c Kh', '順子 (5 高)'],
  ['Kd Kc Ks Kh 2d 2c Qh', '四條 K'],
  ['7d 7c 7s 2h 2d Ac Qh', '葫蘆 7 帶 2'],
  ['7d 7c 7s 2h 2d 2c Qh', '葫蘆 7 帶 2'],
  ['Ad Kc Qh 9s 9d 5c 5h', '兩對 9 與 5'],
  ['Ad Kc Qh 9s 9d 5c 5h', '兩對 9 與 5'],
];
for (const [s, want] of cases) {
  const got = describeScore(evaluate(parseCards(s)));
  if (got !== want) { bad++; console.log('DESC MISMATCH', s, got, 'want', want); }
}
// kicker checks
const cmp = (x, y) => Math.sign(evaluate(parseCards(x)) - evaluate(parseCards(y)));
const checks = [
  ['As Ad Kc 7h 5d 3c 2h', 'As Ad Qc 7h 5d 3c 2h', 1],
  ['Ah 2h 3h 4h 5h Kd Kc', '6c 2h 3h 4h 5h Kd Kc', 1],
  ['Ts Js Qs Ks 9s 2d 2c', 'As Ks Qs Js Ts 2d 2c', -1],
  ['2c 2d 2h 3s 3d 4c 4h', '2c 2d 2h 4s 4d 3c 5h', 0],
];
for (const [x, y, want] of checks) { const g = cmp(x, y); if (g !== want) { bad++; console.log('CMP MISMATCH', x, '|', y, g, want); } }
// benchmark
const hands = Array.from({ length: 100000 }, () => randomHand(7));
let t0 = performance.now(), acc = 0;
for (let rep = 0; rep < 20; rep++) for (const h of hands) acc += evaluate(h, 7);
let dt = performance.now() - t0;
console.log(`evaluate: ${(2e6 / dt * 1000 / 1e6).toFixed(1)} M evals/s (acc ${acc % 7})`);
console.log(bad ? `FAILED (${bad})` : 'evaluator OK');
if (bad) process.exit(1);
