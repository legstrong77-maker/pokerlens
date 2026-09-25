// Worker-friendly jobs shared by the engine worker and the main-thread fallback.
import { computeEquity } from './equity.js';
import { toCombos, parseRange } from './ranges.js';
import { comboIndex } from './cards.js';

/** Multi-player equity: players[{cards:[a,b]|null, range:'text'|null}], board[] */
export function equityJob({ players, board }) {
  const out = [];
  for (let i = 0; i < players.length; i++) {
    const me = players[i];
    if (!me.cards || me.cards.length !== 2) { out.push(null); continue; }
    const villains = [];
    for (let j = 0; j < players.length; j++) {
      if (j === i) continue;
      const p = players[j];
      if (p.cards?.length === 2) {
        const r = new Float32Array(1326);
        r[comboIndex(p.cards[0], p.cards[1])] = 1;
        villains.push(r);
      } else if (p.range) villains.push(toCombos(parseRange(p.range), [...board, ...me.cards]));
      else villains.push(null);
    }
    const res = computeEquity({ hero: me.cards, board, villains, maxMs: 700, maxIters: 400000 });
    out.push({ equity: res.equity, win: res.win, tie: res.tie, exact: res.exact, iterations: res.iterations });
  }
  return out;
}
