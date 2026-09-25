// Randomized sanity sweep: flags recommendations that are clearly unreasonable.
import { analyze } from '../app/js/core/strategy.js';
import { makeRng, cardsToString } from '../app/js/core/cards.js';
const rng = makeRng(7);
const deal = (n) => { const d = [...Array(52).keys()]; for (let i = 0; i < n; i++) { const j = i + rng.int(52 - i); [d[i], d[j]] = [d[j], d[i]]; } return d.slice(0, n); };
const V = { foldStrong: [], nutsCheckRiver: [], hugeAirBluff: [], callNoEquity: [] };
let n = 0;
for (let t = 0; t < 400; t++) {
  const nb = [3, 4, 5][t % 3];
  const cards = deal(2 + nb);
  const hero = cards.slice(0, 2), board = cards.slice(2);
  const facing = rng.float() < 0.5 ? 'bet' : 'none';
  const pot = 6 + rng.int(40);
  const bet = facing === 'bet' ? Math.round(pot * [0.33, 0.5, 0.75, 1][rng.int(4)] * 10) / 10 : 0;
  const heroAgg = rng.float() < 0.5, heroIP = rng.float() < 0.5;
  const r = analyze({ tableSize: 6, stack: 100, villainType: ['unknown', 'nit', 'lag', 'station', 'maniac'][rng.int(5)], heroPos: heroIP ? 'BTN' : 'BB', hero, board,
    postflop: { pot, effStack: 100 - pot / 2, villains: 1, villainPos: heroIP ? 'BB' : 'BTN', potType: 'srp', heroAggressor: heroAgg, heroIP, facing, bet, villainChecked: heroIP && facing === 'none' } });
  n++;
  const k = r.action.key, eq = r.equity.value, req = r.potOdds?.required ?? 0;
  const vt = r.reasons.find((x) => x.startsWith('對手是') || x.startsWith('對手很') || x.startsWith('對手鬆') || x.startsWith('對手極') || x.startsWith('對手緊')) || 'unknown';
  const tag = `[${vt.slice(0, 8)}] ${cardsToString(hero)} | ${cardsToString(board)} facing=${facing} ${bet} pot=${pot} eq=${(eq * 100).toFixed(0)}% req=${(req * 100).toFixed(0)}% -> ${r.action.label}`;
  if (k === 'fold' && eq >= req + 0.2) V.foldStrong.push(tag);
  if (board.length === 5 && facing === 'none' && heroIP && (r.hand.hs ?? 0) >= 0.995 && k === 'check') V.nutsCheckRiver.push(tag);
  if ((k === 'raise' || k === 'allin') && (r.action.sizeBB || 0) > 40 && eq < 0.2) V.hugeAirBluff.push(tag);
  if (k === 'call' && board.length === 5 && eq < req - 0.1) V.callNoEquity.push(tag);
}
console.log(`checked ${n} spots`);
let total = 0;
for (const [k, arr] of Object.entries(V)) { total += arr.length; console.log(`${k}: ${arr.length}`); arr.slice(0, 4).forEach((x) => console.log('   ', x)); }
console.log(total ? `FAILED (${total} unreasonable decisions)` : 'fuzz sanity OK');
if (total) process.exit(1);
