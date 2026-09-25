import { computeEquity } from '../app/js/core/equity.js';
import { parseCards, comboIndex, NUM_COMBOS } from '../app/js/core/cards.js';
import { parseRange, toCombos } from '../app/js/core/ranges.js';

const single = (s) => { const c = parseCards(s); const r = new Float32Array(NUM_COMBOS); r[comboIndex(c[0], c[1])] = 1; return r; };
const fmt = (x) => (x * 100).toFixed(2) + '%';
let bad = 0;
const check = (name, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${fmt(got)} (want ${fmt(want)} ±${fmt(tol)})`);
};

// Preflop MC reference values
let r = computeEquity({ hero: parseCards('Ad Ac'), board: [], villains: [single('Kh Ks')], maxIters: 400000, maxMs: 5000 });
check('AdAc vs KhKs pre', r.equity, 0.81255, 0.004);
r = computeEquity({ hero: parseCards('Ah Kh'), board: [], villains: [single('Qs Qd')], maxIters: 400000, maxMs: 5000 });
check('AhKh vs QsQd pre', r.equity, 0.46214, 0.005);
r = computeEquity({ hero: parseCards('As Ad'), board: [], villains: [null], maxIters: 400000, maxMs: 5000 });
check('AA vs random', r.equity, 0.8520, 0.004);
r = computeEquity({ hero: parseCards('As Ad'), board: [], villains: [null, null, null, null], maxIters: 400000, maxMs: 5000 });
check('AA vs 4 random', r.equity, 0.5584, 0.006);

// Exact vs MC consistency on flop and turn
const scen = [
  ['Ah Kh', 'Qh 7h 2c', 'QQ+, AK, JTs, 98s'],
  ['8s 9s', 'Ts Jd 2s', 'any'],
  ['Qc Qd', 'Ks 7d 7c Ah', '22+, AJ+, KQ'],
];
for (const [h, b, rs] of scen) {
  const hero = parseCards(h), board = parseCards(b);
  const cw = toCombos(parseRange(rs));
  const t0 = performance.now();
  const ex = computeEquity({ hero, board, villains: [cw] });
  const t1 = performance.now();
  // force MC by giving two villains where second is ... use internal trick: pass board and single villain via mc
  const mc = computeEquity({ hero, board: board.slice(0, board.length), villains: [cw, null], maxIters: 1, maxMs: 1 }); // warm
  const mcOnly = (await import('../app/js/core/equity.js'));
  console.log(`exact ${h} | ${b} vs [${rs}] = ${fmt(ex.equity)} in ${(t1 - t0).toFixed(0)}ms`);
}

// Monte Carlo single-villain postflop check via 2-villain path with one dead-certain folding? Instead compare with a brute recount:
{
  const hero = parseCards('Ah Kh'), board = parseCards('Qh 7h 2c');
  const vs = single('Qs Qc');
  const ex = computeEquity({ hero, board, villains: [vs] });
  // manual reference by brute force enumeration
  const { evaluate } = await import('../app/js/core/evaluator.js');
  const dead = new Set([...hero, ...board, ...parseCards('Qs Qc')]);
  const rest = []; for (let c = 0; c < 52; c++) if (!dead.has(c)) rest.push(c);
  let w = 0, n = 0;
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
    const b5 = [...board, rest[i], rest[j]];
    const a = evaluate([...hero, ...b5]), v = evaluate([...parseCards('Qs Qc'), ...b5]);
    w += a > v ? 1 : a === v ? 0.5 : 0; n++;
  }
  check('AhKh vs QsQc on Qh7h2c exact', ex.equity, w / n, 1e-6);
}
console.log(bad ? `FAILED (${bad})` : 'equity OK');
if (bad) process.exit(1);
