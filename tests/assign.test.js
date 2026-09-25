// assignCards(): split detections into hero (2) and board (<=5) from first-person geometry.
import { parseCard, cardToString } from '../app/js/core/cards.js';

// detector.js imports only parseCard from cards.js at module level, safe to import in Node
const { assignCards } = await import('../app/js/app/detector.js');
const det = (name, x, y, w = 0.08, h = 0.12) => ({ card: parseCard(name), name, score: 0.9, box: { x, y, w, h } });
let bad = 0;
const expect = (title, dets, hero, board) => {
  const r = assignCards(dets);
  const H = r.hero.map(cardToString).sort().join(' '), B = r.board.map(cardToString).join(' ');
  const ok = H === hero.slice().sort().join(' ') && B === board.join(' ');
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${title}: hero [${H}] board [${B}]`);
};
// live table: flop row in the middle, two big hole cards at the bottom
expect('first-person flop', [
  det('Kc', 0.30, 0.35), det('8h', 0.42, 0.36), det('3s', 0.54, 0.35),
  det('As', 0.38, 0.72, 0.14, 0.2), det('Kd', 0.52, 0.74, 0.14, 0.2),
], ['As', 'Kd'], ['Kc', '8h', '3s']);
// online screenshot: 5 board cards, hero at the bottom
expect('screenshot river', [
  det('Qh', 0.62, 0.40), det('2c', 0.26, 0.41), det('7d', 0.35, 0.40), det('Js', 0.44, 0.40), det('9h', 0.53, 0.41),
  det('Ah', 0.45, 0.80), det('Ad', 0.53, 0.80),
], ['Ah', 'Ad'], ['2c', '7d', 'Js', '9h', 'Qh']);
// only hole cards
expect('hole cards only', [det('Tc', 0.4, 0.6), det('Th', 0.5, 0.62)], ['Tc', 'Th'], []);
console.log(bad ? `FAILED (${bad})` : 'assign OK');
if (bad) process.exit(1);
