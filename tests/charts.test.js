import { rfiRange, vsOpenRanges, vs3betRanges, positionsFor, pushRange, describeWidth } from '../app/js/core/charts.js';
import { rangeWidth } from '../app/js/core/ranges.js';
for (const size of [9, 6, 2]) {
  console.log(`--- ${size}-max RFI:`, positionsFor(size).map(p => `${p} ${describeWidth(rfiRange(p, size))}`).join(' | '));
}
const pairs = [['UTG','BTN',9],['UTG','BB',6],['HJ','CO',6],['CO','BTN',6],['CO','BB',6],['BTN','SB',6],['BTN','BB',6],['SB','BB',6],['BTN','BB',2]];
for (const [o,h,s] of pairs) { const r = vsOpenRanges(o,h,s); console.log(`${h} vs ${o} (${s}): 3bet ${describeWidth(r.raise)} call ${describeWidth(r.call)} [${r.group}/${r.slot}]`); }
for (const p of ['UTG','HJ','CO','BTN','SB']) { const r = vs3betRanges(p,6); console.log(`${p} vs 3bet: 4bet ${describeWidth(r.raise)} call ${describeWidth(r.call)}`); }
for (const S of [8, 12]) console.log(`push ${S}bb:`, positionsFor(9).slice(0,8).map(p => `${p} ${(pushRange(p, 9, S).width*100).toFixed(0)}%`).join(' '));
