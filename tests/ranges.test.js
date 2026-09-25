import { parseRange, rangeWidth, rangeToString, topRange } from '../app/js/core/ranges.js';
import { PREFLOP_ORDER, ALLIN_ORDER, solvePushFold, equityVsRange } from '../app/js/core/preflop.js';
import { className, parseCards } from '../app/js/core/cards.js';

const r = parseRange('22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, ATo+, KJo+, QJo:0.5');
console.log('width', (rangeWidth(r) * 100).toFixed(1) + '%');
console.log('str  ', rangeToString(r));
console.log('top 10 order:', PREFLOP_ORDER.slice(0, 25).map(className).join(' '));
console.log('top15% ', rangeToString(topRange(0.15, PREFLOP_ORDER)));
console.log('top30% ', rangeToString(topRange(0.30, PREFLOP_ORDER)));
for (const S of [5, 10, 15, 20]) {
  const t0 = performance.now();
  const { push, call } = solvePushFold(S, 0);
  const pw = rangeWidth(push.map(x => x > 0.5 ? 1 : 0)), cw = rangeWidth(call.map(x => x > 0.5 ? 1 : 0));
  console.log(`S=${S}bb push ${(pw*100).toFixed(1)}%  call ${(cw*100).toFixed(1)}%  (${(performance.now()-t0).toFixed(0)}ms)`);
  if (S === 10) { console.log('  push:', rangeToString(push.map(x => x > 0.5 ? 1 : 0))); console.log('  call:', rangeToString(call.map(x => x > 0.5 ? 1 : 0))); }
}
console.log('AsKs vs QQ+,AK:', (equityVsRange(parseCards('As Ks'), parseRange('QQ+, AK'))*100).toFixed(1)+'%');
