import { readHand, analyzeBoard, comboStrengths, rangeComposition, outsSummary } from '../app/js/core/board.js';
import { parseCards } from '../app/js/core/cards.js';
import { parseRange, toCombos } from '../app/js/core/ranges.js';
const cases = [
  ['Ah Kh', 'Qh 7h 2c'], ['8s 9s', 'Ts Jd 2s'], ['Qc Qd', 'Ks 7d 7c Ah'], ['As Kd', 'Kc 8h 3s'],
  ['5c 5d', '5h Jc 2s'], ['Ac Qd', 'Js Td 4h'], ['7c 6c', '9d 8h 2c 3c'], ['Jh Jc', 'Qs 9d 4h'], ['Ad 5d', 'Kd 9d 2s 7c 4h'],
];
for (const [h, b] of cases) {
  const r = readHand(parseCards(h), parseCards(b));
  console.log(`${h} | ${b}: ${r.label} — ${r.detail} | HS ${(r.hs*100).toFixed(1)}% | draws: ${r.drawLabels.join(',') || '-'} | outs ${r.outsCount} (clean ${r.cleanOuts}) next ${(r.pNext*100).toFixed(1)}% river ${(r.pRiver*100).toFixed(1)}%`);
  console.log('   texture:', r.texture.label, r.texture.tags.join(' '), 'wet', r.texture.wetness.toFixed(2), JSON.stringify(outsSummary(r.outs)));
}
const board = parseCards('Qh 7h 2c');
const st = comboStrengths(board, parseCards('Ah Kh'));
const comp = rangeComposition(toCombos(parseRange('22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, ATo+, KJo+')), st);
console.log('UTG range comp on Qh7h2c:', comp.map(x => (x*100).toFixed(1)+'%').join(' '));
