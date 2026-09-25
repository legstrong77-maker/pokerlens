// Regression asserts for key strategy decisions.
import { analyze } from '../app/js/core/strategy.js';
import { parseCards } from '../app/js/core/cards.js';
let bad = 0;
const spot = (s) => analyze({ tableSize: 6, stack: 100, villainType: 'unknown', ...s, hero: parseCards(s.hero), board: parseCards(s.board || '') });
const want = (title, s, keys) => {
  const r = spot(s);
  const ok = keys.includes(r.action.key);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${title}: ${r.action.label} (want ${keys.join('/')})`);
};
const SRP_IP = { pot: 5.5, effStack: 97.5, villains: 1, villainPos: 'BB', potType: 'srp', heroAggressor: true, heroIP: true, facing: 'none', villainChecked: true };
want('AKo BTN open', { hero: 'As Kd', heroPos: 'BTN', preflop: { scenario: 'unopened' } }, ['raise']);
want('72o UTG fold', { hero: '7s 2d', heroPos: 'UTG', preflop: { scenario: 'unopened' } }, ['fold']);
want('K9o SB 10bb shove', { hero: 'Kc 9d', heroPos: 'SB', stack: 10, preflop: { scenario: 'unopened' } }, ['allin']);
want('QQ vs 3bet -> 4bet', { hero: 'Qs Qd', heroPos: 'CO', preflop: { scenario: 'vs3bet', openerPos: 'BTN', heroOpen: 2.5, openSize: 7.5 } }, ['raise', 'allin']);
want('TPTK dry c-bet', { hero: 'As Kd', heroPos: 'BTN', board: 'Kc 8h 3s', postflop: SRP_IP }, ['bet', 'allin']);
want('river bluff-catcher vs triple barrel', { hero: '9c 8c', heroPos: 'BB', board: 'Kh 9d 4s 2c Qd', postflop: { pot: 20, effStack: 80, villains: 1, villainPos: 'BTN', potType: 'srp', heroAggressor: false, heroIP: false, facing: 'bet', bet: 20, history: [{ street: 3, villain: 'bet', size: 0.33 }, { street: 4, villain: 'bet', size: 0.66 }] } }, ['fold']);
want('set on wet board facing bet', { hero: '7s 7d', heroPos: 'BTN', board: '7h 8h 9c', postflop: { pot: 10, effStack: 95, villains: 2, villainPos: 'CO', potType: 'srp', heroAggressor: false, heroIP: true, facing: 'bet', bet: 6 } }, ['raise', 'allin']);
want('nut flush river value', { hero: 'Ah Th', heroPos: 'BTN', villainType: 'station', board: 'Kh 7h 2c 9s 4h', postflop: { ...SRP_IP, pot: 30, effStack: 70, history: [{ street: 3, villain: 'call', size: 0.33 }, { street: 4, villain: 'call', size: 0.66 }] } }, ['bet', 'allin']);
want('NFD facing c-bet continues', { hero: 'Ah 5h', heroPos: 'BB', board: 'Kh 9h 4c', postflop: { pot: 5.5, effStack: 97.5, villains: 1, villainPos: 'BTN', potType: 'srp', heroAggressor: false, heroIP: false, facing: 'bet', bet: 3.6 } }, ['call', 'raise']);
want('air vs big river bet folds', { hero: '6c 5c', heroPos: 'BB', board: 'Ks Qd 8h 3c 2s', postflop: { pot: 12, effStack: 80, villains: 1, villainPos: 'BTN', potType: 'srp', heroAggressor: false, heroIP: false, facing: 'bet', bet: 10 } }, ['fold']);
console.log(bad ? `FAILED (${bad})` : 'strategy asserts OK');
if (bad) process.exit(1);
